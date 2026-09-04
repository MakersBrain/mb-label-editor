<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { onMount } from 'svelte';
  import { BrandLockup } from '@makersbrain/ui/svelte';
  import {
    BatchPanel,
    CloudPrintClient,
    CloudPrintPanel,
    CloudPrintRoute,
    DirectPrintPanel,
    ExternalResourceConnectionManager,
    ExternalResourceConnectionsPanel,
    JobRecoveryPanel,
    JobJournal,
    LabelEditor,
    LaPostePanel,
    LocalServicePanel,
    SheetPanel,
    assetCatalogProviderFactory,
    createEditorStore,
    defaultDocument,
    downloadBytes,
    EditorDatabase,
    createAutosaver,
    openDocument,
    prepareDocumentForOutput,
    printableBoundsForResizedMedia,
    saveDocument,
    serializeDocument,
    LocalApiPrintRoute,
    Modal,
    Menu,
    updateDocument,
    validateContinuousMedia,
    type CloudPrinter,
    type ContinuousMediaLimits,
    type LabelDocument,
    type ContinuousPrintOptions,
    type ExternalResourceConnection,
    type ExternalResourceProvider,
    type LocalApiConnection,
    type PrinterDefinition,
    type PrintProgress,
    type PrintRoute,
    type SheetFillOrder,
    type SheetLayoutPreset,
    type SheetPreferencesV1,
  } from '@makersbrain/label-editor';
  import { loadPrinterSdk, sdkBuildLabel } from './sdk.js';
  const resourceConnectionsKey = 'mb-external-resource-connections-v1';
  const selectedResourceKey = 'mb-external-resource-selected-v1';
  const legacyAssetUrl =
    localStorage.getItem('mb-asset-catalog-url') ?? import.meta.env.VITE_ASSET_CATALOG_URL ?? 'http://127.0.0.1:8766';
  const initialResourceConnections =
    readResourceConnections() ??
    (legacyAssetUrl
      ? [
          {
            version: 1 as const,
            id: 'default-asset-catalog',
            name: 'MakersBrain assets',
            providerKind: 'mbprint-asset-catalog',
            endpoint: legacyAssetUrl,
            enabled: true,
          },
        ]
      : []);
  const resourceManager = new ExternalResourceConnectionManager(
    [assetCatalogProviderFactory],
    initialResourceConnections,
    localStorage.getItem(selectedResourceKey) ?? '',
  );
  const legacyAssetToken = localStorage.getItem('mb-asset-catalog-token') ?? '';
  if (legacyAssetToken && resourceManager.selectedId())
    resourceManager.setSessionToken(resourceManager.selectedId(), legacyAssetToken);
  localStorage.removeItem('mb-asset-catalog-token');
  localStorage.removeItem('mb-asset-catalog-url');
  localStorage.setItem(resourceConnectionsKey, JSON.stringify(resourceManager.connections()));
  const editor = createEditorStore(defaultDocument());
  const database = new EditorDatabase();
  let status = $state('Ready');
  let savedDocument = $state.raw<LabelDocument | undefined>();
  const autosave = createAutosaver(
    database,
    1500,
    (error) => (status = `Autosave unavailable: ${message(error)}`),
    5000,
    (document) => (savedDocument = document),
  );
  let sdk = $state.raw<Awaited<ReturnType<typeof loadPrinterSdk>> | undefined>();
  let printers = $state.raw<PrinterDefinition[]>([]);
  let printerId = $state('');
  let progress = $state.raw<PrintProgress | undefined>();
  let apiToken = $state.raw(localStorage.getItem('mb-local-api-token') ?? '');
  let resourceProvider = $state.raw<ExternalResourceProvider | undefined>(resourceManager.selected());
  let connectionId = $state.raw(localStorage.getItem('mb-local-api-connection') ?? '');
  let localConnection = $state.raw<LocalApiConnection | undefined>();
  let cloudUrl = $state.raw(localStorage.getItem('mb-cloud-print-url') ?? '');
  let cloudTenant = $state.raw(localStorage.getItem('mb-cloud-print-tenant') ?? '');
  let cloudToken = $state('');
  let cloudPrinterId = $state.raw(localStorage.getItem('mb-cloud-print-printer') ?? '');
  let cloudPrinter = $state.raw<CloudPrinter | undefined>();
  let cloudClient = $state.raw<CloudPrintClient | undefined>();
  let cloudRoute = $state.raw<CloudPrintRoute | undefined>();
  let directRoute = $state.raw<PrintRoute | undefined>();
  let handle = $state.raw<unknown>();
  let online = $state.raw(navigator.onLine);
  let theme = $state<'system' | 'light' | 'dark'>('system');
  let defaultRoute = $state('local-api');
  let sheet = $state.raw<SheetPreferencesV1 | undefined>();
  let updateAvailable = $state(false);
  const localRoute = new LocalApiPrintRoute({
    token: () => apiToken,
    connection: () => localConnection,
    journal: new JobJournal(database),
  });
  let selectedRoute = $state.raw<PrintRoute>(localRoute);
  let printing = $state(false);
  const defaultContinuousPrint: ContinuousPrintOptions = {
    cutMode: 'after-each',
    extraFeedBeforeMm: 0,
    extraFeedAfterMm: 0,
    chainCopies: false,
  };
  let continuousPrint = $state.raw<ContinuousPrintOptions>({ ...defaultContinuousPrint });
  let continuousPrintByPrinter = $state.raw<Record<string, ContinuousPrintOptions>>({});
  let continuousPrintPrinterId = $state('');
  const selectedPrinterDefinition = $derived(printers.find((item) => item.id === printerId));
  $effect(() => {
    const id = printerId;
    untrack(() => syncContinuousPrintPrinter(id));
  });
  const outputSettingsError = $derived(continuousSettingsError(editor.document, selectedPrinterDefinition));
  const printAvailable = $derived(
    !!selectedPrinterDefinition &&
      (selectedRoute.id === 'local-api'
        ? !!localConnection && localConnection.model === selectedPrinterDefinition.id
        : selectedRoute.id === 'cloud-api'
          ? !!cloudPrinter?.enabled && cloudPrinter.model === selectedPrinterDefinition.id
          : !!directRoute),
  );
  const primaryPrintLabel = $derived(
    selectedRoute.id === 'cloud-api' && !cloudPrinter?.online ? 'Queue print' : 'Print',
  );
  onMount(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;
    const update = () => (updateAvailable = true);
    window.addEventListener('mb-pwa-update', update);
    void start().then((value) => {
      if (disposed) value();
      else unsubscribe = value;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      window.removeEventListener('mb-pwa-update', update);
      void autosave.dispose();
    };
  });
  let dialog = $state('');
  async function restoreAutosave() {
    try {
      const recovered = await database.latestAutosave();
      if (recovered) {
        editor.replace(recovered.document);
        rememberRecent(recovered.document.id);
        status = `Recovered autosave from ${new Date(recovered.savedAt).toLocaleTimeString()}`;
      }
    } catch (error) {
      status = `Autosave recovery unavailable: ${message(error)}`;
    }
  }
  async function restorePreferences() {
    try {
      const preferences = await database.getPreferences();
      if (preferences) {
        editor.setView({
          gridSize: preferences.gridSize,
          showGrid: preferences.showGrid,
          showRulers: preferences.showRulers,
          snapping: preferences.snapping,
        });
        printerId = preferences.defaultPrinterId ?? printerId;
        theme = preferences.theme;
        defaultRoute = preferences.defaultRoute ?? defaultRoute;
        sheet = preferences.sheet?.version === 1 ? preferences.sheet : undefined;
        continuousPrintByPrinter = continuousPrintPreferences(
          preferences.continuousPrint,
          preferences.defaultPrinterId,
        );
        continuousPrintPrinterId = '';
        syncContinuousPrintPrinter(printerId);
        applyTheme();
      }
    } catch (error) {
      status = `Preferences unavailable: ${message(error)}`;
    }
  }
  function preferences() {
    return {
      gridSize: editor.view.gridSize,
      showGrid: editor.view.showGrid,
      showRulers: editor.view.showRulers,
      snapping: editor.view.snapping,
      defaultPrinterId: printerId || undefined,
      defaultRoute,
      theme,
      sheet,
      continuousPrint: continuousPrintByPrinter,
    };
  }
  function applyTheme() {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }
  function persistPreferences() {
    database.savePreferences(preferences()).catch(report('Preferences not saved'));
  }
  const report = (label: string) => (error: unknown) => {
    status = `${label}: ${message(error)}`;
  };
  function debounced<A extends unknown[]>(ms: number, run: (...args: A) => unknown) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const call = (...args: A) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        run(...args);
      }, ms);
    };
    call.cancel = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    return call;
  }
  function rememberRecent(id: string) {
    database
      .saveRecent({ id, kind: 'document', openedAt: new Date().toISOString() })
      .catch(report('Recent list not updated'));
  }
  // Persistence follows the editor's fine-grained state once preferences and the autosave are restored; each concern tracks only what it writes.
  let persistenceArmed = $state(false);
  const saveState = $derived(!persistenceArmed ? '' : editor.document === savedDocument ? 'Saved' : 'Unsaved changes');
  let lastView = '';
  let lastTemplate: LabelDocument['template'];
  const preferencesSaver = debounced(1000, () =>
    database.savePreferences(preferences()).catch(report('Preferences not saved')),
  );
  const templateSaver = debounced(1500, (id: string, template: NonNullable<LabelDocument['template']>) =>
    database.saveTemplate(id, template).catch(report('Records not saved')),
  );
  $effect(() => {
    if (!persistenceArmed) return;
    const document = editor.document;
    untrack(() => autosave(document));
  });
  $effect(() => {
    if (!persistenceArmed) return;
    const id = editor.document.id;
    const template = editor.document.template;
    if (template && template !== lastTemplate) {
      lastTemplate = template;
      untrack(() => templateSaver(id, template));
    }
  });
  $effect(() => {
    if (!persistenceArmed) return;
    const view = JSON.stringify([
      editor.view.gridSize,
      editor.view.showGrid,
      editor.view.showRulers,
      editor.view.snapping,
    ]);
    if (view !== lastView) {
      const initial = !lastView;
      lastView = view;
      if (!initial) untrack(preferencesSaver);
    }
  });
  async function start() {
    await restorePreferences();
    await restoreAutosave();
    persistenceArmed = true;
    void ensureSdk().catch((error) => (status = message(error)));
    return () => {
      preferencesSaver.cancel();
      templateSaver.cancel();
    };
  }
  async function open(event?: Event) {
    try {
      const file = (event?.currentTarget as HTMLInputElement)?.files?.[0];
      const loaded = await ensureSdk();
      const opened = await openDocument(file, loaded);
      editor.replace(opened.document);
      rememberRecent(opened.document.id);
      handle = opened.handle;
      status = `Opened ${opened.document.title}`;
    } catch (error) {
      status = message(error);
    }
  }
  async function save() {
    try {
      const prepared = await prepareCurrent(true);
      handle = await saveDocument(prepared.document, undefined, handle as never);
      await database.saveDocument(editor.document);
      status = 'Saved';
    } catch (error) {
      status = message(error);
    }
  }
  async function exportJson() {
    try {
      const prepared = await prepareCurrent(true);
      const filename = `${editor.document.title}.mb-label.json`;
      downloadBytes(new TextEncoder().encode(serializeDocument(prepared.document)), {
        filename,
        mimeType: 'application/json',
      });
      status = 'Exported JSON.';
    } catch (error) {
      status = message(error);
    }
  }
  async function ensureSdk() {
    if (!sdk) {
      if (status === 'Ready') status = 'Loading printer SDK…';
      sdk = await loadPrinterSdk((event) => {
        if (event.outcome === 'failed') status = `Sheet ${event.operation} failed (${event.errorCode ?? 'unknown'}).`;
        else if (event.operation === 'export') status = `Sheet PDF built in ${Math.round(event.durationMs)} ms.`;
      });
      printers = await sdk.printerDefinitions();
    }
    return sdk;
  }
  async function prepareCurrent(preserveTemplateSource = false, printer = selectedPrinterDefinition) {
    const loaded = await ensureSdk();
    return await prepareDocumentForOutput(
      editor.document,
      { materializer: loaded, measurer: loaded },
      { limits: outputLimits(printer), preserveTemplateSource },
    );
  }
  function outputLimits(printer: PrinterDefinition | undefined): ContinuousMediaLimits {
    return printer
      ? {
          minimumLengthMm: printer.continuousMedia?.minimumLengthMm ?? printer.media.minHeight,
          maximumLengthMm: printer.continuousMedia?.maximumLengthMm ?? printer.media.maxHeight,
          source: 'printer',
          printerModel: printer.id,
        }
      : { minimumLengthMm: 0.1, maximumLengthMm: 1000, source: 'generic-export' };
  }
  function continuousSettingsError(
    document: import('@makersbrain/label-editor').LabelDocument,
    printer: PrinterDefinition | undefined,
  ) {
    try {
      validateContinuousMedia(document, outputLimits(printer));
      return '';
    } catch (error) {
      return message(error);
    }
  }
  function selectPrinter(id: string) {
    printerId = id;
    persistPreferences();
    status = id
      ? `Selected ${printers.find((item) => item.id === id)?.displayName ?? id}. Connect it in the printer panel.`
      : 'Select a printer model.';
  }
  function syncContinuousPrintPrinter(id: string) {
    if (continuousPrintPrinterId === id) return;
    continuousPrintPrinterId = id;
    continuousPrint = { ...(continuousPrintByPrinter[id] ?? defaultContinuousPrint) };
  }
  function acceptContinuousPrint(value: ContinuousPrintOptions) {
    continuousPrint = { ...value };
    if (printerId) continuousPrintByPrinter = { ...continuousPrintByPrinter, [printerId]: { ...value } };
    persistPreferences();
  }
  function continuousPrintPreferences(
    value: unknown,
    legacyPrinterId?: string,
  ): Record<string, ContinuousPrintOptions> {
    if (isContinuousPrintOptions(value)) return legacyPrinterId ? { [legacyPrinterId]: value } : {};
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, ContinuousPrintOptions] => isContinuousPrintOptions(entry[1]))
        .map(([id, options]) => [id, { ...options }]),
    );
  }
  function isContinuousPrintOptions(value: unknown): value is ContinuousPrintOptions {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<ContinuousPrintOptions>;
    return (
      ['after-each', 'after-job', 'none'].includes(item.cutMode ?? '') &&
      Number.isFinite(item.extraFeedBeforeMm) &&
      Number.isFinite(item.extraFeedAfterMm) &&
      typeof item.chainCopies === 'boolean'
    );
  }
  async function preview() {
    try {
      const loaded = await ensureSdk();
      const prepared = await prepareCurrent();
      const raster = await loaded.render(prepared.document, { exactThermal: true });
      status = `Thermal preview: ${raster.width} × ${raster.height} dots`;
    } catch (error) {
      status = message(error);
    }
  }
  async function exportFile(kind: 'png' | 'pdf') {
    try {
      const loaded = await ensureSdk();
      const prepared = await prepareCurrent();
      const data =
        kind === 'png' ? await loaded.exportPng(prepared.document) : await loaded.exportPdf([prepared.document]);
      downloadBytes(data, { filename: `label.${kind}`, mimeType: kind === 'png' ? 'image/png' : 'application/pdf' });
      status = `Exported ${kind.toUpperCase()}.`;
    } catch (error) {
      status = message(error);
    }
  }
  async function print() {
    if (printing) return;
    printing = true;
    try {
      await ensureSdk();
      const printer = printers.find((item) => item.id === printerId);
      if (!printer) throw new Error('Select a printer model.');
      const prepared = await prepareCurrent(false, printer);
      status = selectedRoute.id === 'cloud-api' && !cloudPrinter?.online ? 'Queueing cloud print…' : 'Printing…';
      progress = undefined;
      const modes =
        printer.continuousMedia?.cutModes.filter(
          (mode) => mode !== 'after-job' || selectedRoute.supportsNativeBatch !== false,
        ) ?? [];
      const cut = modes.includes(continuousPrint.cutMode)
        ? continuousPrint
        : { ...continuousPrint, cutMode: modes[0] ?? 'none' };
      const result = await selectedRoute.print({
        document: prepared.document,
        printer,
        copies: 1,
        ...(editor.document.media.shape === 'continuous' && printer.continuousMedia ? { continuous: cut } : {}),
        onProgress: (value) => (progress = value),
      });
      status =
        result.outcome === 'completed'
          ? `Printed ${result.bytesSent} bytes`
          : `${result.outcome}: ${result.error ?? 'Check the printer before retrying.'}`;
    } catch (error) {
      status = message(error);
    } finally {
      printing = false;
    }
  }
  function storeToken() {
    localStorage.setItem('mb-local-api-token', apiToken);
    status = 'Local service token stored only in this browser.';
  }
  function storeResourceConnections(connections: ExternalResourceConnection[]) {
    localStorage.setItem(resourceConnectionsKey, JSON.stringify(connections));
  }
  function selectResourceConnection(id: string) {
    resourceManager.select(id);
    const selected = resourceManager.selectedId();
    resourceProvider = resourceManager.selected();
    if (selected) localStorage.setItem(selectedResourceKey, selected);
    else localStorage.removeItem(selectedResourceKey);
    status = resourceProvider
      ? `Using external resources from ${resourceProvider.displayName}.`
      : 'External resources are disabled.';
  }
  function acceptToken(token: string) {
    apiToken = token;
    storeToken();
  }
  function acceptConnection(connection: LocalApiConnection | undefined, announce = true) {
    localConnection = connection;
    connectionId = connection?.id ?? '';
    if (connection) {
      localStorage.setItem('mb-local-api-connection', connection.id);
      printerId = connection.model;
      selectedRoute = localRoute;
      defaultRoute = localRoute.id;
      persistPreferences();
    } else localStorage.removeItem('mb-local-api-connection');
    if (announce)
      status = connection
        ? `Selected ${connection.id} via ${connection.transport.kind}.`
        : 'Select a persisted local printer connection.';
  }
  function acceptRoute(route: PrintRoute) {
    directRoute = route;
    selectedRoute = route;
    defaultRoute = route.id;
    persistPreferences();
  }
  function chooseRoute(id: string) {
    const route = id === 'local-api' ? localRoute : id === 'cloud-api' ? cloudRoute : directRoute;
    if (route) {
      selectedRoute = route;
      defaultRoute = route.id;
      persistPreferences();
    }
  }
  async function connectCloud() {
    try {
      const baseUrl = cloudUrl.trim().replace(/\/+$/, '');
      const tenantId = cloudTenant.trim();
      if (!cloudToken.trim()) throw new Error('Enter the print-only cloud token for this session.');
      const client = new CloudPrintClient({ baseUrl, tenantId, getAccessToken: () => cloudToken });
      await client.listPrinters();
      await client.negotiateCapabilities().catch(() => ({ nativeBatch: false, continuousOptions: false }));
      cloudUrl = baseUrl;
      cloudTenant = tenantId;
      cloudClient = client;
      cloudRoute = new CloudPrintRoute({ client, printer: () => cloudPrinter, journal: new JobJournal(database) });
      localStorage.setItem('mb-cloud-print-url', baseUrl);
      localStorage.setItem('mb-cloud-print-tenant', tenantId);
      selectedRoute = cloudRoute;
      defaultRoute = cloudRoute.id;
      persistPreferences();
      dialog = 'cloud';
      status = 'Cloud print session connected. The token will be forgotten when this page closes.';
    } catch (error) {
      status = message(error);
    }
  }
  function endCloudSession() {
    cloudToken = '';
    cloudClient = undefined;
    cloudRoute = undefined;
    cloudPrinter = undefined;
    if (selectedRoute.id === 'cloud-api') selectedRoute = localRoute;
    status = 'Cloud print token cleared from this session.';
  }
  function acceptCloudPrinter(value: CloudPrinter | undefined) {
    cloudPrinter = value;
    cloudPrinterId = value?.id ?? '';
    if (value) {
      localStorage.setItem('mb-cloud-print-printer', value.id);
      printerId = value.model;
      selectedRoute = cloudRoute ?? selectedRoute;
      status = `Selected cloud printer ${value.displayName}${value.online ? '' : ' (offline; current labels will queue)'}.`;
    } else localStorage.removeItem('mb-cloud-print-printer');
  }
  async function retryRecovered(job: import('@makersbrain/label-editor').PersistedJob) {
    if (job.route === 'cloud-api') {
      if (!cloudRoute) {
        dialog = 'cloud-connect';
        status = 'Reconnect the cloud session to resume this job.';
        return;
      }
      const result = await cloudRoute.recover(job);
      status = `Cloud recovery: ${result.outcome}${result.error ? `: ${result.error}` : ''}.`;
      return;
    }
    if (job.route !== 'local-api') {
      status =
        'Reconnect through Direct browser print to start a new explicit hardware job; the interrupted job was not replayed.';
      return;
    }
    if (!localConnection) {
      status = 'Reconnect the saved local printer before resuming this job.';
      return;
    }
    const result = await localRoute.recover(job, undefined, (value) => (progress = value));
    status = `Local recovery: ${result.outcome}${result.error ? `: ${result.error}` : ''}.`;
  }
  function applyPrinterMedia(media: { width: number; height: number; shape: 'rectangle' | 'round' | 'continuous' }) {
    const next = {
      ...editor.document.media,
      width: media.width,
      height: media.height,
      shape: media.shape,
      printableBounds: printableBoundsForResizedMedia(editor.document.media, media.width, media.height),
    };
    editor.execute(updateDocument({ media: next }));
    status = `Label media set to ${media.width} × ${media.height} mm from the printer.`;
  }
  function rememberSheet(layoutId: string, fillOrder: SheetFillOrder, custom?: NonNullable<SheetLayoutPreset['grid']>) {
    sheet = { version: 1, layoutId, fillOrder, ...(custom ? { lastCustomGrid: custom } : {}) };
    persistPreferences();
  }
  function readResourceConnections(): ExternalResourceConnection[] | undefined {
    try {
      const value = JSON.parse(localStorage.getItem(resourceConnectionsKey) ?? 'null');
      return Array.isArray(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
</script>

<svelte:window ononline={() => (online = true)} onoffline={() => (online = false)} />
<div class="app">
  <LabelEditor
    {editor}
    {sdk}
    materializer={sdk}
    {resourceProvider}
    {printers}
    {printerId}
    onPrinter={selectPrinter}
    {saveState}
  >
    {#snippet brand()}<BrandLockup product="Label Editor" href="./" />{/snippet}
    {#snippet menuStart()}<Menu label="File">
        <button onclick={() => open()}>Open picker</button>
        <label class="file">Upload<input type="file" accept=".mb-label.json,application/json" onchange={open} /></label>
        <button onclick={save} disabled={!!outputSettingsError} title={outputSettingsError || undefined}>Save</button>
        <button onclick={exportJson} disabled={!!outputSettingsError} title={outputSettingsError || undefined}
          >Export JSON</button
        >
        <hr />
        <button onclick={preview} disabled={!!outputSettingsError} title={outputSettingsError || undefined}
          >Thermal preview</button
        >
        <button
          onclick={() => exportFile('png')}
          disabled={!!outputSettingsError}
          title={outputSettingsError || undefined}>Export PNG</button
        >
        <button
          onclick={() => exportFile('pdf')}
          disabled={!!outputSettingsError}
          title={outputSettingsError || undefined}>Export PDF</button
        >
        <hr />
        <label
          >Theme<select
            bind:value={theme}
            onchange={() => {
              applyTheme();
              persistPreferences();
            }}><option>system</option><option>light</option><option>dark</option></select
          ></label
        >
        <label
          >Local API token<input
            class="token"
            type="password"
            bind:value={apiToken}
            onchange={storeToken}
            placeholder="Token"
            aria-label="Local service token"
          /></label
        >
        <hr />
        <button onclick={() => (dialog = 'external-resources')}>External resources…</button>
        {#if updateAvailable}<button onclick={() => location.reload()}>Update application</button>{/if}
      </Menu>{/snippet}
    {#snippet menuEnd()}<Menu label="Print">
        <button
          onclick={print}
          disabled={printing || !printAvailable || !!outputSettingsError}
          title={outputSettingsError || undefined}>{primaryPrintLabel} current label via {selectedRoute.label}</button
        >
        <button onclick={() => (dialog = 'batch')}>Batch printing…</button>
        <button onclick={() => (dialog = 'sheet')}>Label sheet…</button>
        <button onclick={() => (dialog = 'laposte')}>La Poste sheets…</button>
        <hr />
        <button onclick={() => (dialog = 'service')}>Local service…</button>
        <button onclick={() => (dialog = cloudRoute ? 'cloud' : 'cloud-connect')}>Cloud printers…</button>
        {#if cloudRoute}<button onclick={endCloudSession}>End cloud session</button>{/if}
        <button onclick={() => (dialog = 'jobs')}>Recover print jobs…</button>
      </Menu>{/snippet}
    {#snippet actions()}
      <select
        value={selectedRoute.id}
        onchange={(event) => chooseRoute(event.currentTarget.value)}
        aria-label="Print route"
        ><option value="local-api">Local service</option>{#if directRoute}<option value={directRoute.id}
            >Direct browser</option
          >{/if}{#if cloudRoute}<option value="cloud-api">Cloud</option>{/if}</select
      >
      <select
        value={printerId}
        onchange={(event) => selectPrinter(event.currentTarget.value)}
        onfocus={() => void ensureSdk()}
        aria-label="Printer model"
        ><option value="">Printer model</option>{#each printers as printer}<option value={printer.id}
            >{printer.displayName}</option
          >{/each}</select
      >
      <button
        class="primary"
        onclick={print}
        disabled={printing || !printAvailable || !!outputSettingsError}
        title={outputSettingsError || undefined}>{primaryPrintLabel}</button
      >
    {/snippet}
    {#snippet sidebar()}{#if sdk}<DirectPrintPanel
          document={editor.document}
          {sdk}
          materializer={sdk}
          printer={printers.find((item) => item.id === printerId)}
          {database}
          {localRoute}
          {localConnection}
          initialContinuous={continuousPrint}
          onContinuous={acceptContinuousPrint}
          onLocalConnection={acceptConnection}
          onConfigureLocal={() => (dialog = 'service')}
          onSelectLocal={() => chooseRoute('local-api')}
          onRoute={acceptRoute}
          onMedia={applyPrinterMedia}
        />{:else}<p class="pending">Loading printer support…</p>{/if}{/snippet}
  </LabelEditor>
  <footer aria-live="polite">
    <span class:offline={!online}>{online ? 'Online' : 'Offline — local editing and export remain available'}</span> · {status}{#if progress}
      · action {progress.action}/{progress.actions}, {progress.bytesSent}/{progress.totalBytes} bytes{/if}<span
      class="build"
      ><span title="Editor build">tag-{__MB_BUILD_TAG__}</span> · {#if sdk}<span
          title={`Printer SDK ${sdk.buildInfo.name} ${sdk.buildInfo.version}, commit ${sdk.buildInfo.commit}${sdk.buildInfo.dirty ? ' (modified tree)' : ''}`}
          >sdk-{sdkBuildLabel(sdk.buildInfo)}</span
        >{:else}<span title="Printer SDK (WebAssembly)">sdk-loading</span>{/if}</span
    >
  </footer>
  <Modal open={dialog === 'service'} title="Local service" onClose={() => (dialog = '')}
    ><LocalServicePanel
      route={localRoute}
      onToken={acceptToken}
      onConnection={acceptConnection}
      selectedId={connectionId}
      paired={!!apiToken}
      active={dialog === 'service'}
    /></Modal
  >
  <Modal open={dialog === 'external-resources'} title="External resources" size="lg" onClose={() => (dialog = '')}
    ><ExternalResourceConnectionsPanel
      manager={resourceManager}
      onChange={storeResourceConnections}
      onSelect={selectResourceConnection}
    /></Modal
  >
  <Modal open={dialog === 'cloud-connect'} title="Connect cloud printing" onClose={() => (dialog = '')}
    ><section class="cloud-connect">
      <label>Cloud service URL<input type="url" bind:value={cloudUrl} placeholder="https://print.example.com" /></label
      ><label>Tenant ID<input bind:value={cloudTenant} spellcheck="false" /></label><label
        >Print-only token<input type="password" bind:value={cloudToken} autocomplete="off" /></label
      ><button onclick={connectCloud} disabled={!cloudUrl.trim() || !cloudTenant.trim() || !cloudToken.trim()}
        >Connect for this session</button
      >
      <p>The service URL and tenant are remembered. The token stays only in memory and is forgotten on reload.</p>
    </section></Modal
  >
  <Modal open={dialog === 'cloud'} title="Cloud printers" onClose={() => (dialog = '')}
    >{#if cloudClient && cloudRoute}<CloudPrintPanel
        client={cloudClient}
        route={cloudRoute}
        document={editor.document}
        printer={printers.find((item) => item.id === printerId)}
        selectedId={cloudPrinterId}
        onPrinter={acceptCloudPrinter}
      />{:else}<p class="pending">Connect a cloud print session first.</p>{/if}</Modal
  >
  <Modal open={dialog === 'jobs'} title="Recover print jobs" onClose={() => (dialog = '')}
    ><JobRecoveryPanel {database} onRetry={retryRecovered} /></Modal
  >
  <Modal open={dialog === 'batch'} title="Batch printing" size="lg" onClose={() => (dialog = '')}
    >{#if selectedRoute.id === 'cloud-api' && !cloudPrinter?.online}<p class="pending">
        Cloud batch printing requires the selected printer to be online. Queue only one current label while it is
        offline.
      </p>{/if}{#if sdk}<BatchPanel
        document={editor.document}
        {sdk}
        materializer={sdk}
        route={selectedRoute.id === 'cloud-api' && !cloudPrinter?.online ? undefined : selectedRoute}
        printer={printers.find((item) => item.id === printerId)}
        continuous={continuousPrint}
      />{:else}<p class="pending">Select a printer model to load the printer SDK first.</p>{/if}</Modal
  >
  <Modal open={dialog === 'sheet'} title="Label sheet" size="lg" onClose={() => (dialog = '')}
    >{#if sdk}<SheetPanel
        document={editor.document}
        exporter={sdk}
        materializer={sdk}
        measurer={sdk}
        initialPreferences={sheet}
        onLayout={rememberSheet}
        onStatus={(value) => (status = value)}
      />{:else}<p class="pending">Loading sheet export support…</p>{/if}</Modal
  >
  <Modal open={dialog === 'laposte'} title="La Poste sheets" size="lg" onClose={() => (dialog = '')}
    >{#if selectedRoute.id === 'cloud-api' && !cloudPrinter?.online}<p class="pending">
        Cloud La Poste printing requires the selected printer to be online. Queue only one current label while it is
        offline.
      </p>{/if}{#if sdk}<LaPostePanel
        {sdk}
        route={selectedRoute.id === 'cloud-api' && !cloudPrinter?.online ? undefined : selectedRoute}
        printRequest={printers.find((item) => item.id === printerId)
          ? { printer: printers.find((item) => item.id === printerId)!, copies: 1 }
          : undefined}
      />{:else}<p class="pending">Select a printer model to load the printer SDK first.</p>{/if}</Modal
  >
</div>

<style>
  .app {
    height: 100dvh;
    min-width: 0;
    overflow: hidden;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .app :global(.mb-lockup) {
    white-space: nowrap;
  }
  .file {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    width: 100%;
    padding: 0.3rem 0.45rem;
    border-radius: var(--mb-radius-sm);
    cursor: pointer;
  }
  .file:hover {
    background: var(--mb-surface-2);
  }
  .file input[type='file'] {
    position: absolute;
    opacity: 0;
    width: 1px;
  }
  .token {
    width: 8rem;
  }
  .primary {
    background: var(--mb-accent);
    color: var(--mb-text-on-accent);
    border: 1px solid var(--mb-accent);
    border-radius: var(--mb-radius-sm);
    padding: 0.28rem 0.55rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .primary:hover:not(:disabled) {
    background: var(--mb-accent-hover);
    border-color: var(--mb-accent-hover);
  }
  .primary:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .pending {
    margin: 0;
    padding: 0.9rem;
    color: var(--mb-text-muted);
    font-size: 0.8125rem;
  }
  .cloud-connect {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.8rem;
  }
  .cloud-connect label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.75rem;
  }
  .cloud-connect p {
    font-size: 0.75rem;
    color: var(--mb-text-muted);
  }
  footer {
    display: flex;
    gap: 1rem;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.35rem calc(1rem + env(safe-area-inset-right, 0px)) calc(0.35rem + env(safe-area-inset-bottom, 0px))
      calc(1rem + env(safe-area-inset-left, 0px));
    background: var(--mb-bg);
    color: var(--mb-text-muted);
    border-top: var(--mb-border);
    font-size: 0.75rem;
    white-space: nowrap;
    overflow: hidden;
  }
  footer > :first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  footer .build {
    flex: none;
    font-family: monospace;
  }
  @media (max-width: 40rem) {
    footer .build {
      display: none;
    }
  }
  .offline {
    color: var(--mb-warning);
  }
  @media (max-width: 48rem) {
    .app :global(.appbar select) {
      max-width: 7.5rem;
    }
  }
</style>
