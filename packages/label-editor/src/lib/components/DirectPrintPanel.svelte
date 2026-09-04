<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { DirectPrintRoute } from '../print/direct.js';
  import { WebBluetoothTransport, WebSerialTransport, WebUsbTransport } from '../print/browser-transports.js';
  import { JobJournal } from '../jobs.js';
  import type { LocalApiConnection, LocalApiPrintRoute } from '../print/local-api.js';
  import type { EditorDatabase } from '../persistence/database.js';
  import type { LabelDocument } from '../model.js';
  import type { DocumentMaterializer } from '../materialization.js';
  import { prepareDocumentForOutput } from '../output-preparation.js';
  import type { ContinuousCutMode, ContinuousPrintOptions, PrinterDefinition, PrinterSdk, PrinterStatus, PrintRoute } from '../print/types.js';

  import { untrack } from 'svelte';
  interface Props {
    sdk: PrinterSdk; materializer?: Pick<DocumentMaterializer, 'materializeRecord'>; document: LabelDocument; printer: PrinterDefinition | undefined; database: EditorDatabase;
    localRoute?: LocalApiPrintRoute; localConnection?: LocalApiConnection;
    onLocalConnection?: (connection: LocalApiConnection | undefined) => void; onConfigureLocal?: () => void; onSelectLocal?: () => void; onRoute?: (route: PrintRoute) => void;
    onMedia?: (media: { width: number; height: number; shape: 'rectangle' | 'round' | 'continuous' }) => void;
    initialContinuous?: ContinuousPrintOptions; onContinuous?: (options: ContinuousPrintOptions) => void;
  }
  let { sdk, materializer, document, printer, database, localRoute, localConnection, onLocalConnection = () => {}, onConfigureLocal = () => {}, onSelectLocal = () => {}, onRoute = () => {}, onMedia = () => {}, initialContinuous = { cutMode:'after-each',extraFeedBeforeMm:0,extraFeedAfterMm:0,chainCopies:false }, onContinuous = () => {} }: Props = $props();

  type RouteKind = 'local' | 'bluetooth' | 'spp' | 'usb';
  let route = $state<RouteKind>('bluetooth');
  let routePinned = $state(false);
  let service = $state('0000ff00-0000-1000-8000-00805f9b34fb');
  let write = $state('0000ff02-0000-1000-8000-00805f9b34fb');
  let notify = $state('0000ff03-0000-1000-8000-00805f9b34fb');
  let vendorId = $state('');
  let productId = $state('');
  let message = $state('Select a printer, then connect.');
  let active = $state.raw<DirectPrintRoute | undefined>();
  let connectedPrinterId = $state('');
  let connection = $state<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  let cancellation = $state.raw<AbortController | undefined>();
  let printerStatus = $state.raw<PrinterStatus | undefined>();
  let querying = $state(false);
  const seed = untrack(() => initialContinuous);
  let cutMode = $state<ContinuousCutMode>(seed.cutMode);
  let extraFeedBeforeMm = $state(seed.extraFeedBeforeMm);
  let extraFeedAfterMm = $state(seed.extraFeedAfterMm);
  let chainCopies = $state(seed.chainCopies);
  let continuousPreferenceKey = $state('');
  $effect(()=>{const id=printer?.id??'';const initial=initialContinuous;untrack(()=>syncContinuousPreference(id,initial))});
  const continuousChanged=()=>onContinuous({cutMode,extraFeedBeforeMm,extraFeedAfterMm,chainCopies});
  function syncContinuousPreference(printerId:string,value:ContinuousPrintOptions){const key=`${printerId}:${value.cutMode}:${value.extraFeedBeforeMm}:${value.extraFeedAfterMm}:${value.chainCopies}`;if(key===continuousPreferenceKey)return;continuousPreferenceKey=key;cutMode=value.cutMode;extraFeedBeforeMm=value.extraFeedBeforeMm;extraFeedAfterMm=value.extraFeedAfterMm;chainCopies=value.chainCopies}

  const preferredRoute = (definition: PrinterDefinition | undefined, saved: LocalApiConnection | undefined): RouteKind => saved && (!definition || saved.model === definition.id) ? 'local' : definition?.protocols[0] === 'brother' ? 'usb' : 'bluetooth';
  $effect(()=>{if(!routePinned&&connection==='disconnected'){const next=preferredRoute(printer,localConnection);untrack(()=>{route=next})}});
  $effect(()=>{if(connectedPrinterId&&printer?.id!==connectedPrinterId)untrack(()=>disconnect('Printer changed. Connect the new printer.')).catch(()=>{})});
  const displayConnection = $derived(route === 'local' ? localConnection ? 'connected' : 'disconnected' : connection);
  const reportedMedia = $derived(route === 'local' ? localMediaDescription(localConnection, document) : mediaDescription(printerStatus, document));
  const rollCapabilities = $derived(document.media.shape === 'continuous' ? printer?.continuousMedia : undefined);
  const continuousPrinterUnsupported=$derived(document.media.shape==='continuous'&&!printer?.continuousMedia?.supported);
  const activeRoute=$derived(route==='local'?localRoute:active);
  const availableCutModes=$derived(rollCapabilities?.cutModes.filter(mode=>mode!=='after-job'||activeRoute?.supportsNativeBatch!==false)??[]);
  $effect(()=>{if(rollCapabilities&&!availableCutModes.includes(cutMode)){const next=availableCutModes[0]??'none';untrack(()=>{cutMode=next})}});

  function usbFilters() {
    const vendor = Number(vendorId || 0);
    const product = Number(productId || 0);
    if (vendor && product) return [{ vendorId: vendor, productId: product }];
    if (vendor) return [{ vendorId: vendor }];
    return [{ classCode: 7 }];
  }
  function makeRoute() {
    const journal = new JobJournal(database);
    if (route === 'bluetooth') return new DirectPrintRoute(sdk, async () => new WebBluetoothTransport({ service, writeCharacteristic: write, notifyCharacteristic: notify }), 'bluetooth', () => !!(navigator as Navigator & { bluetooth?: unknown }).bluetooth, journal);
    if (route === 'spp') return new DirectPrintRoute(sdk, async () => new WebSerialTransport({ physicalWriteLimit: 512, unfiltered: true }), 'serial', () => !!(navigator as Navigator & { serial?: unknown }).serial, journal);
    return new DirectPrintRoute(sdk, async () => new WebUsbTransport({ filters: usbFilters(), interfaceNumber: 0 }), 'usb', () => !!(navigator as Navigator & { usb?: unknown }).usb, journal);
  }
  async function connect() {
    if (!printer) { message = 'Select a printer model first.'; return; }
    if (route === 'local') {
      if (!localConnection || !localRoute) { message = 'Configure an IPP/IPPS printer in the local service first.'; onConfigureLocal(); return; }
      onSelectLocal();
      message = `Using saved ${localConnection.transport.kind.toUpperCase()} connection ${localConnection.id}.`;
      await refreshStatus(true);
      return;
    }
    await disconnect();
    active = makeRoute();
    connection = 'connecting';
    message = 'Choose the printer in the browser prompt…';
    try {
      await active.connect();
      connectedPrinterId = printer.id;
      connection = 'connected';
      onRoute(active);
      message = `Connected to ${printer.displayName} via ${active.label}.`;
      await refreshStatus(true);
    } catch (error) {
      connection = 'error';
      active = undefined;
      message = error instanceof Error ? error.message : String(error);
    }
  }
  async function disconnect(nextMessage = 'Printer disconnected.') {
    cancellation?.abort();
    try { await active?.disconnect(); } catch { /* device may already be gone */ }
    active = undefined;
    connectedPrinterId = '';
    printerStatus = undefined;
    connection = 'disconnected';
    if (nextMessage) message = nextMessage;
  }
  async function changeRoute() {
    routePinned = true;
    if (active) await disconnect('Connection method changed. Connect again.');
    if (route === 'local') {
      if (localConnection) { onSelectLocal(); message = `Using saved ${localConnection.transport.kind.toUpperCase()} connection ${localConnection.id}.`; }
      else { message = 'Configure an IPP/IPPS printer in the local service first.'; onConfigureLocal(); }
    }
  }
  async function print() {
    if (!printer) { message = 'Select a printer model before printing.'; return; }
    const selected = route === 'local' ? localRoute : active;
    if (!selected || (route === 'local' ? !localConnection || localConnection.model !== printer.id : !active?.connected)) { message = 'Connect the selected printer before printing.'; return; }
    cancellation = new AbortController();
    message = 'Preparing print…';
    try {
      const prepared=await prepareDocumentForOutput(document,{materializer,measurer:sdk.measure?sdk as import('../continuous-media.js').DocumentMeasurer:undefined},{limits:{minimumLengthMm:printer.continuousMedia?.minimumLengthMm??printer.media.minHeight,maximumLengthMm:printer.continuousMedia?.maximumLengthMm??printer.media.maxHeight,source:'printer',printerModel:printer.id}});
      const result = await selected.print({ document:prepared.document, printer, copies: 1, ...(rollCapabilities?{continuous:{cutMode,extraFeedBeforeMm,extraFeedAfterMm,chainCopies}}:{}), signal: cancellation.signal, onProgress: progress => message = `${progress.phase}: ${progress.bytesSent}/${progress.totalBytes} bytes` });
      message = result.outcome === 'completed' ? `Printed ${result.bytesSent} bytes.` : `${result.outcome}: ${result.error ?? 'Check the physical printer before retrying.'}`;
      if (result.outcome === 'failed') connection = 'error';
      if (result.outcome === 'completed') await refreshStatus(false);
    } catch(error) { message=error instanceof Error?error.message:String(error); }
    finally { cancellation = undefined; }
  }
  async function refreshStatus(apply = false) {
    if (route === 'local') {
      if (!localConnection || !localRoute) { message = 'Configure an IPP/IPPS printer in the local service first.'; return; }
      querying = true;
      try {
        const current = await localRoute.connectionStatus(localConnection.id);
        const updated = { ...current.connection, status: current.status, media: current.media };
        onLocalConnection(updated);
        message = current.connected ? `Connected · ${describeLocal(updated)}` : 'Saved printer is currently unavailable.';
        if (apply) applyLocalMedia(updated);
      } catch (error) { message = `Local printer status is unavailable: ${error instanceof Error ? error.message : String(error)}`; }
      finally { querying = false; }
      return;
    }
    if (!printer || !active?.connected) { message = 'Connect the selected printer first.'; return; }
    querying = true;
    try {
      printerStatus = await active.queryStatus(printer);
      message = `Connected · ${printerStatus.errors.length ? printerStatus.errors.join(', ') : 'printer ready'}`;
      if (apply) applyReportedMedia();
    } catch (error) {
      message = `Connected, but status is unavailable: ${error instanceof Error ? error.message : String(error)}`;
    } finally { querying = false; }
  }
  function applyReportedMedia() {
    if (!printerStatus) return;
    const found = printerStatus.media;
    const width = found?.widthMm ?? printerStatus.mediaWidthMm;
    if (width === undefined) return;
    const continuous = found ? found.shape === 'continuous' : printerStatus.mediaType === 'continuous';
    const height = found?.heightMm || printerStatus.mediaLengthMm || document.media.height;
    onMedia({ width, height, shape: found?.shape === 'round' ? 'round' : continuous ? 'continuous' : 'rectangle' });
    message = `Connected · label set to ${found?.name ?? `${width} × ${height} mm`}`;
  }
  function mediaDescription(value: PrinterStatus | undefined, doc: LabelDocument) {
    const preset = value?.media;
    const width = preset?.widthMm ?? value?.mediaWidthMm ?? doc.media.width;
    const length = preset?.heightMm || value?.mediaLengthMm || doc.media.height;
    const kind = preset?.shape ?? value?.mediaType ?? doc.media.shape;
    return { name: preset?.name, width, length, kind };
  }
  function localMediaDescription(value: LocalApiConnection | undefined, doc: LabelDocument) {
    const media = value?.media && typeof value.media === 'object' ? value.media as Record<string, unknown> : {};
    const width = typeof media.widthMm === 'number' ? media.widthMm : doc.media.width;
    const length = typeof media.lengthMm === 'number' && media.lengthMm > 0 ? media.lengthMm : doc.media.height;
    return { name: typeof media.keyword === 'string' ? media.keyword : undefined, width, length, kind: media.lengthMm === 0 ? 'continuous' : doc.media.shape };
  }
  function describeLocal(value: LocalApiConnection) {
    const media = localMediaDescription(value, document);
    return `${value.status} · ${media.name ?? `${media.width} × ${media.length} mm`}`;
  }
  function applyLocalMedia(value: LocalApiConnection) {
    const media = localMediaDescription(value, document);
    onMedia({ width: media.width, height: media.length, shape: media.kind === 'continuous' ? 'continuous' : 'rectangle' });
  }
</script>

<section class="printer-card" data-state={displayConnection}>
  <div class="heading">
    <div><h2>Printer</h2><strong>{printer?.displayName ?? 'No printer selected'}</strong></div>
    <span class="connection"><i></i>{displayConnection}</span>
  </div>
  <div class="media-summary">
    <span>Media</span><strong>{reportedMedia.width} × {reportedMedia.length} mm</strong>
    <small>{reportedMedia.name ?? reportedMedia.kind} · {printer?.dpi ?? document.media.dpi} dpi</small>
  </div>
  <label>Connection<select bind:value={route} onchange={changeRoute} disabled={connection === 'connecting'}>{#if localRoute}<option value="local">{localConnection ? `${localConnection.transport.kind.toUpperCase()} · ${localConnection.id}` : 'IPP/IPPS · Local service'}</option>{/if}<option value="bluetooth">Bluetooth LE</option><option value="spp">Bluetooth Serial</option><option value="usb">USB</option></select></label>
  {#if rollCapabilities}<fieldset><legend>Continuous roll</legend>{#if rollCapabilities.automaticCutter}<label>Cut<select bind:value={cutMode} onchange={continuousChanged}>{#each availableCutModes as mode}<option value={mode}>{mode==='after-each'?'After each label':mode==='after-job'?'After complete job':'Do not cut'}</option>{/each}</select></label>{/if}{#if rollCapabilities.maximumExtraFeedMm>0}<label>Extra feed before (mm)<input type="number" min={rollCapabilities.minimumExtraFeedMm} max={rollCapabilities.maximumExtraFeedMm} step="0.1" bind:value={extraFeedBeforeMm} onchange={continuousChanged}></label><label>Extra feed after (mm)<input type="number" min={rollCapabilities.minimumExtraFeedMm} max={rollCapabilities.maximumExtraFeedMm} step="0.1" bind:value={extraFeedAfterMm} onchange={continuousChanged}></label>{/if}{#if rollCapabilities.supportsChainedRaster}<label class="check"><input type="checkbox" bind:checked={chainCopies} onchange={continuousChanged}> Chain copies without intermediate cuts</label>{/if}<small>Required firmware feed: {rollCapabilities.requiredFeedBeforeMm??0} mm before / {rollCapabilities.requiredFeedAfterMm??0} mm after. Artwork margins and extra operator feed are separate. This printer currently allows {rollCapabilities.minimumLengthMm}–{rollCapabilities.maximumLengthMm} mm labels.</small></fieldset>{/if}
  {#if route === 'local'}
    <p class="hint">{localConnection ? `Saved by the local service as ${localConnection.id}. It will be restored after reload.` : 'Pair with the local service and configure an IPP/IPPS printer.'}</p>
  {:else if route === 'bluetooth'}
    <p class="hint">Fast setup for Phomemo printers. The device is chosen once and reused while connected.</p>
    <details><summary>BLE definition</summary><label>Service UUID<input bind:value={service}></label><label>Write UUID<input bind:value={write}></label><label>Notify UUID<input bind:value={notify}></label></details>
  {:else if route === 'spp'}
    <p class="hint">Choose the paired serial port: COM on Windows, <code>/dev/cu.*</code> on macOS, or <code>rfcomm</code> on Linux.</p>
  {:else}
    <p class="hint">Choose the attached USB printer.</p>
    <details><summary>USB identity</summary><label>Vendor ID<input bind:value={vendorId} placeholder="0x04f9"></label><label>Product ID<input bind:value={productId} placeholder="0x20a8"></label></details>
  {/if}
  <div class="actions">
    {#if route === 'local'}<button onclick={onConfigureLocal}>{localConnection ? 'Manage' : 'Configure'}</button>{:else if connection === 'connected'}<button onclick={() => disconnect()}>Disconnect</button>{:else}<button class="primary" onclick={connect} disabled={!printer || connection === 'connecting'}>{connection === 'connecting' ? 'Connecting…' : 'Connect'}</button>{/if}
    <button onclick={() => refreshStatus(false)} disabled={(route === 'local' ? !localConnection : connection !== 'connected') || querying}>{querying ? 'Checking…' : 'Refresh status'}</button>
    <button class="primary print" onclick={print} disabled={continuousPrinterUnsupported||(route === 'local' ? !localConnection : connection !== 'connected') || !!cancellation} title={continuousPrinterUnsupported?'The selected printer is not qualified for continuous media.':undefined}>{cancellation ? 'Printing…' : 'Print label'}</button>
  </div>
  {#if cancellation}<button class="cancel" onclick={() => cancellation?.abort()}>Cancel current job</button>{/if}
  <p class="message" aria-live="polite">{message}</p>
  {#if printerStatus}<dl>{#if printerStatus.phase}<dt>State</dt><dd>{printerStatus.phase}</dd>{/if}{#if printerStatus.battery !== undefined}<dt>Battery</dt><dd>{printerStatus.battery}%</dd>{/if}{#if printerStatus.paper}<dt>Paper</dt><dd>{printerStatus.paper}</dd>{/if}{#if printerStatus.cover}<dt>Cover</dt><dd>{printerStatus.cover}</dd>{/if}{#if printerStatus.firmware}<dt>Firmware</dt><dd>{printerStatus.firmware}</dd>{/if}<dt>Errors</dt><dd class:fault={!!printerStatus.errors.length}>{printerStatus.errors.length ? printerStatus.errors.join(', ') : 'none'}</dd></dl>{/if}
</section>

<style>
  .printer-card{padding:.75rem;border-top:1px solid var(--mble-border,#e5dfd5)}.heading{display:flex;justify-content:space-between;gap:.6rem;align-items:flex-start;margin-bottom:.65rem}.heading h2{margin:0 0 .12rem;color:var(--mble-text-muted,#59635e);font-size:.7rem;text-transform:uppercase;letter-spacing:.08em}.heading strong{font-size:.86rem}.connection{display:flex;gap:.32rem;align-items:center;text-transform:capitalize;font-size:.68rem;color:var(--mble-text-muted,#59635e)}.connection i{width:.48rem;height:.48rem;border-radius:50%;background:#999}.printer-card[data-state='connected'] .connection i{background:#2e9b62}.printer-card[data-state='connecting'] .connection i{background:#d49331}.printer-card[data-state='error'] .connection i{background:var(--mble-danger,#a21)}
  .media-summary{display:grid;grid-template-columns:auto 1fr;gap:.08rem .5rem;padding:.55rem .6rem;margin-bottom:.65rem;border:1px solid var(--mble-border,#e5dfd5);border-radius:var(--mble-radius-sm,6px);background:var(--mble-surface-muted,#f4f1ea)}.media-summary span{grid-row:span 2;color:var(--mble-text-muted,#59635e);font-size:.68rem;text-transform:uppercase;letter-spacing:.06em}.media-summary strong{font-size:.9rem}.media-summary small{color:var(--mble-text-muted,#59635e)}fieldset{margin:.55rem 0;padding:.5rem;border:1px solid var(--mble-border,#e5dfd5);border-radius:var(--mble-radius-sm,6px)}legend{font-size:.72rem;font-weight:600}fieldset small{display:block;color:var(--mble-text-muted,#59635e);font-size:.68rem}.check{flex-direction:row;align-items:center}
  label{display:flex;flex-direction:column;gap:.2rem;margin-bottom:.45rem;font-size:.72rem}.hint,.message{margin:.45rem 0;color:var(--mble-text-muted,#59635e);font-size:.72rem;line-height:1.35}.actions{display:grid;grid-template-columns:1fr 1fr;gap:.35rem;margin-top:.6rem}.actions .print{grid-column:1/-1;padding:.48rem}.primary{background:var(--mble-primary,#1c6647);color:var(--mble-primary-text,#fff);border-color:var(--mble-primary,#1c6647)}button:disabled{opacity:.45}.cancel{width:100%;margin-top:.35rem}.message{min-height:1.9em}details{margin:.4rem 0}details label{margin-top:.35rem}dl{display:grid;grid-template-columns:auto 1fr;gap:.18rem .55rem;margin:.55rem 0 0;padding-top:.5rem;border-top:1px solid var(--mble-border,#e5dfd5);font-size:.72rem}dt{color:var(--mble-text-muted,#59635e)}dd{margin:0}.fault{color:var(--mble-danger,#a21)}code{font-size:.68rem}
</style>
