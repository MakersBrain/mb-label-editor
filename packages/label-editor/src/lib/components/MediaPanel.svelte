<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { EditorStore } from '../store.js';
  import type { MediaPreset, PrinterDefinition, PrinterSdk } from '../print/types.js';
  import { updateDocument } from '../commands.js';
  import { continuousSettings, defaultContinuousSettings, printableBoundsForResizedMedia } from '../continuous-media.js';
  import { prepareDocumentForOutput } from '../output-preparation.js';
  import type { DocumentMaterializer } from '../materialization.js';
  import { uuid, type Media } from '../model.js';

  export let editor: EditorStore;
  export let sdk: PrinterSdk | undefined = undefined;
  export let materializer:Pick<DocumentMaterializer,'materializeRecord'>|undefined=undefined;
  export let printers: PrinterDefinition[] = [];
  export let printerId = '';
  export let onPrinter: (id: string) => void = () => {};

  const presets = [['50 × 30', 50, 30, 203, 'rectangle'], ['La Poste', 63.5, 33.9, 300, 'rectangle'], ['Round 50', 50, 50, 203, 'round']] as const;
  let stock: MediaPreset[] = [];
  let loadedFor = '';
  $: if (sdk && printerId && printerId !== loadedFor) { loadedFor = printerId; void loadStock(printerId); }
  $: selectedStock = stock.find(item => Math.abs(item.widthMm - $editor.document.media.width) < .01 && (item.shape === 'continuous' || Math.abs(item.heightMm - $editor.document.media.height) < .01))?.id ?? '';
  $: rollSettings = continuousSettings($editor.document);
  $: selectedPrinter = printers.find(item => item.id === printerId);
  $: hardMinimum = selectedPrinter?.continuousMedia?.minimumLengthMm ?? selectedPrinter?.media.minHeight ?? .1;
  $: hardMaximum = selectedPrinter?.continuousMedia?.maximumLengthMm ?? selectedPrinter?.media.maxHeight ?? 1000;
  let calculatedLength:number|undefined;
  let calculationWarnings:string[]=[];
  let calculationError='';
  let calculationGeneration=0;
  $: { $editor.document; rollSettings.lengthMode; rollSettings.fixedLengthMm; rollSettings.leadingMarginMm; rollSettings.trailingMarginMm; void calculateLength(); }
  async function calculateLength(){
    const generation=++calculationGeneration;
    if($editor.document.media.shape!=='continuous'||!sdk?.measure){calculatedLength=undefined;calculationWarnings=[];calculationError='';return}
    try{
      const result=await prepareDocumentForOutput($editor.document,{materializer,measurer:sdk as import('../continuous-media.js').DocumentMeasurer},{limits:selectedPrinter?{minimumLengthMm:hardMinimum,maximumLengthMm:hardMaximum,source:'printer',printerModel:selectedPrinter.id}:undefined});
      if(generation===calculationGeneration){
        calculatedLength=rollSettings.lengthMode==='fit-content'?result.resolvedLengthMm:undefined;
        calculationWarnings=result.warnings.filter(item=>item.severity==='warning').map(item=>item.message);
        if(rollSettings.lengthMode==='fixed'&&result.contentBounds&&result.contentBounds.y+result.contentBounds.height>result.resolvedLengthMm&&!calculationWarnings.some(item=>item.includes('fixed cut line')))calculationWarnings=[...calculationWarnings,'Visible content extends past the fixed cut line.'];
        calculationError='';
      }
    }catch(error){if(generation===calculationGeneration){calculatedLength=undefined;calculationWarnings=[];calculationError=error instanceof Error?error.message:String(error)}}
  }

  function media(patch: Partial<Media>) {
    const next = { ...$editor.document.media, ...patch };
    if (patch.shape === 'continuous' && !next.continuousSettings) next.continuousSettings = defaultContinuousSettings({ ...$editor.document, media: next });
    if (patch.width !== undefined || patch.height !== undefined) next.printableBounds = printableBoundsForResizedMedia($editor.document.media, next.width, next.height);
    editor.execute(updateDocument({ media: next }));
  }
  function roll(patch: Partial<typeof rollSettings>) {
    const continuousSettings = { ...rollSettings, ...patch };
    media({ continuousSettings, ...(patch.fixedLengthMm === undefined ? {} : { height: patch.fixedLengthMm }) });
    void Promise.resolve().then(calculateLength);
  }
  function optionalLength(value: string) { const parsed = Number(value); return value.trim() && Number.isFinite(parsed) ? parsed : undefined; }
  function preset(index: string) { const value = presets[+index]; if (value) media({ width: value[1], height: value[2], dpi: value[3], shape: value[4] }); }
  function stockPreset(id: string) { const item = stock.find(entry => entry.id === id); if (item) media({ width: item.widthMm, height: item.heightMm || $editor.document.media.height, shape: item.shape === 'round' ? 'round' : item.shape === 'continuous' ? 'continuous' : 'rectangle' }); }
  function resetRollLimits(){if(!selectedPrinter)return;const minimum=selectedPrinter.continuousMedia?.minimumLengthMm??selectedPrinter.media.minHeight;const maximum=selectedPrinter.continuousMedia?.maximumLengthMm??selectedPrinter.media.maxHeight;roll({preferredMinimumLengthMm:undefined,preferredMaximumLengthMm:undefined,...(rollSettings.lengthMode==='fixed'?{fixedLengthMm:Math.min(maximum,Math.max(minimum,rollSettings.fixedLengthMm))}:{})})}
  async function loadStock(id: string) {
    const printer = printers.find(item => item.id === id);
    stock = printer && sdk?.mediaPresets ? await sdk.mediaPresets(printer) : [];
    if (printer) media({ width: Math.min(printer.media.maxWidth, Math.max(printer.media.minWidth, $editor.document.media.width)), height: $editor.document.media.shape==='continuous'?$editor.document.media.height:Math.min(printer.media.maxHeight, Math.max(printer.media.minHeight, $editor.document.media.height)), dpi: printer.dpi });
  }
  function addZone(clone = false) { const zones = $editor.document.media.zones ?? []; const source = zones[0]; media({ zones: [...zones, { id: uuid(), name: `Zone ${zones.length + 1}`, x: source?.x ?? 0, y: source?.y ?? 0, width: source?.width ?? $editor.document.media.width, height: source?.height ?? $editor.document.media.height, ...clone && source ? { cloneOf: source.id } : {} }] }); }
  function edit(id: string, patch: Record<string, unknown>) { media({ zones: ($editor.document.media.zones ?? []).map(zone => zone.id === id ? { ...zone, ...patch } : zone) }); }
  function remove(id: string) { media({ zones: ($editor.document.media.zones ?? []).filter(zone => zone.id !== id).map(zone => zone.cloneOf === id ? { ...zone, cloneOf: undefined } : zone) }); }
</script>

{#if printers.length}<section class="capabilities">
  <label>Printer<select value={printerId} on:change={event => onPrinter(event.currentTarget.value)}><option value="">Choose printer</option>{#each printers as printer}<option value={printer.id}>{printer.displayName} · {printer.dpi} dpi</option>{/each}</select></label>
  {#if stock.length}<label>Media for this printer<select value={selectedStock} on:change={event => stockPreset(event.currentTarget.value)}><option value="">Custom size</option>{#each stock as item}<option value={item.id}>{item.name} · {item.widthMm} × {item.heightMm || 'continuous'} mm</option>{/each}</select></label><p class="hint">Selecting stock sets the exact label size and media type used for preview and printing.</p>{/if}
</section>{/if}
<section><h2>Media & zones</h2>
  <label>Generic preset<select on:change={event => preset(event.currentTarget.value)}><option value="">Custom</option>{#each presets as item, index}<option value={index}>{item[0]}</option>{/each}</select></label>
  <div class="grid">
    <label>{$editor.document.media.shape==='continuous'?'Roll width':'Width'} (mm)<input type="number" min=".1" step=".1" value={$editor.document.media.width} on:change={event => media({width:+event.currentTarget.value})}></label>
    {#if $editor.document.media.shape!=='continuous'}<label>Height (mm)<input type="number" min=".1" step=".1" value={$editor.document.media.height} on:change={event => media({height:+event.currentTarget.value})}></label>{/if}
    <label>DPI<input type="number" min="1" step="1" value={$editor.document.media.dpi} on:change={event => media({dpi:+event.currentTarget.value})}></label>
    <label>Shape<select value={$editor.document.media.shape} on:change={event => media({shape:event.currentTarget.value as Media['shape']})}><option>rectangle</option><option>round</option><option>continuous</option></select></label>
  </div>
  {#if $editor.document.media.shape==='continuous'}
    <fieldset class="continuous"><legend>Continuous roll</legend>
      <div class="grid">
        <label>Length mode<select value={rollSettings.lengthMode} on:change={event=>roll({lengthMode:event.currentTarget.value as typeof rollSettings.lengthMode})}><option value="fixed">Fixed length</option><option value="fit-content" disabled={!sdk?.measure}>Fit content</option></select></label>
        {#if rollSettings.lengthMode==='fixed'}<label>Cut length (mm)<input type="number" min=".1" step=".1" value={rollSettings.fixedLengthMm} on:change={event=>roll({fixedLengthMm:+event.currentTarget.value})}></label>{:else}<label>Calculated length (mm)<output>{calculatedLength===undefined?'Calculating…':calculatedLength.toFixed(2)}</output></label>{/if}
        <label>Leading safe margin (mm)<input type="number" min="0" step=".1" value={rollSettings.leadingMarginMm} on:change={event=>roll({leadingMarginMm:+event.currentTarget.value})}></label>
        <label>Trailing margin (mm)<input type="number" min="0" step=".1" value={rollSettings.trailingMarginMm} on:change={event=>roll({trailingMarginMm:+event.currentTarget.value})}></label>
        <label>Preferred minimum (mm)<input type="number" min={hardMinimum} max={hardMaximum} step=".1" value={rollSettings.preferredMinimumLengthMm??''} placeholder={String(selectedPrinter?hardMinimum:'Generic')} on:change={event=>roll({preferredMinimumLengthMm:optionalLength(event.currentTarget.value)})}></label>
        <label>Preferred maximum (mm)<input type="number" min={hardMinimum} max={hardMaximum} step=".1" value={rollSettings.preferredMaximumLengthMm??''} placeholder={String(selectedPrinter?hardMaximum:'Generic')} on:change={event=>roll({preferredMaximumLengthMm:optionalLength(event.currentTarget.value)})}></label>
        <label>Batch sizing<select value={rollSettings.batchLengthMode} on:change={event=>roll({batchLengthMode:event.currentTarget.value as typeof rollSettings.batchLengthMode})}><option value="per-record">Per record</option><option value="uniform-longest">Match longest</option></select></label>
      </div>
      <p class="hint">Hard range: {selectedPrinter?`${hardMinimum}–${hardMaximum} mm for ${selectedPrinter.displayName}`:'generic export limits until a printer is selected'}.</p>
      {#each calculationWarnings as warning}<p class="hint warning" role="status">{warning}</p>{/each}
      {#if calculationError}<p class="hint warning" role="alert">{calculationError}</p>{/if}
      {#if selectedPrinter}<button type="button" on:click={resetRollLimits}>Reset to printer defaults</button>{/if}
      {#if !sdk?.measure}<p class="hint warning">Fit content requires an updated printer SDK with authoritative layout measurement. Fixed length remains available.</p>{/if}
    </fieldset>
  {/if}
  <button on:click={() => addZone()}>Add independent zone</button><button on:click={() => addZone(true)} disabled={!$editor.document.media.zones?.length}>Add cloned zone</button>{#each $editor.document.media.zones ?? [] as zone}<fieldset><legend>{zone.name}</legend><div class="grid"><label>Name<input value={zone.name} on:change={event => edit(zone.id, { name: event.currentTarget.value })}></label>{#each ['x', 'y', 'width', 'height'] as key}<label>{key}<input type="number" step=".1" value={zone[key as 'x']} on:change={event => edit(zone.id, { [key]: +event.currentTarget.value })}></label>{/each}<label>Mode<select value={zone.cloneOf ?? ''} on:change={event => edit(zone.id, { cloneOf: event.currentTarget.value || undefined })}><option value="">Independent</option>{#each ($editor.document.media.zones ?? []).filter(item => item.id !== zone.id) as source}<option value={source.id}>Clone {source.name}</option>{/each}</select></label></div><button on:click={() => remove(zone.id)}>Remove</button></fieldset>{/each}
</section>
<style>section{padding:.7rem .75rem;border-top:1px solid var(--mble-border,#e5dfd5)}h2{margin:0 0 .5rem;color:var(--mble-text-muted,#59635e);font-size:.75rem;font-weight:600}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem}label{display:flex;flex-direction:column;font-size:.75rem}.hint{margin:.4rem 0 0;color:var(--mble-text-muted,#59635e);font-size:.72rem}.warning{color:var(--mble-danger,#a22929)}fieldset{margin:.5rem 0}output{min-height:1.2rem;padding:.15rem .25rem;border:1px solid var(--mble-border,#d8d0c3);background:var(--mble-surface-muted,#f7f4ed)}</style>
