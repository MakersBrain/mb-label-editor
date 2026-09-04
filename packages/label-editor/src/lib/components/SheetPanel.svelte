<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { LabelDocument } from '../model.js';
  import { downloadBytes, openPdfInNewWindow } from '../browser-files.js';
  import type { DocumentMaterializer } from '../materialization.js';
  import type { DocumentMeasurer } from '../continuous-media.js';
  import { prepareDocumentForOutput } from '../output-preparation.js';
  import { sheetLayoutPresets } from '../sheets/catalogue.js';
  import { materializeSheetJob } from '../sheets/job.js';
  import { presetToDefinition, sheetPlanInput } from '../sheets/normalize.js';
  import {
    isSheetPlanForRequest,
    type SheetDefinition,
    type SheetExporter,
    type SheetFillOrder,
    type SheetLayoutPreset,
    type SheetPaper,
    type SheetPlan,
    type SheetPreferencesV1,
  } from '../sheets/types.js';

  interface Props {
    document: LabelDocument;
    exporter: SheetExporter;
    materializer: DocumentMaterializer;
    measurer: DocumentMeasurer;
    initialLayoutId?: string;
    initialPreferences?: SheetPreferencesV1;
    onLayout?: (layoutId: string, fillOrder: SheetFillOrder, custom?: NonNullable<SheetLayoutPreset['grid']>) => void;
    onStatus?: (message: string) => void;
  }
  let {
    document,
    exporter,
    materializer,
    measurer,
    initialLayoutId = '',
    initialPreferences,
    onLayout = () => {},
    onStatus = () => {},
  }: Props = $props();

  const presets = sheetLayoutPresets();
  // The dialog seeds its form from the props once; later prop changes are not meant to reset a form the user is editing.
  const initial = untrack(() => ({
    layoutId: initialPreferences?.layoutId ?? initialLayoutId,
    custom: initialPreferences?.lastCustomGrid,
    fillOrder: initialPreferences?.fillOrder ?? 'row-major',
    width: document.media.width,
    height: document.media.height,
  }));
  const savedLayoutId = initial.layoutId;
  const savedCustom = initial.custom;
  let layoutId = $state(
    savedLayoutId === 'custom' || presets.some((item) => item.id === savedLayoutId)
      ? savedLayoutId
      : (presets[0]?.id ?? 'custom'),
  );
  let mode: 'copies' | 'records' = $state('copies');
  let copies = $state(1);
  let firstSlot = $state(0);
  let fillOrder: SheetFillOrder = $state(initial.fillOrder);
  let customPaper: Exclude<SheetPaper, 'custom'> = $state('a4');
  let customOrientation: 'portrait' | 'landscape' = $state('portrait');
  let rows = $state(savedCustom?.rows ?? 8);
  let columns = $state(savedCustom?.columns ?? 3);
  let labelWidthMm = $state(savedCustom?.labelWidthMm ?? initial.width);
  let labelHeightMm = $state(savedCustom?.labelHeightMm ?? initial.height);
  let marginLeftMm = $state(savedCustom?.marginLeftMm ?? 0);
  let marginTopMm = $state(savedCustom?.marginTopMm ?? 4.5);
  let gapXMm = $state(savedCustom?.gapXMm ?? 0);
  let gapYMm = $state(savedCustom?.gapYMm ?? 0);
  let plan: SheetPlan | undefined = $state.raw();
  let error = $state('');
  let busy = $state(false);
  let requestVersion = 0;
  let plannedFingerprint = $state('');

  const itemCount = $derived(mode === 'copies' ? copies : (document.template?.records.length ?? 0));
  const fingerprint = $derived(
    [
      layoutId,
      mode,
      itemCount,
      firstSlot,
      fillOrder,
      customPaper,
      customOrientation,
      rows,
      columns,
      labelWidthMm,
      labelHeightMm,
      marginLeftMm,
      marginTopMm,
      gapXMm,
      gapYMm,
      document.media.width,
      document.media.height,
    ].join(':'),
  );
  $effect(() => {
    const key = fingerprint;
    if (key) untrack(() => refreshPlan(key)).catch(() => {});
  });

  function selectedPreset(): SheetLayoutPreset {
    if (layoutId !== 'custom') {
      const preset = presets.find((item) => item.id === layoutId);
      if (!preset) throw new Error('Select a sheet layout.');
      if (!preset.grid) return preset;
      return { ...preset, grid: { ...preset.grid, fillOrder } };
    }
    return {
      id: 'custom',
      name: 'Custom grid',
      paper: customPaper,
      orientation: customOrientation,
      grid: { rows, columns, labelWidthMm, labelHeightMm, marginLeftMm, marginTopMm, gapXMm, gapYMm, fillOrder },
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
      if (firstSlot >= capacity) {
        firstSlot = 0;
        return;
      }
      const options = { firstSlot, dpi: 300 };
      const prepared = await prepareDocumentForOutput(document, { materializer, measurer });
      const input = sheetPlanInput(prepared.document, itemCount);
      const selected = selectedPreset();
      const next = await exporter.planSheet(input, layout, options);
      if (!isSheetPlanForRequest(next, input, layout, options))
        throw new Error('The sheet exporter returned an invalid placement plan.');
      if (version === requestVersion && requestFingerprint === fingerprint) {
        plan = next;
        plannedFingerprint = requestFingerprint;
        onLayout(
          selected.id,
          selected.grid?.fillOrder ?? fillOrder,
          selected.id === 'custom' ? selected.grid : undefined,
        );
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
    const sources =
      mode === 'copies'
        ? materializeSheetJob(document, { mode, copies })
        : await Promise.all(
            (document.template?.records ?? []).map((record) => materializer.materializeRecord(document, record)),
          );
    const documents = await Promise.all(
      sources.map(async (source) => (await prepareDocumentForOutput(source, { materializer, measurer })).document),
    );
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
      const opened = await openPdfInNewWindow(async () => (await buildPdf()).data, {
        title: 'Preparing label sheet PDF',
        loadingMessage: 'Preparing label sheet PDF…',
      });
      if (!opened) {
        error = 'The browser blocked the print window. Export the PDF instead.';
        onStatus(error);
        return;
      }
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

  const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
</script>

<section class="sheet-panel" aria-busy={busy}>
  <div class="controls">
    <label
      >Content
      <select bind:value={mode}>
        <option value="copies">Current label copies</option>
        <option value="records" disabled={!document.template?.records.length}>CSV records</option>
      </select>
    </label>
    {#if mode === 'copies'}
      <label>Copies<input type="number" min="1" max="1000" step="1" bind:value={copies} /></label>
    {:else}
      <p>{document.template?.records.length ?? 0} records in displayed order</p>
    {/if}
    <label
      >Label sheet
      <select value={layoutId} onchange={(event) => chooseLayout(event.currentTarget.value)}>
        {#each presets as preset}<option value={preset.id}>{preset.name}</option>{/each}
        <option value="custom">Custom grid…</option>
      </select>
    </label>
    {#if layoutId === 'custom'}
      <div class="grid-fields">
        <label
          >Paper<select bind:value={customPaper}
            ><option value="a4">A4</option><option value="letter">US Letter</option></select
          ></label
        >
        <label
          >Orientation<select bind:value={customOrientation}
            ><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select
          ></label
        >
        <label>Rows<input type="number" min="1" max="100" step="1" bind:value={rows} /></label>
        <label>Columns<input type="number" min="1" max="100" step="1" bind:value={columns} /></label>
        <label>Label width (mm)<input type="number" min="0.001" step="0.001" bind:value={labelWidthMm} /></label>
        <label>Label height (mm)<input type="number" min="0.001" step="0.001" bind:value={labelHeightMm} /></label>
        <label>Left margin (mm)<input type="number" min="0" step="0.001" bind:value={marginLeftMm} /></label>
        <label>Top margin (mm)<input type="number" min="0" step="0.001" bind:value={marginTopMm} /></label>
        <label>Horizontal gap (mm)<input type="number" min="0" step="0.001" bind:value={gapXMm} /></label>
        <label>Vertical gap (mm)<input type="number" min="0" step="0.001" bind:value={gapYMm} /></label>
      </div>
    {/if}
    <label
      >Fill order<select bind:value={fillOrder}
        ><option value="row-major">Rows first</option><option value="column-major">Columns first</option></select
      ></label
    >
    {#if plan}
      <label
        >First unused label
        <select bind:value={firstSlot}
          >{#each plan.layout.slots as _, index}<option value={index}>Slot {index + 1}</option>{/each}</select
        >
      </label>
    {/if}
    <p class="summary">{document.media.width} × {document.media.height} mm label · 300 DPI monochrome</p>
  </div>

  {#if plan}
    <div class="preview-wrap">
      <div
        class="paper"
        style={`aspect-ratio:${plan.layout.paperWidthUm}/${plan.layout.paperHeightUm}`}
        role="group"
        aria-label="First sheet placement preview"
      >
        {#each plan.layout.slots as slot, index}
          <button
            class:unused={index < firstSlot}
            class:occupied={plan.placements.some((placement) => placement.page === 0 && placement.slot === index)}
            aria-label={`Start at slot ${index + 1}`}
            aria-pressed={firstSlot === index}
            title={`Slot ${index + 1}`}
            style={`left:${(slot.xUm / plan.layout.paperWidthUm) * 100}%;top:${(slot.yUm / plan.layout.paperHeightUm) * 100}%;width:${(slot.widthUm / plan.layout.paperWidthUm) * 100}%;height:${(slot.heightUm / plan.layout.paperHeightUm) * 100}%`}
            onclick={() => (firstSlot = index)}>{index + 1}</button
          >
        {/each}
      </div>
      <p aria-live="polite">
        {plan.pageCount} page{plan.pageCount === 1 ? '' : 's'} · {plan.layout.slots.length} labels per full sheet
      </p>
    </div>
  {/if}
  {#if error}<p class="mb-notice bad error" role="alert">{error}</p>{/if}
  <p class="guidance">
    Opening the PDF does not print automatically. In the PDF viewer choose Print, select the matching paper size, use
    Actual size or 100%, disable Fit to page, and test on plain paper before using label stock.
  </p>
  <div class="actions">
    <button onclick={download} disabled={!plan || busy}>Export sheet PDF</button><button
      onclick={openPrintPdf}
      disabled={!plan || busy}>Open print PDF</button
    >
  </div>
</section>

<style>
  .sheet-panel {
    display: grid;
    grid-template-columns: minmax(14rem, 1fr) minmax(12rem, 1fr);
    gap: 0.8rem;
    padding: 0.8rem;
  }
  .controls,
  .grid-fields {
    display: grid;
    gap: 0.45rem;
  }
  .grid-fields {
    grid-template-columns: 1fr 1fr;
  }
  .sheet-panel label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: var(--mble-text-small);
  }
  .sheet-panel p {
    margin: 0.15rem 0;
    font-size: var(--mble-text-small);
  }
  .summary,
  .guidance {
    color: var(--mble-text-muted);
  }
  .preview-wrap {
    min-width: 0;
  }
  .paper {
    position: relative;
    width: 100%;
    background: var(--mble-paper);
    border: 1px solid var(--mble-border);
    box-shadow: var(--mble-shadow-sm);
  }
  .paper button {
    position: absolute;
    display: grid;
    place-items: center;
    min-width: 0;
    padding: 0;
    border: 1px solid var(--mble-success);
    background: var(--mble-success-tint);
    color: var(--mble-success);
    font-size: var(--mble-text-micro);
    overflow: hidden;
  }
  .paper button.unused {
    background: var(--mble-surface-sunken);
    color: var(--mble-text-muted);
  }
  .paper button.occupied {
    background: color-mix(in srgb, var(--mble-success) 30%, var(--mble-success-tint));
  }
  .error {
    grid-column: 1/-1;
  }
  .guidance,
  .actions {
    grid-column: 1/-1;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  @media (max-width: 40rem) {
    .sheet-panel {
      grid-template-columns: 1fr;
    }
  }
</style>
