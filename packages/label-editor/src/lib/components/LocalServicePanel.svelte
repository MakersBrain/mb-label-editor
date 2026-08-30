<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { LocalApiConnection, LocalApiPrintRoute } from '../print/local-api.js';

  export let route: LocalApiPrintRoute;
  export let onToken: (token: string) => void = () => {};
  export let onConnection: (connection: LocalApiConnection | undefined) => void = () => {};
  export let selectedId = '';

  let secret = '';
  let status = '';
  let liveStatus = '';
  let connections: LocalApiConnection[] = [];
  let connectionId = 'brother-network';
  let model = 'ql-1110nwb';
  let ippUri = 'ipps://brother.local:631/ipp/print';
  let certificatePem = '';

  async function pair() {
    try {
      status = 'Requesting Local Network Access and pairing…';
      const grant = await route.pair(secret);
      onToken(grant.token);
      secret = '';
      status = `Paired until ${new Date(grant.expiresAt).toLocaleString()}.`;
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = /Failed to fetch|NetworkError/i.test(message)
        ? 'Local service unavailable or Local Network Access was denied. Allow local network access, start mb-printer api, then retry.'
        : message;
    }
  }

  async function refresh() {
    try {
      connections = await route.connections();
      const selected = connections.find((item) => item.id === selectedId);
      onConnection(selected);
      status = connections.length
        ? `${connections.length} persisted connection(s) available.`
        : 'No persisted printer connection. Add an IPP/IPPS printer below.';
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  function choose() {
    const selected = connections.find((item) => item.id === selectedId);
    onConnection(selected);
    liveStatus = selected ? describe(selected.status, selected.media) : '';
  }

  async function configureIpp() {
    try {
      status = 'Probing the IPP/IPPS printer…';
      const configured = await route.configureConnection({
        id: connectionId.trim(),
        model: model.trim(),
        transport: {
          kind: 'ipp',
          uri: ippUri.trim(),
          ...(certificatePem.trim() ? { certificatePem: certificatePem.trim() } : {})
        }
      });
      connections = [...connections.filter((item) => item.id !== configured.id), configured];
      selectedId = configured.id;
      onConnection(configured);
      liveStatus = describe(configured.status, configured.media);
      status = `Saved and selected ${configured.id}.`;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function inspect() {
    if (!selectedId) return;
    try {
      liveStatus = 'Checking printer…';
      const current = await route.connectionStatus(selectedId);
      const updated = { ...current.connection, status: current.status, media: current.media };
      connections = connections.map((item) => item.id === updated.id ? updated : item);
      onConnection(updated);
      liveStatus = current.connected
        ? describe(current.status, current.media)
        : `Unavailable · last known ${describe(current.connection.status, current.media)}`;
    } catch (error) {
      liveStatus = error instanceof Error ? error.message : String(error);
    }
  }

  function describe(printerStatus: string, media: unknown) {
    if (!media || typeof media !== 'object') return printerStatus;
    const value = media as Record<string, unknown>;
    const size = value.widthMm ? `${value.widthMm} × ${value.lengthMm ?? 'continuous'} mm` : undefined;
    const reasons = Array.isArray(value.reasons) ? value.reasons.join(', ') : undefined;
    return [printerStatus, value.makeAndModel, value.keyword ?? size, reasons].filter(Boolean).join(' · ');
  }
</script>

<section>
  <h2>Local service</h2>
  <div class="row">
    <label>One-time pairing secret<input type="password" bind:value={secret} autocomplete="off"></label>
    <button on:click={pair} disabled={!secret}>Pair on localhost</button>
  </div>
  <div class="row">
    <label class="grow">Printer connection
      <select bind:value={selectedId} on:change={choose}>
        <option value="">Select a connection</option>
        {#each connections as connection}
          <option value={connection.id}>{connection.id} · {connection.model} · {connection.transport.kind} · {connection.status}</option>
        {/each}
      </select>
    </label>
    <button on:click={refresh}>Refresh</button>
    <button on:click={inspect} disabled={!selectedId}>Check status</button>
  </div>
  {#if liveStatus}<p class="live" aria-live="polite">{liveStatus}</p>{/if}

  <fieldset>
    <legend>Add a network printer using IPP/IPPS</legend>
    <div class="grid">
      <label>Connection name<input bind:value={connectionId} placeholder="brother-network"></label>
      <label>Printer model ID<input bind:value={model} placeholder="ql-1110nwb"></label>
    </div>
    <label>Printer URI<input bind:value={ippUri} spellcheck="false" placeholder="ipps://brother.local:631/ipp/print"></label>
    <label>Trusted certificate PEM (optional)
      <textarea bind:value={certificatePem} spellcheck="false" rows="3" placeholder="Leave blank for normal system certificate trust"></textarea>
    </label>
    <button on:click={configureIpp} disabled={!connectionId.trim() || !model.trim() || !ippUri.trim()}>Probe, save, and select</button>
    <p>Use <code>ipps://</code> for encrypted printing. A private or self-signed printer certificate must be supplied explicitly and must match the printer hostname.</p>
  </fieldset>
  <p>Printing is enabled only after the service has probed and persisted a physical printer connection.</p>
  <p aria-live="polite">{status}</p>
</section>

<style>
  section{padding:.7rem .75rem;border-top:1px solid var(--mble-border,#e5dfd5)}
  h2{margin:0 0 .5rem;color:var(--mble-text-muted,#59635e);font-size:.75rem;font-weight:600}
  label{display:flex;flex:1;flex-direction:column;gap:.2rem;font-size:.75rem}
  input,select,textarea{box-sizing:border-box;max-width:100%;font:inherit}
  textarea{resize:vertical}
  button{align-self:end}
  p{font-size:.72rem}
  fieldset{display:flex;flex-direction:column;gap:.5rem;margin:.75rem 0 0;padding:.65rem;border:1px solid var(--mble-border,#e5dfd5)}
  legend{font-size:.75rem;font-weight:600}
  .row,.grid{display:flex;align-items:end;gap:.5rem}
  .grow{flex:1}
  .live{padding:.4rem;background:var(--mble-surface-muted,#f5f3ef);overflow-wrap:anywhere}
  @media(max-width:36rem){.row,.grid{align-items:stretch;flex-direction:column}.row button{align-self:stretch}}
</style>
