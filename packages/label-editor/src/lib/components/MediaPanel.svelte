<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import Panel from './Panel.svelte';
  import type { EditorStore } from '../store.svelte.js';
  import type { MediaPreset, PrinterDefinition, PrinterSdk } from '../print/types.js';
  import { updateDocument } from '../commands.js';
  import {
    continuousSettings,
    defaultContinuousSettings,
    printableBoundsForResizedMedia,
  } from '../continuous-media.js';
  import { prepareDocumentForOutput } from '../output-preparation.js';
  import type { DocumentMaterializer } from '../materialization.js';
  import { uuid, type Media } from '../model.js';

  import { untrack } from 'svelte';
  interface Props {
    /** Heading text; pass undefined when the host names the region (a dialog title). */
    title?: string;
    editor: EditorStore;
    sdk?: PrinterSdk;
    materializer?: Pick<DocumentMaterializer, 'materializeRecord'>;
    printers?: PrinterDefinition[];
    printerId?: string;
    onPrinter?: (id: string) => void;
  }
  let {
    title = 'Media & zones',
    editor,
    sdk,
    materializer,
    printers = [],
    printerId = '',
    onPrinter = () => {},
  }: Props = $props();

  const presets = [
    ['50 × 30', 50, 30, 203, 'rectangle'],
    ['La Poste', 63.5, 33.9, 300, 'rectangle'],
    ['Round 50', 50, 50, 203, 'round'],
  ] as const;
  let stock: MediaPreset[] = $state.raw([]);
  let loadedFor = '';
  $effect(() => {
    const currentSdk = sdk;
    const id = printerId;
    if (currentSdk && id && id !== loadedFor) {
      loadedFor = id;
      untrack(() => loadStock(id)).catch(() => {
        stock = [];
      });
    }
  });
  const selectedStock = $derived(
    stock.find(
      (item) =>
        Math.abs(item.widthMm - editor.document.media.width) < 0.01 &&
        (item.shape === 'continuous' || Math.abs(item.heightMm - editor.document.media.height) < 0.01),
    )?.id ?? '',
  );
  const rollSettings = $derived(continuousSettings(editor.document));
  const selectedPrinter = $derived(printers.find((item) => item.id === printerId));
  const hardMinimum = $derived(
    selectedPrinter?.continuousMedia?.minimumLengthMm ?? selectedPrinter?.media.minHeight ?? 0.1,
  );
  const hardMaximum = $derived(
    selectedPrinter?.continuousMedia?.maximumLengthMm ?? selectedPrinter?.media.maxHeight ?? 1000,
  );
  let calculatedLength: number | undefined = $state();
  let calculationWarnings: string[] = $state([]);
  let calculationError = $state('');
  let calculationGeneration = 0;
  // The calculated length depends on the document, the SDK and the printer only; everything else is read untracked.
  $effect(() => {
    const document = editor.document;
    const currentSdk = sdk;
    const printer = selectedPrinter;
    untrack(() => calculateLength(document, currentSdk, printer)).catch(() => {});
  });
  async function calculateLength(
    document: typeof editor.document,
    currentSdk: PrinterSdk | undefined,
    printer: PrinterDefinition | undefined,
  ) {
    const generation = ++calculationGeneration;
    if (document.media.shape !== 'continuous' || !currentSdk?.measure) {
      calculatedLength = undefined;
      calculationWarnings = [];
      calculationError = '';
      return;
    }
    const settings = continuousSettings(document);
    const limits = printer
      ? {
          minimumLengthMm: printer.continuousMedia?.minimumLengthMm ?? printer.media.minHeight,
          maximumLengthMm: printer.continuousMedia?.maximumLengthMm ?? printer.media.maxHeight,
          source: 'printer' as const,
          printerModel: printer.id,
        }
      : undefined;
    try {
      const result = await prepareDocumentForOutput(
        document,
        { materializer, measurer: currentSdk as import('../continuous-media.js').DocumentMeasurer },
        { limits },
      );
      if (generation === calculationGeneration) {
        calculatedLength = settings.lengthMode === 'fit-content' ? result.resolvedLengthMm : undefined;
        let warnings = result.warnings.filter((item) => item.severity === 'warning').map((item) => item.message);
        if (
          settings.lengthMode === 'fixed' &&
          result.contentBounds &&
          result.contentBounds.y + result.contentBounds.height > result.resolvedLengthMm &&
          !warnings.some((item) => item.includes('fixed cut line'))
        )
          warnings = [...warnings, 'Visible content extends past the fixed cut line.'];
        calculationWarnings = warnings;
        calculationError = '';
      }
    } catch (error) {
      if (generation === calculationGeneration) {
        calculatedLength = undefined;
        calculationWarnings = [];
        calculationError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  function media(patch: Partial<Media>) {
    const next = { ...editor.document.media, ...patch };
    if (patch.shape === 'continuous' && !next.continuousSettings)
      next.continuousSettings = defaultContinuousSettings({ ...editor.document, media: next });
    if (patch.width !== undefined || patch.height !== undefined)
      next.printableBounds = printableBoundsForResizedMedia(editor.document.media, next.width, next.height);
    editor.execute(updateDocument({ media: next }));
  }
  function roll(patch: Partial<typeof rollSettings>) {
    const continuousSettings = { ...rollSettings, ...patch };
    media({ continuousSettings, ...(patch.fixedLengthMm === undefined ? {} : { height: patch.fixedLengthMm }) });
  }
  function optionalLength(value: string) {
    const parsed = Number(value);
    return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
  }
  function preset(index: string) {
    const value = presets[+index];
    if (value) media({ width: value[1], height: value[2], dpi: value[3], shape: value[4] });
  }
  function stockPreset(id: string) {
    const item = stock.find((entry) => entry.id === id);
    if (item)
      media({
        width: item.widthMm,
        height: item.heightMm || editor.document.media.height,
        shape: item.shape === 'round' ? 'round' : item.shape === 'continuous' ? 'continuous' : 'rectangle',
      });
  }
  function resetRollLimits() {
    if (!selectedPrinter) return;
    const minimum = selectedPrinter.continuousMedia?.minimumLengthMm ?? selectedPrinter.media.minHeight;
    const maximum = selectedPrinter.continuousMedia?.maximumLengthMm ?? selectedPrinter.media.maxHeight;
    roll({
      preferredMinimumLengthMm: undefined,
      preferredMaximumLengthMm: undefined,
      ...(rollSettings.lengthMode === 'fixed'
        ? { fixedLengthMm: Math.min(maximum, Math.max(minimum, rollSettings.fixedLengthMm)) }
        : {}),
    });
  }
  async function loadStock(id: string) {
    const printer = printers.find((item) => item.id === id);
    stock = printer && sdk?.mediaPresets ? await sdk.mediaPresets(printer) : [];
    if (printer)
      media({
        width: Math.min(printer.media.maxWidth, Math.max(printer.media.minWidth, editor.document.media.width)),
        height:
          editor.document.media.shape === 'continuous'
            ? editor.document.media.height
            : Math.min(printer.media.maxHeight, Math.max(printer.media.minHeight, editor.document.media.height)),
        dpi: printer.dpi,
      });
  }
  function addZone(clone = false) {
    const zones = editor.document.media.zones ?? [];
    const source = zones[0];
    media({
      zones: [
        ...zones,
        {
          id: uuid(),
          name: `Zone ${zones.length + 1}`,
          x: source?.x ?? 0,
          y: source?.y ?? 0,
          width: source?.width ?? editor.document.media.width,
          height: source?.height ?? editor.document.media.height,
          ...(clone && source ? { cloneOf: source.id } : {}),
        },
      ],
    });
  }
  function edit(id: string, patch: Record<string, unknown>) {
    media({
      zones: (editor.document.media.zones ?? []).map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)),
    });
  }
  function remove(id: string) {
    media({
      zones: (editor.document.media.zones ?? [])
        .filter((zone) => zone.id !== id)
        .map((zone) => (zone.cloneOf === id ? { ...zone, cloneOf: undefined } : zone)),
    });
  }
</script>

{#if printers.length}<section class="capabilities">
    <label
      >Printer<select value={printerId} onchange={(event) => onPrinter(event.currentTarget.value)}
        ><option value="">Choose printer</option>{#each printers as printer}<option value={printer.id}
            >{printer.displayName} · {printer.dpi} dpi</option
          >{/each}</select
      ></label
    >
    {#if stock.length}<label
        >Media for this printer<select
          value={selectedStock}
          onchange={(event) => stockPreset(event.currentTarget.value)}
          ><option value="">Custom size</option>{#each stock as item}<option value={item.id}
              >{item.name} · {item.widthMm} × {item.heightMm || 'continuous'} mm</option
            >{/each}</select
        ></label
      >
      <p class="hint">Selecting stock sets the exact label size and media type used for preview and printing.</p>{/if}
  </section>{/if}
<Panel {title}>
  <label
    >Generic preset<select onchange={(event) => preset(event.currentTarget.value)}
      ><option value="">Custom</option>{#each presets as item, index}<option value={index}>{item[0]}</option
        >{/each}</select
    ></label
  >
  <div class="grid">
    <label
      >{editor.document.media.shape === 'continuous' ? 'Roll width' : 'Width'} (mm)<input
        type="number"
        min=".1"
        step=".1"
        value={editor.document.media.width}
        onchange={(event) => media({ width: +event.currentTarget.value })}
      /></label
    >
    {#if editor.document.media.shape !== 'continuous'}<label
        >Height (mm)<input
          type="number"
          min=".1"
          step=".1"
          value={editor.document.media.height}
          onchange={(event) => media({ height: +event.currentTarget.value })}
        /></label
      >{/if}
    <label
      >DPI<input
        type="number"
        min="1"
        step="1"
        value={editor.document.media.dpi}
        onchange={(event) => media({ dpi: +event.currentTarget.value })}
      /></label
    >
    <label
      >Shape<select
        value={editor.document.media.shape}
        onchange={(event) => media({ shape: event.currentTarget.value as Media['shape'] })}
        ><option>rectangle</option><option>round</option><option>continuous</option></select
      ></label
    >
  </div>
  {#if editor.document.media.shape === 'continuous'}
    <fieldset class="continuous">
      <legend>Continuous roll</legend>
      <div class="grid">
        <label
          >Length mode<select
            value={rollSettings.lengthMode}
            onchange={(event) => roll({ lengthMode: event.currentTarget.value as typeof rollSettings.lengthMode })}
            ><option value="fixed">Fixed length</option><option value="fit-content" disabled={!sdk?.measure}
              >Fit content</option
            ></select
          ></label
        >
        {#if rollSettings.lengthMode === 'fixed'}<label
            >Cut length (mm)<input
              type="number"
              min=".1"
              step=".1"
              value={rollSettings.fixedLengthMm}
              onchange={(event) => roll({ fixedLengthMm: +event.currentTarget.value })}
            /></label
          >{:else}<label
            >Calculated length (mm)<output
              >{calculatedLength === undefined ? 'Calculating…' : calculatedLength.toFixed(2)}</output
            ></label
          >{/if}
        <label
          >Leading safe margin (mm)<input
            type="number"
            min="0"
            step=".1"
            value={rollSettings.leadingMarginMm}
            onchange={(event) => roll({ leadingMarginMm: +event.currentTarget.value })}
          /></label
        >
        <label
          >Trailing margin (mm)<input
            type="number"
            min="0"
            step=".1"
            value={rollSettings.trailingMarginMm}
            onchange={(event) => roll({ trailingMarginMm: +event.currentTarget.value })}
          /></label
        >
        <label
          >Preferred minimum (mm)<input
            type="number"
            min={hardMinimum}
            max={hardMaximum}
            step=".1"
            value={rollSettings.preferredMinimumLengthMm ?? ''}
            placeholder={String(selectedPrinter ? hardMinimum : 'Generic')}
            onchange={(event) => roll({ preferredMinimumLengthMm: optionalLength(event.currentTarget.value) })}
          /></label
        >
        <label
          >Preferred maximum (mm)<input
            type="number"
            min={hardMinimum}
            max={hardMaximum}
            step=".1"
            value={rollSettings.preferredMaximumLengthMm ?? ''}
            placeholder={String(selectedPrinter ? hardMaximum : 'Generic')}
            onchange={(event) => roll({ preferredMaximumLengthMm: optionalLength(event.currentTarget.value) })}
          /></label
        >
        <label
          >Batch sizing<select
            value={rollSettings.batchLengthMode}
            onchange={(event) =>
              roll({ batchLengthMode: event.currentTarget.value as typeof rollSettings.batchLengthMode })}
            ><option value="per-record">Per record</option><option value="uniform-longest">Match longest</option
            ></select
          ></label
        >
      </div>
      <p class="hint">
        Hard range: {selectedPrinter
          ? `${hardMinimum}–${hardMaximum} mm for ${selectedPrinter.displayName}`
          : 'generic export limits until a printer is selected'}.
      </p>
      {#each calculationWarnings as warning}<p class="hint warning" role="status">{warning}</p>{/each}
      {#if calculationError}<p class="hint warning" role="alert">{calculationError}</p>{/if}
      {#if selectedPrinter}<button type="button" onclick={resetRollLimits}>Reset to printer defaults</button>{/if}
      {#if !sdk?.measure}<p class="hint warning">
          Fit content requires an updated printer SDK with authoritative layout measurement. Fixed length remains
          available.
        </p>{/if}
    </fieldset>
  {/if}
  <button onclick={() => addZone()}>Add independent zone</button><button
    onclick={() => addZone(true)}
    disabled={!editor.document.media.zones?.length}>Add cloned zone</button
  >{#each editor.document.media.zones ?? [] as zone}<fieldset>
      <legend>{zone.name}</legend>
      <div class="grid">
        <label
          >Name<input
            value={zone.name}
            onchange={(event) => edit(zone.id, { name: event.currentTarget.value })}
          /></label
        >{#each ['x', 'y', 'width', 'height'] as key}<label
            >{key}<input
              type="number"
              step=".1"
              value={zone[key as 'x']}
              onchange={(event) => edit(zone.id, { [key]: +event.currentTarget.value })}
            /></label
          >{/each}<label
          >Mode<select
            value={zone.cloneOf ?? ''}
            onchange={(event) => edit(zone.id, { cloneOf: event.currentTarget.value || undefined })}
            ><option value="">Independent</option
            >{#each (editor.document.media.zones ?? []).filter((item) => item.id !== zone.id) as source}<option
                value={source.id}>Clone {source.name}</option
              >{/each}</select
          ></label
        >
      </div>
      <button onclick={() => remove(zone.id)}>Remove</button>
    </fieldset>{/each}
</Panel>

<style>
  section {
    padding: 0.7rem 0.75rem;
    border-top: 1px solid var(--mble-border);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4rem;
  }
  label {
    display: flex;
    flex-direction: column;
    font-size: var(--mble-text-small);
  }
  .hint {
    margin: 0.4rem 0 0;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-small);
  }
  .warning {
    color: var(--mble-danger);
  }
  fieldset {
    margin: 0.5rem 0;
  }
  output {
    min-height: 1.2rem;
    padding: 0.15rem 0.25rem;
    border: 1px solid var(--mble-border);
    background: var(--mble-surface-muted);
  }
</style>
