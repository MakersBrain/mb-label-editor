<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { CloudPrintClient, CloudPrintJob, CloudPrinter } from '../cloud-print/client.js';
  import type { CloudPrintRoute } from '../print/cloud.js';
  import type { LabelDocument } from '../model.js';
  import type { PrinterDefinition } from '../print/types.js';

  export let client: CloudPrintClient;
  export let route: CloudPrintRoute;
  export let document: LabelDocument;
  export let printer: PrinterDefinition | undefined;
  export let selectedId = '';
  export let onPrinter: (printer: CloudPrinter | undefined) => void = () => {};

  let printers: CloudPrinter[] = [];
  let current: CloudPrintJob | undefined;
  let status = '';
  let busy = false;
  let printing = false;
  let cancelling = false;
  $: selectedPrinter = printers.find(item => item.id === selectedId);

  onMount(() => {
    const unsubscribe = route.controller.subscribe(job => current = job);
    void refresh();
    return unsubscribe;
  });

  async function refresh() {
    busy = true;
    try {
      printers = await client.listPrinters();
      const item = printers.find(value => value.id === selectedId);
      if (!item && selectedId) selectedId = '';
      onPrinter(item);
      status = printers.length ? `${printers.length} cloud printer(s) available.` : 'No printers are published for this tenant.';
    } catch (error) { status = message(error); }
    finally { busy = false; }
  }

  function choose(id: string) {
    selectedId = id;
    onPrinter(printers.find(item => item.id === id));
  }

  async function print() {
    if (!printer) { status = 'The selected cloud printer model is not supported by this editor.'; return; }
    printing = true;
    status = selected()?.online ? 'Submitting cloud print…' : 'Queueing cloud print for an offline printer…';
    try {
      const result = await route.print({ document, printer, copies: 1 });
      status = result.outcome === 'completed' ? `Printed ${result.bytesSent} bytes.` : `${result.outcome}: ${result.error ?? 'Inspect the printer before retrying.'}`;
    } catch (error) { status = message(error); }
    finally { printing = false; }
  }

  async function cancel() {
    if (!current) return;
    cancelling = true;
    try { current = await route.controller.cancel(current.id); status = `Cancellation requested: ${current.state}.`; }
    catch (error) { status = message(error); }
    finally { cancelling = false; }
  }

  const selected = () => printers.find(item => item.id === selectedId);
  const terminal = (value: CloudPrintJob | undefined) => !!value && ['completed', 'failed', 'cancelled-before-send', 'cancelled-partial', 'outcome-unknown'].includes(value.terminalOutcome ?? value.state);
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
</script>

<section>
  <h2>Cloud printers</h2>
  <div class="row">
    <label>Published printer
      <select bind:value={selectedId} on:change={event => choose(event.currentTarget.value)}>
        <option value="">Select a cloud printer</option>
        {#each printers as item}
          <option value={item.id}>{item.displayName} · {item.model} · {item.enabled ? (item.online ? 'Online' : 'Offline') : 'Disabled'}</option>
        {/each}
      </select>
    </label>
    <button on:click={refresh} disabled={busy}>Refresh</button>
  </div>
  {#if selectedPrinter}
    <p class:warning={!selectedPrinter.online || !selectedPrinter.enabled}><strong>{selectedPrinter.displayName}</strong> · {selectedPrinter.model} · {selectedPrinter.enabled ? (selectedPrinter.online ? 'Online' : 'Offline — this label will queue') : 'Disabled'}</p>
    {#if selectedPrinter.model !== printer?.id}<p class="warning">Unsupported or mismatched printer model. Select the matching SDK model before printing.</p>{/if}
    <button on:click={print} disabled={printing || !selectedPrinter.enabled || selectedPrinter.model !== printer?.id}>{selectedPrinter.online ? 'Print current label' : 'Queue current label'}</button>
  {/if}
  {#if current}
    <dl><dt>Job</dt><dd>{current.id}</dd><dt>State</dt><dd>{current.terminalOutcome ?? current.state}</dd><dt>Progress</dt><dd>{current.bytesSent}/{current.totalBytes} bytes</dd></dl>
    {#if !terminal(current)}<button on:click={cancel} disabled={cancelling}>Cancel job</button>{/if}
    {#if current.writeMayHaveOccurred && ['failed','cancelled-partial','outcome-unknown'].includes(current.terminalOutcome ?? current.state)}<p class="warning">The printer may have produced output. Inspect it before printing again.</p>{/if}
  {/if}
  <p aria-live="polite">{status}</p>
</section>

<style>
  section{padding:.7rem .75rem;border-top:1px solid var(--mble-border,#e5dfd5)}h2{margin:0 0 .5rem;color:var(--mble-text-muted,#59635e);font-size:.75rem;font-weight:600}.row{display:flex;align-items:end;gap:.5rem}.row label{flex:1}label{display:flex;flex-direction:column;gap:.2rem;font-size:.75rem}select{box-sizing:border-box;max-width:100%;font:inherit}p,dl{font-size:.75rem}.warning{color:var(--mble-danger,#a21)}dl{display:grid;grid-template-columns:auto 1fr;gap:.15rem .6rem}dt{color:var(--mble-text-muted,#59635e)}dd{margin:0;overflow-wrap:anywhere}@media(max-width:36rem){.row{align-items:stretch;flex-direction:column}}
</style>
