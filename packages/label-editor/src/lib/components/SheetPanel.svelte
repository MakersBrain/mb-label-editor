<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { LabelDocument } from '../model.js';
  import { downloadBytes, openPdfInNewWindow } from '../browser-files.js';
  import type { DocumentMaterializer } from '../materialization.js';
  import { sheetLayoutPresets } from '../sheets/catalogue.js';
  import { materializeSheetJob } from '../sheets/job.js';
  import { presetToDefinition, sheetPlanInput } from '../sheets/normalize.js';
  import { isSheetPlanForRequest, type SheetDefinition, type SheetExporter, type SheetFillOrder, type SheetLayoutPreset, type SheetPaper, type SheetPlan, type SheetPreferencesV1 } from '../sheets/types.js';

  export let document: LabelDocument;
  export let exporter: SheetExporter;
  export let materializer: DocumentMaterializer;
  export let initialLayoutId = '';
  export let initialPreferences: SheetPreferencesV1 | undefined = undefined;
  export let onLayout: (layoutId: string, fillOrder: SheetFillOrder, custom?: NonNullable<SheetLayoutPreset['grid']>) => void = () => {};
  export let onStatus: (message: string) => void = () => {};

  const presets = sheetLayoutPresets();
  const savedLayoutId = initialPreferences?.layoutId ?? initialLayoutId;
  const savedCustom = initialPreferences?.lastCustomGrid;
  let layoutId = savedLayoutId === 'custom' || presets.some((item) => item.id === savedLayoutId) ? savedLayoutId : (presets[0]?.id ?? 'custom');
  let mode: 'copies' | 'records' = 'copies';
  let copies = 1;
  let firstSlot = 0;
  let fillOrder: SheetFillOrder = initialPreferences?.fillOrder ?? 'row-major';
  let customPaper: Exclude<SheetPaper, 'custom'> = 'a4';
  let customOrientation: 'portrait' | 'landscape' = 'portrait';
  let rows = savedCustom?.rows ?? 8;
  let columns = savedCustom?.columns ?? 3;
  let labelWidthMm = savedCustom?.labelWidthMm ?? document.media.width;
  let labelHeightMm = savedCustom?.labelHeightMm ?? document.media.height;
  let marginLeftMm = savedCustom?.marginLeftMm ?? 0;
  let marginTopMm = savedCustom?.marginTopMm ?? 4.5;
  let gapXMm = savedCustom?.gapXMm ?? 0;
  let gapYMm = savedCustom?.gapYMm ?? 0;
  let plan: SheetPlan | undefined;
  let error = '';
  let busy = false;
  let requestVersion = 0;
  let plannedFingerprint = '';

  $: itemCount = mode === 'copies' ? copies : (document.template?.records.length ?? 0);
  $: fingerprint = [layoutId, mode, itemCount, firstSlot, fillOrder, customPaper, customOrientation, rows, columns, labelWidthMm, labelHeightMm, marginLeftMm, marginTopMm, gapXMm, gapYMm, document.media.width, document.media.height].join(':');
  $: if (fingerprint) void refreshPlan(fingerprint);

  function selectedPreset(): SheetLayoutPreset {
    if (layoutId !== 'custom') {
      const preset = presets.find((item) => item.id === layoutId);
      if (!preset) throw new Error('Select a sheet layout.');
      if (!preset.grid) return preset;
      return { ...preset, grid: { ...preset.grid, fillOrder } };
    }
    return {
      id: 'custom', name: 'Custom grid', paper: customPaper, orientation: customOrientation,
      grid: { rows, columns, labelWidthMm, labelHeightMm, marginLeftMm, marginTopMm, gapXMm, gapYMm, fillOrder }
    };
  }

  function definition(): SheetDefinition {
    return presetToDefinition(selectedPreset());
  }

  async function refreshPlan(requestFingerprint: string) {
    const version = ++requestVersion;
    plan = undefined;
    plannedFingerprint = '';
    error = '';
    try {
      const layout = definition();
      const capacity = layout.kind === 'grid' ? layout.rows * layout.columns : layout.slots.length;
      if (firstSlot >= capacity) { firstSlot = 0; return; }
      const options = { firstSlot, dpi: 300 };
      const input = sheetPlanInput(document, itemCount);
      const selected = selectedPreset();
      const next = await exporter.planSheet(input, layout, options);
      if (!isSheetPlanForRequest(next, input, layout, options)) throw new Error('The sheet exporter returned an invalid placement plan.');
      if (version === requestVersion && requestFingerprint === fingerprint) {
        plan = next;
        plannedFingerprint = requestFingerprint;
        onLayout(selected.id, selected.grid?.fillOrder ?? fillOrder, selected.id === 'custom' ? selected.grid : undefined);
      }
    } catch (cause) {
      if (version === requestVersion && requestFingerprint === fingerprint) error = message(cause);
    }
  }

  async function buildPdf(): Promise<{ data: Uint8Array; pageCount: number }> {
    if (!plan || plannedFingerprint !== fingerprint) throw new Error(error || 'Wait for a valid sheet layout.');
    const pageCount = plan.pageCount;
    const layout = definition();
    const options = { firstSlot, dpi: 300 };
    const documents = mode === 'copies'
      ? materializeSheetJob(document, { mode, copies })
      : await Promise.all((document.template?.records ?? []).map((record) => materializer.materializeRecord(document, record)));
    if (!documents.length) throw new Error('Import or select at least one CSV record.');
    return { data: await exporter.exportSheetPdf(documents, layout, options), pageCount };
  }

  async function download() {
    if (busy) return;
    busy = true;
    try {
      const { data, pageCount } = await buildPdf();
      downloadBytes(data, { filename: 'label-sheet.pdf', mimeType: 'application/pdf' });
      onStatus(`Sheet PDF ready: ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
    } catch (cause) {
      error = message(cause);
      onStatus(error);
    } finally {
      busy = false;
    }
  }

  async function openPrintPdf() {
    if (busy) return;
    busy = true;
    try {
      const opened = await openPdfInNewWindow(
        async () => (await buildPdf()).data,
        { title: 'Preparing label sheet PDF', loadingMessage: 'Preparing label sheet PDF…' },
      );
      if (!opened) { error = 'The browser blocked the print window. Export the PDF instead.'; onStatus(error); return; }
      onStatus('Print-ready PDF opened. Start printing from the PDF viewer and use Actual size or 100%.');
    } catch (cause) {
      error = message(cause);
      onStatus(error);
    } finally {
      busy = false;
    }
  }

  function chooseLayout(id: string) {
    layoutId = id;
    firstSlot = 0;
    fillOrder = presets.find((preset) => preset.id === id)?.grid?.fillOrder ?? 'row-major';
  }

  const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
</script>

<section class="sheet-panel" aria-busy={busy}>
  <div class="controls">
    <label>Content
      <select bind:value={mode}>
        <option value="copies">Current label copies</option>
        <option value="records" disabled={!document.template?.records.length}>CSV records</option>
      </select>
    </label>
    {#if mode === 'copies'}
      <label>Copies<input type="number" min="1" max="1000" step="1" bind:value={copies}></label>
    {:else}
      <p>{document.template?.records.length ?? 0} records in displayed order</p>
    {/if}
    <label>Label sheet
      <select value={layoutId} on:change={(event) => chooseLayout(event.currentTarget.value)}>
        {#each presets as preset}<option value={preset.id}>{preset.name}</option>{/each}
        <option value="custom">Custom grid…</option>
      </select>
    </label>
    {#if layoutId === 'custom'}
      <div class="grid-fields">
        <label>Paper<select bind:value={customPaper}><option value="a4">A4</option><option value="letter">US Letter</option></select></label>
        <label>Orientation<select bind:value={customOrientation}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
        <label>Rows<input type="number" min="1" max="100" step="1" bind:value={rows}></label>
        <label>Columns<input type="number" min="1" max="100" step="1" bind:value={columns}></label>
        <label>Label width (mm)<input type="number" min="0.001" step="0.001" bind:value={labelWidthMm}></label>
        <label>Label height (mm)<input type="number" min="0.001" step="0.001" bind:value={labelHeightMm}></label>
        <label>Left margin (mm)<input type="number" min="0" step="0.001" bind:value={marginLeftMm}></label>
        <label>Top margin (mm)<input type="number" min="0" step="0.001" bind:value={marginTopMm}></label>
        <label>Horizontal gap (mm)<input type="number" min="0" step="0.001" bind:value={gapXMm}></label>
        <label>Vertical gap (mm)<input type="number" min="0" step="0.001" bind:value={gapYMm}></label>
      </div>
    {/if}
    <label>Fill order<select bind:value={fillOrder}><option value="row-major">Rows first</option><option value="column-major">Columns first</option></select></label>
    {#if plan}
      <label>First unused label
        <select bind:value={firstSlot}>{#each plan.layout.slots as _, index}<option value={index}>Slot {index + 1}</option>{/each}</select>
      </label>
    {/if}
    <p class="summary">{document.media.width} × {document.media.height} mm label · 300 DPI monochrome</p>
  </div>

  {#if plan}
    <div class="preview-wrap">
      <div class="paper" style={`aspect-ratio:${plan.layout.paperWidthUm}/${plan.layout.paperHeightUm}`} role="group" aria-label="First sheet placement preview">
        {#each plan.layout.slots as slot, index}
          <button
            class:unused={index < firstSlot}
            class:occupied={plan.placements.some((placement) => placement.page === 0 && placement.slot === index)}
            aria-label={`Start at slot ${index + 1}`}
            aria-pressed={firstSlot === index}
            title={`Slot ${index + 1}`}
            style={`left:${slot.xUm / plan.layout.paperWidthUm * 100}%;top:${slot.yUm / plan.layout.paperHeightUm * 100}%;width:${slot.widthUm / plan.layout.paperWidthUm * 100}%;height:${slot.heightUm / plan.layout.paperHeightUm * 100}%`}
            on:click={() => firstSlot = index}>{index + 1}</button>
        {/each}
      </div>
      <p aria-live="polite">{plan.pageCount} page{plan.pageCount === 1 ? '' : 's'} · {plan.layout.slots.length} labels per full sheet</p>
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="guidance">Opening the PDF does not print automatically. In the PDF viewer choose Print, select the matching paper size, use Actual size or 100%, disable Fit to page, and test on plain paper before using label stock.</p>
  <div class="actions"><button on:click={download} disabled={!plan || busy}>Export sheet PDF</button><button on:click={openPrintPdf} disabled={!plan || busy}>Open print PDF</button></div>
</section>

<style>
  .sheet-panel{display:grid;grid-template-columns:minmax(14rem,1fr) minmax(12rem,1fr);gap:.8rem;padding:.8rem}.controls,.grid-fields{display:grid;gap:.45rem}.grid-fields{grid-template-columns:1fr 1fr}.sheet-panel label{display:flex;flex-direction:column;gap:.15rem;font-size:.75rem}.sheet-panel p{margin:.15rem 0;font-size:.75rem}.summary,.guidance{color:var(--mble-text-muted,#59635e)}.preview-wrap{min-width:0}.paper{position:relative;width:100%;background:#fff;border:1px solid var(--mble-border,#d8d0c3);box-shadow:0 2px 8px #17231c18}.paper button{position:absolute;display:grid;place-items:center;min-width:0;padding:0;border:1px solid #4a6755;background:#d7eadc;color:#24422e;font-size:.62rem;overflow:hidden}.paper button.unused{background:#ece9e1;color:#7b7770}.paper button.occupied{background:#b9ddc3}.error{grid-column:1/-1;color:var(--mble-danger,#a22929)}.guidance,.actions{grid-column:1/-1}.actions{display:flex;justify-content:flex-end;gap:.5rem}@media(max-width:600px){.sheet-panel{grid-template-columns:1fr}}
</style>
