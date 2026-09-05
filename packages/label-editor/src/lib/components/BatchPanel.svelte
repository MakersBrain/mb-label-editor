<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { resolvedRecords } from '../template/derived.js';
  import Panel from './Panel.svelte';
  import { onDestroy, untrack } from 'svelte';
  import { downloadBytes } from '../browser-files.js';
  import type { DocumentMaterializer, ZoneBatchPlacement } from '../materialization.js';
  import type { LabelDocument } from '../model.js';
  import { executeBatch } from '../print/batch.js';
  import type { ContinuousPrintOptions, PrinterDefinition, PrinterSdk, PrintRoute } from '../print/types.js';
  import {
    continuousSettings,
    documentLayoutFingerprint,
    resolveContinuousBatch,
    resolveContinuousDocument,
    type DocumentMeasurement,
  } from '../continuous-media.js';
  interface Props {
    /** Heading text; pass undefined when the host names the region (a dialog title). */
    title?: string;
    document: LabelDocument;
    sdk: PrinterSdk;
    materializer: DocumentMaterializer;
    route?: PrintRoute;
    printer?: PrinterDefinition;
    continuous?: ContinuousPrintOptions;
  }
  let {
    title = 'Batch',
    document,
    sdk,
    materializer,
    route,
    printer,
    continuous = $bindable({ cutMode: 'after-each', extraFeedBeforeMm: 0, extraFeedAfterMm: 0, chainCopies: false }),
  }: Props = $props();
  let copies = $state(1);
  let zone = $state('all');
  let status = $state('');
  let busy = $state(false);
  let calculating = $state(false);
  let controller: AbortController | undefined = $state.raw();
  let calculationController: AbortController | undefined;
  let calculationTimer: ReturnType<typeof setTimeout> | undefined;
  let placements: ZoneBatchPlacement[] = $state.raw([]);
  let planVersion = 0;
  let lengthRows: { record: number; length?: number; status: string; valid: boolean }[] = $state.raw([]);
  const measurementCache = new Map<string, Promise<DocumentMeasurement>>();
  let lengthGeneration = 0;
  const zones = $derived(
    zone === 'all' ? (document.media.zones ?? []) : (document.media.zones ?? []).filter((item) => item.id === zone),
  );
  const planKey = $derived(
    `${document.id}:${document.modifiedAt}:${document.template?.records.length ?? 0}:${zones.map((item) => item.id).join(',')}`,
  );
  const requiredFeedPerLabel = $derived(
    (printer?.continuousMedia?.requiredFeedBeforeMm ?? 0) + (printer?.continuousMedia?.requiredFeedAfterMm ?? 0),
  );
  const operatorFeedPerLabel = $derived(continuous.extraFeedBeforeMm + continuous.extraFeedAfterMm);
  const invalidLengths = $derived(lengthRows.some((row) => !row.valid));
  const continuousPrinterUnsupported = $derived(
    document.media.shape === 'continuous' && !printer?.continuousMedia?.supported,
  );
  const autoCalculationKey = $derived(
    document.media.shape === 'continuous' && document.template?.records.length
      ? `${documentLayoutFingerprint(document)}:${printer?.id ?? 'generic'}:${printer?.continuousMedia?.minimumLengthMm ?? ''}:${printer?.continuousMedia?.maximumLengthMm ?? ''}`
      : '',
  );
  $effect(() => {
    const key = planKey;
    untrack(() => refreshPlan(key)).catch(() => {});
  });
  $effect(() => {
    const key = autoCalculationKey;
    untrack(() => scheduleCalculation(key));
  });
  onDestroy(() => {
    if (calculationTimer) clearTimeout(calculationTimer);
    calculationController?.abort();
    lengthGeneration++;
  });
  async function refreshPlan(key: string) {
    const version = ++planVersion;
    if (!zones.length || !document.template?.records.length) {
      placements = [];
      return;
    }
    try {
      const plan = await materializer.planZoneBatch(document, {
        recordCount: document.template.records.length,
        zoneIds: zones.map((item) => item.id),
      });
      if (version === planVersion && key === planKey) placements = plan.placements;
    } catch (error) {
      if (version === planVersion) {
        placements = [];
        status = message(error);
      }
    }
  }
  async function documents() {
    const records = resolvedRecords(document.template);
    if (!records.length) throw new Error('Import CSV records first.');
    return zones.length
      ? materializer.materializeZoneBatch(document, records, { zoneIds: zones.map((item) => item.id) })
      : Promise.all(records.map((record) => materializer.materializeRecord(document, record)));
  }
  async function resolvedDocuments(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const docs = await documents();
    signal?.throwIfAborted();
    if (document.media.shape !== 'continuous') {
      lengthRows = [];
      return docs;
    }
    const settings = continuousSettings(document);
    if (settings.lengthMode === 'fit-content' && !sdk.measure)
      throw new Error('Fit-content batch output requires authoritative SDK measurement.');
    const generation = ++lengthGeneration;
    const measurements: Array<DocumentMeasurement | undefined> = await Promise.all(
      docs.map((doc) => (settings.lengthMode === 'fit-content' ? measure(doc) : Promise.resolve(undefined))),
    );
    signal?.throwIfAborted();
    if (generation !== lengthGeneration) throw new DOMException('Stale batch length calculation.', 'AbortError');
    const limits = printer
      ? {
          minimumLengthMm: printer.continuousMedia?.minimumLengthMm ?? printer.media.minHeight,
          maximumLengthMm: printer.continuousMedia?.maximumLengthMm ?? printer.media.maxHeight,
          source: 'printer' as const,
          printerModel: printer.id,
        }
      : { minimumLengthMm: 0.1, maximumLengthMm: 1000, source: 'generic-export' as const };
    const preliminary = docs.map((doc, index) => {
      try {
        const result = resolveContinuousDocument(doc, measurements[index], limits, index);
        return { result, row: { record: index, length: result.resolvedLengthMm, status: 'Ready', valid: true } };
      } catch (error) {
        return { row: { record: index, status: message(error), valid: false } };
      }
    });
    lengthRows = preliminary.map((item) => item.row);
    if (preliminary.some((item) => !item.result))
      throw new Error(
        `${preliminary.filter((item) => !item.result).length} batch record(s) exceed continuous-media limits.`,
      );
    const resolved = resolveContinuousBatch(docs, measurements, settings.batchLengthMode, limits);
    lengthRows = resolved.map((item, index) => ({
      record: index,
      length: item.resolvedLengthMm,
      status: 'Ready',
      valid: true,
    }));
    return resolved.map((item) => item.document);
  }
  async function measure(doc: LabelDocument) {
    const key = documentLayoutFingerprint(doc);
    let pending = measurementCache.get(key);
    if (!pending) {
      pending = sdk.measure!(doc);
      measurementCache.set(key, pending);
      if (measurementCache.size > 64) measurementCache.delete(measurementCache.keys().next().value!);
      pending.catch(() => measurementCache.delete(key));
    }
    return await pending;
  }
  function scheduleCalculation(key: string) {
    if (calculationTimer) clearTimeout(calculationTimer);
    calculationController?.abort();
    if (!key) return;
    calculationTimer = setTimeout(() => void calculate(), 150);
  }
  function cancelCalculation() {
    if (calculationTimer) clearTimeout(calculationTimer);
    calculationTimer = undefined;
    calculationController?.abort();
    calculationController = undefined;
  }
  async function calculate() {
    if (busy) return;
    cancelCalculation();
    const active = new AbortController();
    calculationController = active;
    calculating = true;
    try {
      const docs = await resolvedDocuments(active.signal);
      if (!active.signal.aborted) status = `Calculated ${docs.length} batch label length(s).`;
    } catch (error) {
      if (!active.signal.aborted) status = message(error);
    } finally {
      if (calculationController === active) {
        calculationController = undefined;
        calculating = false;
      }
    }
  }
  async function pdf() {
    if (busy) return;
    cancelCalculation();
    busy = true;
    try {
      const docs = await resolvedDocuments();
      const data = await sdk.exportPdf(docs.flatMap((doc) => Array.from({ length: copies }, () => doc)));
      downloadBytes(data, { filename: 'label-batch.pdf', mimeType: 'application/pdf' });
      status = `Exported ${docs.length * copies} labels.`;
    } catch (error) {
      status = message(error);
    } finally {
      busy = false;
    }
  }
  async function print() {
    if (!route || !printer || busy || invalidLengths) return;
    cancelCalculation();
    busy = true;
    controller = new AbortController();
    try {
      const docs = await resolvedDocuments(controller.signal);
      const batch = await executeBatch({
        documents: docs,
        route,
        printer,
        copies,
        continuous: document.media.shape === 'continuous' ? continuous : undefined,
        signal: controller.signal,
        onProgress: (value) =>
          (status = `Printing ${value.item + 1}/${value.items}, copy ${value.copy + 1}/${value.copies}: ${value.current.phase}`),
      });
      status =
        batch.result.outcome === 'completed'
          ? `Printed ${batch.completed} records.`
          : `Stopped after ${batch.completed}: ${batch.result.outcome}. Inspect printer before retrying.`;
    } catch (error) {
      status = message(error);
    } finally {
      busy = false;
      controller = undefined;
    }
  }
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
</script>

<Panel {title}>
  <p>{document.template?.records.length ?? 0} records</p>
  <label
    >Batch zone layout<select bind:value={zone} disabled={busy}
      ><option value="all">Fill all zones by page</option>{#each document.media.zones ?? [] as item}<option
          value={item.id}>Only {item.name}</option
        >{/each}</select
    ></label
  >{#if placements.length}<p class="placements">
      {placements
        .slice(0, 8)
        .map((item) => `#${item.record + 1}→page ${item.page + 1}/${item.zone}`)
        .join(' · ')}
    </p>{:else if document.template?.records.length}<p>Add a media zone to define batch placement.</p>{/if}<label
    >Copies per record<input type="number" min="1" max="100" bind:value={copies} disabled={busy} /></label
  >{#if document.media.shape === 'continuous'}{#if continuousPrinterUnsupported}<p class="summary invalid">
        The selected printer is not qualified for continuous-media printing.
      </p>{/if}{#if printer?.continuousMedia?.automaticCutter}<label
        >Batch cutting<select bind:value={continuous.cutMode} disabled={busy}
          >{#each printer.continuousMedia.cutModes.filter((mode) => mode !== 'after-job' || (!!route?.printBatch && route.supportsNativeBatch !== false)) as mode}<option
              value={mode}
              >{mode === 'after-each'
                ? 'After each label'
                : mode === 'after-job'
                  ? 'After complete batch'
                  : 'Do not cut'}</option
            >{/each}</select
        ></label
      >{/if}<button onclick={calculate} disabled={busy || calculating || !document.template?.records.length}
      >{calculating ? 'Calculating…' : 'Calculate roll lengths'}</button
    >{#if lengthRows.length}<div class="mb-table-wrap">
        <table>
          <thead><tr><th>Record</th><th>Length</th><th>Status</th></tr></thead><tbody
            >{#each lengthRows as row}<tr class:invalid={!row.valid}
                ><td>{row.record + 1}</td><td>{row.length === undefined ? '—' : `${row.length.toFixed(1)} mm`}</td><td
                  >{row.status}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>
      {@const valid = lengthRows.filter((row) => row.length !== undefined)}{#if valid.length}{@const mediaLength =
          valid.reduce((sum, row) => sum + row.length!, 0) * copies}{@const requiredFeedLength =
          requiredFeedPerLabel * valid.length * copies}{@const operatorFeedLength =
          operatorFeedPerLabel * valid.length * copies}
        <p class="summary">
          Min {Math.min(...valid.map((row) => row.length!)).toFixed(1)} mm · max {Math.max(
            ...valid.map((row) => row.length!),
          ).toFixed(1)} mm · average {(valid.reduce((sum, row) => sum + row.length!, 0) / valid.length).toFixed(1)} mm · media
          {mediaLength.toFixed(1)} mm + required SDK feed {requiredFeedLength.toFixed(1)} mm + extra operator feed {operatorFeedLength.toFixed(
            1,
          )} mm = estimated consumption {(mediaLength + requiredFeedLength + operatorFeedLength).toFixed(1)} mm
        </p>{/if}{/if}{/if}<button onclick={pdf} disabled={busy || invalidLengths}>Export batch PDF</button><button
    onclick={print}
    disabled={busy ||
      invalidLengths ||
      continuousPrinterUnsupported ||
      !route ||
      !printer ||
      !document.template?.records.length}
    title={continuousPrinterUnsupported ? 'The selected printer is not qualified for continuous media.' : undefined}
    >Print batch</button
  >{#if busy && controller}<button onclick={() => controller?.abort()}>Stop batch</button>{/if}
  <p aria-live="polite">{status}</p>
</Panel>

<style>
  label {
    display: flex;
    flex-direction: column;
    font-size: var(--mble-text-small);
  }
  .placements,
  .summary {
    font-size: var(--mble-text-micro);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--mble-text-micro);
    margin: 0.5rem 0;
  }
  th,
  td {
    text-align: left;
    padding: 0.25rem;
    border-bottom: 1px solid var(--mble-border);
  }
  tr.invalid {
    color: var(--mble-danger);
  }
</style>
