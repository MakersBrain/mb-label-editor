<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { LocalApiBrotherReport, LocalApiBrotherWifiScan, LocalApiBrotherWifiStatus, LocalApiConnection, LocalApiDiscoveryCandidate, LocalApiPrinterOperation, LocalApiPrintRoute } from '../print/local-api.js';

  export let route: LocalApiPrintRoute;
  export let onToken: (token: string) => void = () => {};
  export let onConnection: (connection: LocalApiConnection | undefined) => void = () => {};
  export let selectedId = '';
  export let paired = false;

  let secret = '';
  let status = '';
  let liveStatus = '';
  let connections: LocalApiConnection[] = [];
  let connectionId = 'brother-network';
  let model = 'ql-1110nwb';
  let ippUri = 'ipps://brother.local:631/ipp/print';
  let certificatePem = '';
  let candidates: LocalApiDiscoveryCandidate[] = [];
  let diagnosticTask = '';
  let diagnosticStatus = '';
  let wifi: LocalApiBrotherWifiStatus | undefined;
  let scan: LocalApiBrotherWifiScan | undefined;
  let report: LocalApiBrotherReport | undefined;
  $: selectedConnection = connections.find((item) => item.id === selectedId);

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
    clearDiagnostics();
  }

  async function discover() {
    if (!paired) { status = 'Pair with the local service before discovering printers.'; return; }
    diagnosticTask = 'discover'; diagnosticStatus = 'Discovering local printers…';
    try {
      const result = await route.discover();
      candidates = result.devices;
      diagnosticStatus = candidates.length ? `${candidates.length} local printer candidate(s) found.` : 'No local printer candidates found.';
    } catch (error) { diagnosticStatus = message(error); }
    finally { diagnosticTask = ''; }
  }

  async function readWifiStatus() {
    if (!selectedConnection || !supports('wifi-status')) return;
    diagnosticTask = 'wifi-status'; diagnosticStatus = 'Reading Brother Wi-Fi status…'; wifi = undefined;
    try { wifi = await route.brotherWifiStatus(selectedConnection.id); diagnosticStatus = 'Brother Wi-Fi status updated.'; }
    catch (error) { diagnosticStatus = message(error); }
    finally { diagnosticTask = ''; }
  }

  async function scanWifi() {
    if (!selectedConnection || !supports('wifi-scan')) return;
    diagnosticTask = 'wifi-scan'; diagnosticStatus = 'Scanning Wi-Fi networks…'; scan = undefined;
    try { scan = await route.brotherWifiScan(selectedConnection.id); diagnosticStatus = `${scan.accessPoints.length} Wi-Fi network(s) found.`; }
    catch (error) { diagnosticStatus = message(error); }
    finally { diagnosticTask = ''; }
  }

  async function readReport() {
    if (!selectedConnection || !supports('system-report')) return;
    diagnosticTask = 'system-report'; diagnosticStatus = 'Reading redacted Brother system report…'; report = undefined;
    try { report = await route.brotherReport(selectedConnection.id); diagnosticStatus = 'Redacted Brother system report loaded.'; }
    catch (error) { diagnosticStatus = message(error); }
    finally { diagnosticTask = ''; }
  }

  function supports(operation: LocalApiPrinterOperation) { return selectedConnection?.operations?.includes(operation) ?? false; }
  function clearDiagnostics() { wifi = undefined; scan = undefined; report = undefined; diagnosticStatus = ''; }
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);

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
    <legend>Discover local printers</legend>
    <button on:click={discover} disabled={!paired || !!diagnosticTask}>{diagnosticTask === 'discover' ? 'Discovering…' : 'Discover'}</button>
    {#if !paired}<p>Pair with the local service to enable discovery.</p>{/if}
    {#if candidates.length}
      <ul aria-label="Discovered printer candidates">
        {#each candidates as candidate}
          <li><strong>{candidate.name ?? candidate.address}</strong><span>{candidate.transport} · {candidate.address}{candidate.matchedModel ? ` · ${candidate.matchedModel}` : ''}</span></li>
        {/each}
      </ul>
    {/if}
  </fieldset>

  {#if selectedConnection && (supports('wifi-status') || supports('wifi-scan') || supports('system-report'))}
    <fieldset>
      <legend>Brother diagnostics</legend>
      <div class="row diagnostics">
        {#if supports('wifi-status')}<button on:click={readWifiStatus} disabled={!!diagnosticTask}>{diagnosticTask === 'wifi-status' ? 'Reading…' : 'Wi-Fi status'}</button>{/if}
        {#if supports('wifi-scan')}<button on:click={scanWifi} disabled={!!diagnosticTask}>{diagnosticTask === 'wifi-scan' ? 'Scanning…' : 'Scan Wi-Fi'}</button>{/if}
        {#if supports('system-report')}<button on:click={readReport} disabled={!!diagnosticTask}>{diagnosticTask === 'system-report' ? 'Reading…' : 'Redacted report'}</button>{/if}
      </div>
      {#if wifi}
        <dl aria-label="Brother Wi-Fi status">
          <dt>Connected</dt><dd>{wifi.status.connected ? 'yes' : 'no'}</dd>
          {#if wifi.status.ipAddress}<dt>IP address</dt><dd>{wifi.status.ipAddress}</dd>{/if}
          {#if wifi.status.ssid}<dt>SSID</dt><dd>{wifi.status.ssid}</dd>{/if}
          {#if wifi.status.encryption}<dt>Encryption</dt><dd>{wifi.status.encryption}</dd>{/if}
          {#if wifi.status.authentication}<dt>Authentication</dt><dd>{wifi.status.authentication}</dd>{/if}
        </dl>
      {/if}
      {#if scan}
        <ul aria-label="Brother Wi-Fi networks">
          {#each scan.accessPoints as accessPoint}
            <li><strong>{accessPoint.ssid}</strong><span>channel {accessPoint.channel ?? 'unknown'} · power {accessPoint.power ?? 'unknown'} · {accessPoint.encrypted ? 'encrypted' : 'open'}{accessPoint.enterprise ? ' · enterprise' : ''}</span></li>
          {/each}
        </ul>
      {/if}
      {#if report}
        <div class="report" aria-label="Redacted Brother system report">
          <strong>Redacted report</strong>
          {#each Object.entries(report.sections) as [section, values]}
            <details><summary>{section}</summary><dl>{#each Object.entries(values) as [key, value]}<dt>{key}</dt><dd>{value}</dd>{/each}</dl></details>
          {/each}
        </div>
      {/if}
    </fieldset>
  {/if}

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
  {#if diagnosticStatus}<p class="live" aria-live="polite">{diagnosticStatus}</p>{/if}
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
  ul{display:flex;flex-direction:column;gap:.35rem;margin:.25rem 0;padding:0;list-style:none}li{display:flex;flex-direction:column;gap:.1rem;padding:.35rem;background:var(--mble-surface-muted,#f5f3ef);font-size:.72rem;overflow-wrap:anywhere}li span{color:var(--mble-text-muted,#59635e)}
  dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.2rem .55rem;margin:.35rem 0;font-size:.72rem}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.diagnostics{justify-content:flex-start}.report details{margin-top:.3rem}.report summary{cursor:pointer;font-size:.72rem;font-weight:600}
  @media(max-width:36rem){.row,.grid{align-items:stretch;flex-direction:column}.row button{align-self:stretch}}
</style>
