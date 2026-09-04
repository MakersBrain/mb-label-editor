<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorStore } from '../store.js';
  import type { PrinterSdk } from '../print/types.js';
  import { addElement, addFont, addResource } from '../commands.js';
  import { fontMimeType, importAsset, importFont } from '../imports.js';
  import { uuid, type Resource, type FontResource } from '../model.js';
  import { AssetCatalogue, type CatalogueAsset } from '../catalogue.js';
  import type { ExternalAsset, ExternalFont, ExternalResourceProvider } from '../external-resources/types.js';
  import { EditorDatabase } from '../persistence/database.js';
  import RemoteAssetPreview from './RemoteAssetPreview.svelte';
  import { assetDrag, ASSET_DRAG_TYPE } from '../asset-drag.js';
  import type { Point } from '../model.js';
  import manifest from '../../../assets/public-catalogue.json';
  import bundledFonts from '../../../assets/fonts/bundled-fonts.json';

  export let editor: EditorStore;
  export let sdk: PrinterSdk | undefined = undefined;
  export let resourceProvider: ExternalResourceProvider | undefined = undefined;
  /** False while the panel sits in a hidden tab, so it does not query the catalogue in the background. */
  export let active = true;

  const database = new EditorDatabase();
  const pageSize = 24;
  let query = '';
  let category = '';
  let status = '';
  /** Search summaries live apart from action feedback so a late search result cannot overwrite an import message. */
  let searchStatus = '';
  let source: 'service' | 'browser' = resourceProvider ? 'service' : 'browser';
  let remoteKind: 'assets' | 'fonts' = 'assets';
  let privateAssets: CatalogueAsset[] = [];
  let savedResources: Resource[] = [];
  let favorites = new Set<string>();
  /** Catalogue favourites keep the whole record so they can be shown without a search. */
  let remoteFavorites: { assets: Record<string, ExternalAsset>; fonts: Record<string, ExternalFont> } = { assets: {}, fonts: {} };
  let onlyFavorites = false;
  let recents: string[] = [];
  let page = 0;
  let remotePage = 1;
  let remotePages = 1;
  let remoteTotal = 0;
  let remoteAssets: ExternalAsset[] = [];
  let remoteFonts: ExternalFont[] = [];
  let remoteLoading = false;
  let imageProfile: 'photo' | 'logo' | 'line-art' = 'photo';
  let mounted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestSequence = 0;
  let providerFilter = '';
  let facetCategories: { value: string; count: number }[] = [];
  let facetProviders: { value: string; count: number }[] = [];
  /** Tile the user clicked; placing happens from the detail strip or by double-click. */
  let selected: { kind: 'local'; item: CatalogueAsset } | { kind: 'asset'; item: ExternalAsset } | { kind: 'font'; item: ExternalFont } | undefined;
  let importOpen = false;

  $: catalogue = new AssetCatalogue([...(manifest as CatalogueAsset[]).filter(item => item.visibility === 'public'), ...privateAssets]);
  $: all = catalogue.search({ query, category: category || undefined }).filter(item => !onlyFavorites || favorites.has(item.id)).sort((a, b) => recents.indexOf(b.id) - recents.indexOf(a.id));
  const matchesQuery = (text: string) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase());
  $: favoriteAssets = Object.values(remoteFavorites.assets).filter(item => matchesQuery(`${item.title} ${item.category} ${item.provider}`) && (!category || item.category === category));
  $: favoriteFonts = Object.values(remoteFavorites.fonts).filter(item => matchesQuery(`${item.family} ${item.category} ${item.provider}`) && (!category || item.category === category));
  $: shownAssets = onlyFavorites ? favoriteAssets : remoteAssets;
  $: shownFonts = onlyFavorites ? favoriteFonts : remoteFonts;
  $: favoriteCount = source === 'service' ? (remoteKind === 'assets' ? Object.keys(remoteFavorites.assets).length : Object.keys(remoteFavorites.fonts).length) : favorites.size;
  $: results = all.slice(page * pageSize, (page + 1) * pageSize);
  $: pages = Math.max(1, Math.ceil(all.length / pageSize));
  $: if (mounted && active && source === 'service' && resourceProvider) {
    query; category; remoteKind; providerFilter;
    scheduleRemoteSearch();
  }
  $: if (mounted && active && source === 'service' && resourceProvider) { query; remoteKind; void loadFacets(); }
  $: localCategories = (() => { const counts: Record<string, number> = {}; for (const asset of catalogue.search({ query })) counts[asset.category] = (counts[asset.category] ?? 0) + 1; return Object.keys(counts).sort().map(value => ({ value, count: counts[value] })); })();
  $: chips = source === 'service' ? facetCategories : localCategories;
  $: selectedSource = source; $: selectedKind = remoteKind;
  $: { selectedSource; selectedKind; selected = undefined; }

  onMount(() => {
    mounted = true;
    void restoreLocalAssets();
    return () => { mounted = false; if (timer) clearTimeout(timer); requestSequence += 1; };
  });

  async function restoreLocalAssets() {
    const stored = await database.entries<unknown>('assets');
    privateAssets = stored.map(item => item.value).filter((item): item is CatalogueAsset => !!item && typeof item === 'object' && 'visibility' in item && item.visibility === 'private');
    savedResources = stored.map(item => item.value).filter((item): item is Resource => !!item && typeof item === 'object' && 'mimeType' in item && 'data' in item);
    favorites = new Set((await database.get<string[]>('preferences', 'asset-favorites')) ?? []);
    const savedFavorites = await database.get<typeof remoteFavorites>('preferences', 'asset-remote-favorites');
    if (savedFavorites && typeof savedFavorites === 'object') remoteFavorites = { assets: savedFavorites.assets ?? {}, fonts: savedFavorites.fonts ?? {} };
    recents = (await database.get<string[]>('preferences', 'asset-recents')) ?? [];
  }

  async function loadFacets() {
    if (!resourceProvider) { facetCategories = []; facetProviders = []; return; }
    const loader = remoteKind === 'assets' ? resourceProvider.assetFacets : resourceProvider.fontFacets;
    if (!loader) { facetCategories = []; facetProviders = []; return; }
    try {
      const facets = await loader.call(resourceProvider, query);
      facetCategories = facets.categories.slice(0, 16);
      facetProviders = facets.providers;
      if (providerFilter && !facetProviders.some(item => item.value === providerFilter)) providerFilter = '';
    } catch { facetCategories = []; facetProviders = []; }
  }
  function toggleCategory(value: string) { category = category === value ? '' : value; page = 0; }
  function placeSelected() {
    if (!selected) return;
    if (selected.kind === 'local') void use(selected.item);
    else if (selected.kind === 'asset') void useRemoteAsset(selected.item);
    else void useRemoteFont(selected.item);
  }
  const isSelected = (kind: string, id: string) => selected?.kind === kind && selected.item.id === id;
  /** Font previews are rendered by the catalogue; the family name set in its own face reads like a type specimen. */
  const fontSample = (item: ExternalFont, text = item.family, size = 40) => `${item.previewUrl}?text=${encodeURIComponent(text)}&size=${size}`;
  function scheduleRemoteSearch() {
    status = '';
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void searchRemote(1), 250);
  }

  async function searchRemote(nextPage: number) {
    if (!resourceProvider) return;
    const sequence = ++requestSequence;
    remoteLoading = true;
    try {
      const common = { query, categories: category ? [category] : undefined, providers: providerFilter ? [providerFilter] : undefined, page: nextPage, pageSize };
      const result = remoteKind === 'assets'
        ? await resourceProvider.searchAssets(common)
        : await resourceProvider.searchFonts(common);
      if (sequence !== requestSequence) return;
      remotePage = result.page;
      remotePages = result.pages;
      remoteTotal = result.total;
      if (remoteKind === 'assets') { remoteAssets = result.items as ExternalAsset[]; remoteFonts = []; }
      else { remoteFonts = result.items as ExternalFont[]; remoteAssets = []; }
      searchStatus = `${result.total} ${remoteKind} from ${resourceProvider.displayName}.`;
    } catch (error) {
      if (sequence === requestSequence) searchStatus = message(error);
    } finally {
      if (sequence === requestSequence) remoteLoading = false;
    }
  }

  async function remember(id: string) {
    recents = [id, ...recents.filter(item => item !== id)].slice(0, 24);
    await database.put('preferences', 'asset-recents', recents);
    await database.saveRecent({ id, kind: 'asset', openedAt: new Date().toISOString() });
  }
  async function favorite(id: string) {
    favorites = new Set(favorites);
    favorites.has(id) ? favorites.delete(id) : favorites.add(id);
    await database.put('preferences', 'asset-favorites', [...favorites]);
  }
  const isRemoteFavorite = (kind: 'asset' | 'font', id: string) => kind === 'asset' ? id in remoteFavorites.assets : id in remoteFavorites.fonts;
  async function favoriteRemote(kind: 'asset' | 'font', item: ExternalAsset | ExternalFont) {
    const bucket = kind === 'asset' ? { ...remoteFavorites.assets } : { ...remoteFavorites.fonts };
    if (item.id in bucket) delete bucket[item.id]; else bucket[item.id] = structuredClone(item) as never;
    remoteFavorites = kind === 'asset' ? { ...remoteFavorites, assets: bucket as Record<string, ExternalAsset> } : { ...remoteFavorites, fonts: bucket as Record<string, ExternalFont> };
    await database.put('preferences', 'asset-remote-favorites', remoteFavorites);
  }
  function toggleFavoriteFor(entry: NonNullable<typeof selected>) {
    if (entry.kind === 'local') void favorite(entry.item.id); else void favoriteRemote(entry.kind, entry.item);
  }
  const isFavoriteEntry = (entry: NonNullable<typeof selected>) => entry.kind === 'local' ? favorites.has(entry.item.id) : isRemoteFavorite(entry.kind, entry.item.id);
  /** Starts a drag the canvas can resolve into a drop position on the label. */
  function dragTile(event: DragEvent, label: string, placeAt: (at: Point) => Promise<void> | void) {
    event.dataTransfer?.setData(ASSET_DRAG_TYPE, label); event.dataTransfer?.setData('text/plain', label);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    assetDrag.set({ label, place: placeAt });
  }
  const endDrag = () => assetDrag.set(undefined);
  function place(resource: Resource, width = 20, height = 20, at?: Point) {
    if (resource.mimeType.startsWith('font/')) { editor.execute(addFont(resource as FontResource)); return; }
    editor.execute(addResource(resource));
    const origin = at ? { x: Math.max(0, at.x - width / 2), y: Math.max(0, at.y - height / 2) } : { x: 2, y: 2 };
    const base = { id: uuid(), name: resource.name, resourceId: resource.id, transform: { ...origin, width, height, rotation: 0 }, zIndex: $editor.document.elements.length, visible: true, locked: false };
    const dither = imageProfile === 'photo' ? { algorithm: 'floyd-steinberg' as const, threshold: 128 } : imageProfile === 'logo' ? { algorithm: 'bayer' as const, threshold: 128 } : { algorithm: 'threshold' as const, threshold: 150 };
    editor.execute(addElement(resource.mimeType === 'image/svg+xml' ? { ...base, type: 'svg' } : { ...base, type: 'image', fit: 'contain', dither }));
  }
  async function verifiedBytes(item: CatalogueAsset) {
    const bytes = Uint8Array.from(atob(item.dataBase64 ?? ''), character => character.charCodeAt(0));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== item.sha256) throw new Error(`Catalogue hash mismatch for ${item.name}`);
    return bytes;
  }
  async function use(item: CatalogueAsset, at?: Point) {
    if (!item.dataBase64) return;
    const data = await verifiedBytes(item);
    const font = item.kind === 'font' ? fontMimeType(data, item.name, item.mediaType) : undefined;
    if (font) { const imported = await importFont(new File([data as BlobPart], item.name, { type: font })); editor.execute(addFont(imported)); await saveResource(imported); await remember(item.id); status = `Added ${item.name}`; return; }
    const resource = { id: uuid(), name: item.name, mimeType: item.mediaType, sha256: item.sha256, data: item.dataBase64 };
    place(resource, 20, 20, at);
    await saveResource(resource);
    await remember(item.id);
    status = `Added ${item.name}`;
  }
  async function useRemoteAsset(item: ExternalAsset, at?: Point) {
    if (!resourceProvider) return;
    try {
      status = `Downloading ${item.title}…`;
      const blob = await resourceProvider.fetchBlob(item.contentUrl);
      const file = new File([blob], item.title, { type: blob.type });
      // A catalogue may serve a face as application/octet-stream, so trust the item's own kind and the file's signature too.
      const font = item.kinds.includes('font') || blob.type.startsWith('font/') ? fontMimeType(new Uint8Array(await blob.slice(0, 4).arrayBuffer()), item.title, blob.type) : undefined;
      if (font) {
        const imported = await importFont(new File([blob], item.title, { type: font }));
        editor.execute(addFont(imported));
        await saveResource(imported);
      } else {
        const imported = await importAsset(file, sdk, $editor.document.media.dpi);
        place(imported.resource, imported.widthMm ?? 20, imported.heightMm ?? 20, at);
        await saveResource(imported.resource);
      }
      await remember(`remote:${item.id}`);
      status = `Added ${item.title}`;
    } catch (error) { status = message(error); }
  }
  async function useRemoteFont(item: ExternalFont) {
    if (!resourceProvider) return;
    try {
      status = `${item.availability === 'remote' ? 'Caching' : 'Downloading'} ${item.family}…`;
      let family = item;
      if (!family.faces.length || family.availability === 'remote') {
        const preferred = family.variants.includes('regular') ? ['regular'] : family.variants.slice(0, 1);
        if (!resourceProvider.cacheFont) throw new Error(`${resourceProvider.displayName} cannot cache remote fonts.`);
        family = await resourceProvider.cacheFont(family.id, preferred);
      }
      const face = family.faces.find(candidate => candidate.variant === 'regular') ?? family.faces[0];
      if (!face) throw new Error(`${family.family} has no downloadable font face.`);
      const blob = await resourceProvider.fetchBlob(face.fileUrl);
      const extension = face.format === 'opentype' ? 'otf' : face.format === 'collection' ? 'ttc' : 'ttf';
      const mimeType = blob.type || (extension === 'ttc' ? 'font/collection' : `font/${extension}`);
      const imported = await importFont(new File([blob], `${family.family}.${extension}`, { type: mimeType }), {
        family: face.familyName || family.family, weight: face.weight, style: face.style === 'italic' ? 'italic' : 'normal'
      });
      editor.execute(addFont(imported));
      await saveResource(imported);
      await remember(`remote-font:${family.id}`);
      status = `Added ${family.family}`;
      await searchRemote(remotePage);
    } catch (error) { status = message(error); }
  }
  /** Static URLs so the bundler emits the faces as assets: they are fetched on demand rather than inlined into the app. */
  const bundledFontUrls: Record<string, string> = {
    'plex-sans-400.ttf': new URL('../../../assets/fonts/plex-sans-400.ttf', import.meta.url).href,
    'plex-sans-700.ttf': new URL('../../../assets/fonts/plex-sans-700.ttf', import.meta.url).href,
    'plex-mono-400.ttf': new URL('../../../assets/fonts/plex-mono-400.ttf', import.meta.url).href,
    'plex-mono-700.ttf': new URL('../../../assets/fonts/plex-mono-700.ttf', import.meta.url).href
  };
  type BundledFont = (typeof bundledFonts)[number];
  const bundledName = (item: BundledFont) => `${item.family} ${item.weight === 700 ? 'Bold' : 'Regular'}`;
  /** Embeds a shipped face into the document, so a label prints in it without a catalogue or a network. */
  async function useBundledFont(item: BundledFont) {
    try {
      status = `Adding ${bundledName(item)}…`;
      const existing = $editor.document.fonts.find(font => font.sha256 === item.sha256);
      if (existing) { status = `${bundledName(item)} is already in this label.`; return; }
      const response = await fetch(bundledFontUrls[item.file]);
      if (!response.ok) throw new Error(`${bundledName(item)} is unavailable (${response.status}).`);
      const data = new Uint8Array(await response.arrayBuffer());
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== item.sha256) throw new Error(`Bundled font hash mismatch for ${item.file}`);
      const imported = await importFont(new File([data as BlobPart], item.file, { type: item.mediaType }), { family: item.family, weight: item.weight, style: item.style as 'normal' | 'italic' });
      editor.execute(addFont({ ...imported, name: bundledName(item) }));
      await saveResource({ ...imported, name: bundledName(item) });
      status = `Added ${bundledName(item)}`;
    } catch (error) { status = message(error); }
  }
  async function saveResource(resource: Resource) {
    await database.saveAsset(resource);
    savedResources = [resource, ...savedResources.filter(value => value.sha256 !== resource.sha256)];
  }
  async function collection(event: Event) {
    try {
      const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (!file) return;
      const value = JSON.parse(await file.text()) as CatalogueAsset[] | { assets: CatalogueAsset[] };
      const imported = (Array.isArray(value) ? value : value.assets).map(item => ({ ...item, visibility: 'private' as const, redistributionStatus: 'private-only' as const }));
      for (const item of imported) await database.put('assets', `catalogue:${item.id}`, item);
      privateAssets = [...privateAssets, ...imported]; status = `Persisted ${imported.length} private assets locally.`;
    } catch (error) { status = message(error); }
  }
  function exportCollection() {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, assets: privateAssets }, null, 2)], { type: 'application/json' }));
    anchor.download = 'private-assets.mb-assets'; anchor.click(); URL.revokeObjectURL(anchor.href);
  }
  async function asset(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (!file) return;
    try {
      const imported = await importAsset(file, sdk, $editor.document.media.dpi);
      place(imported.resource, imported.widthMm ?? 20, imported.heightMm ?? 20);
      await saveResource(imported.resource); status = `Imported and placed ${file.name}`;
    } catch (error) { status = message(error); }
  }
  async function font(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) { const imported = await importFont(file); editor.execute(addFont(imported)); await saveResource(imported); }
  }
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
</script>
<section class="assets">
  <div class="toolbar">
    <div class="segmented" role="group" aria-label="Asset source">
      <button type="button" class:active={source === 'browser'} aria-pressed={source === 'browser'} on:click={() => { source = 'browser'; page = 0; }}>This browser</button>
      <button type="button" class:active={source === 'service'} aria-pressed={source === 'service'} disabled={!resourceProvider} on:click={() => { source = 'service'; }}>{resourceProvider?.displayName ?? 'External resources'}</button>
    </div>
    {#if source === 'service'}
      <div class="segmented" role="group" aria-label="Asset kind">
        <button type="button" class:active={remoteKind === 'assets'} aria-pressed={remoteKind === 'assets'} on:click={() => { remoteKind = 'assets'; category = ''; }}>Graphics</button>
        <button type="button" class:active={remoteKind === 'fonts'} aria-pressed={remoteKind === 'fonts'} on:click={() => { remoteKind = 'fonts'; category = ''; }}>Fonts</button>
      </div>
    {/if}
    <div class="search-row">
      <input type="search" bind:value={query} on:input={() => page = 0} placeholder={source === 'service' ? `Search ${remoteKind}` : 'Search this browser'} aria-label="Search assets">
      <button type="button" class="favorites-toggle" class:active={onlyFavorites} aria-pressed={onlyFavorites} aria-label="Show favourites only" title="Show favourites only" on:click={() => { onlyFavorites = !onlyFavorites; page = 0; }}>★<span class="count">{favoriteCount}</span></button>
    </div>
    {#if source === 'service' && facetProviders.length > 1}
      <select bind:value={providerFilter} aria-label="Provider"><option value="">All providers</option>{#each facetProviders as item}<option value={item.value}>{item.value} ({item.count})</option>{/each}</select>
    {/if}
  </div>
  {#if chips.length}
    <div class="chips" role="group" aria-label="Categories">
      <button type="button" class="chip" class:active={!category} aria-pressed={!category} on:click={() => { category = ''; page = 0; }}>All</button>
      {#each chips as item (item.value)}<button type="button" class="chip" class:active={category === item.value} aria-pressed={category === item.value} on:click={() => toggleCategory(item.value)}>{item.value}<span class="count">{item.count}</span></button>{/each}
    </div>
  {/if}
  <p class="status" aria-live="polite">{status || (remoteLoading ? `Searching ${resourceProvider?.displayName ?? 'external resources'}…` : source === 'service' ? searchStatus : '')}</p>

  {#if selected}
    <div class="detail" class:font={selected.kind === 'font'} aria-label="Selected asset">
      <span class="preview">
        {#if selected.kind === 'local'}{#if selected.item.dataBase64 && selected.item.mediaType === 'image/svg+xml'}<img alt="" src={`data:image/svg+xml;base64,${selected.item.dataBase64}`}>{:else}<span class="glyph" aria-hidden="true">{selected.item.kind === 'font' ? 'Aa' : '▧'}</span>{/if}
        {:else if selected.kind === 'font' && resourceProvider}{#key selected.item.id}<RemoteAssetPreview provider={resourceProvider} path={fontSample(selected.item, 'The quick brown fox jumps over 0123', 48)} alt=""/>{/key}
        {:else if resourceProvider}{#key selected.item.id}<RemoteAssetPreview provider={resourceProvider} path={selected.item.previewUrl} alt=""/>{/key}{/if}
      </span>
      <div class="meta">
        <strong>{selected.kind === 'font' ? selected.item.family : selected.kind === 'asset' ? selected.item.title : selected.item.name}</strong>
        {#if selected.kind === 'local'}<small>{selected.item.kind} · {selected.item.category} · {selected.item.license}</small>
        {:else if selected.kind === 'asset'}<small>{selected.item.provider} · {selected.item.category} · {selected.item.kinds.join(', ')}</small>
        {:else}<small>{selected.item.provider} · {selected.item.category} · {selected.item.availability} · {selected.item.license}</small><small>{selected.item.variants.length} variants</small>{/if}
        {#if selected.kind !== 'font' && !(selected.kind === 'local' && selected.item.kind === 'font')}
          <label class="render-profile">Image rendering<select bind:value={imageProfile}><option value="photo">Photo · smooth tones</option><option value="logo">Logo · crisp ordered dots</option><option value="line-art">Line art · solid black/white</option></select></label>
        {/if}
        <div class="detail-actions">
          <button type="button" class="primary" on:click={placeSelected}>{selected.kind === 'font' || (selected.kind === 'local' && selected.item.kind === 'font') ? 'Add font' : 'Place on label'}</button>
          <button type="button" aria-pressed={isFavoriteEntry(selected)} on:click={() => { if (selected) toggleFavoriteFor(selected); }}>{isFavoriteEntry(selected) ? '★ Favourite' : '☆ Favourite'}</button>
          <button type="button" on:click={() => selected = undefined}>Close</button>
        </div>
      </div>
    </div>
  {:else}
    <p class="hint">Click a tile for details, double-click to place it, or drag it onto the label.</p>
  {/if}
  <div class="bundled" role="group" aria-label="Bundled fonts">
    <h3>Bundled fonts<small>Embedded into the label, so it prints anywhere</small></h3>
    <div class="bundled-row">
      {#each bundledFonts as item (item.id)}
        <button type="button" class="bundled-font" title={`${bundledName(item)} · ${item.license} · ${Math.round(item.bytes / 1024)} kB`} on:click={() => useBundledFont(item)}>
          <span class="glyph" aria-hidden="true">Aa</span>
          <span class="name">{bundledName(item)}</span>
        </button>
      {/each}
    </div>
  </div>
  {#if source === 'service' && resourceProvider}
    <div class="grid" class:font-list={remoteKind === 'fonts'} class:busy={remoteLoading} role="group" aria-label="Catalogue results">
      {#each shownAssets as item (item.id)}
        <button type="button" class="tile" class:active={isSelected('asset', item.id)} aria-pressed={isSelected('asset', item.id)} title={`${item.title} · ${item.provider} · ${item.category}`} on:click={() => selected = { kind: 'asset', item }} on:dblclick={() => useRemoteAsset(item)} draggable="true" on:dragstart={(event) => dragTile(event, item.title, (at) => useRemoteAsset(item, at))} on:dragend={endDrag}>
          <span class="thumb"><RemoteAssetPreview provider={resourceProvider} path={item.previewUrl} alt=""/></span>
          <span class="name">{item.title}</span>
          <span class="sub">{item.category}</span>
          <span class="star" role="button" tabindex="0" aria-label={`Favourite ${item.title}`} aria-pressed={isRemoteFavorite('asset', item.id)} class:on={isRemoteFavorite('asset', item.id)} on:click|stopPropagation={() => favoriteRemote('asset', item)} on:keydown|stopPropagation={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void favoriteRemote('asset', item); } }}>★</span>
        </button>
      {/each}
      {#each shownFonts as item (item.id)}
        <button type="button" class="font-row" class:active={isSelected('font', item.id)} aria-pressed={isSelected('font', item.id)} title={`${item.family} · ${item.provider} · ${item.category}`} on:click={() => selected = { kind: 'font', item }} on:dblclick={() => useRemoteFont(item)} draggable="true" on:dragstart={(event) => dragTile(event, item.family, () => useRemoteFont(item))} on:dragend={endDrag}>
          <span class="font-sample">{#key item.id}<RemoteAssetPreview provider={resourceProvider} path={fontSample(item)} alt={item.family}/>{/key}</span>
          <span class="font-meta"><span class="name">{item.family}</span><span class="sub">{item.category} · {item.variants.length} {item.variants.length === 1 ? 'style' : 'styles'}{item.availability === 'remote' ? ' · download' : ''}</span></span>
          <span class="star" role="button" tabindex="0" aria-label={`Favourite ${item.family}`} aria-pressed={isRemoteFavorite('font', item.id)} class:on={isRemoteFavorite('font', item.id)} on:click|stopPropagation={() => favoriteRemote('font', item)} on:keydown|stopPropagation={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void favoriteRemote('font', item); } }}>★</span>
        </button>
      {/each}
    </div>
    {#if onlyFavorites && !shownAssets.length && !shownFonts.length}<p class="empty">No favourite {remoteKind} yet. Star a tile to keep it here.</p>
    {:else if !onlyFavorites && !remoteLoading && remoteTotal === 0}<p class="empty">No matching {remoteKind}.</p>{/if}
    {#if !onlyFavorites}<nav class="pager"><button type="button" on:click={() => searchRemote(remotePage - 1)} disabled={remoteLoading || remotePage <= 1}>Previous</button><span>Page {remotePage} of {remotePages}{remoteTotal ? ` · ${remoteTotal} ${remoteKind}` : ''}</span><button type="button" on:click={() => searchRemote(remotePage + 1)} disabled={remoteLoading || remotePage >= remotePages}>Next</button></nav>{/if}
  {:else}
    <div class="grid" role="group" aria-label="Browser assets">
      {#each results as item (item.id)}
        <button type="button" class="tile" class:active={isSelected('local', item.id)} aria-pressed={isSelected('local', item.id)} title={`${item.name} · ${item.kind} · ${item.category}`} on:click={() => selected = { kind: 'local', item }} on:dblclick={() => use(item)} draggable="true" on:dragstart={(event) => dragTile(event, item.name, (at) => use(item, at))} on:dragend={endDrag}>
          <span class="thumb">{#if item.dataBase64 && item.mediaType === 'image/svg+xml'}<img alt="" src={`data:image/svg+xml;base64,${item.dataBase64}`}>{:else}<span class="glyph" aria-hidden="true">{item.kind === 'font' ? 'Aa' : item.kind === 'template' ? '▤' : '▧'}</span>{/if}</span>
          <span class="name">{item.name}</span>
          <span class="sub">{item.category}</span>
          <span class="star" role="button" tabindex="0" aria-label={`Favourite ${item.name}`} aria-pressed={favorites.has(item.id)} class:on={favorites.has(item.id)} on:click|stopPropagation={() => favorite(item.id)} on:keydown|stopPropagation={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void favorite(item.id); } }}>★</span>
        </button>
      {/each}
    </div>
    {#if !all.length}<p class="empty">{onlyFavorites ? 'No favourites match. Star a tile to keep it here.' : 'Nothing in this browser matches. Import a file below or switch to the catalogue.'}</p>{/if}
    <nav class="pager"><button type="button" on:click={() => page--} disabled={page === 0}>Previous</button><span>Page {page + 1} of {pages}{all.length ? ` · ${all.length} assets` : ''}</span><button type="button" on:click={() => page++} disabled={page + 1 >= pages}>Next</button></nav>
  {/if}


  <details class="import" bind:open={importOpen}>
    <summary>Import files</summary>
    <div class="actions">
      <label class="upload">Image/SVG/PDF<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,.svg,.webp,application/pdf" on:change={asset}></label>
      <label class="upload">Font<input type="file" accept=".woff,.woff2,.ttf,.otf,.ttc" on:change={font}></label>
      <label class="upload">Private .mb-assets<input type="file" accept=".mb-assets,application/json" on:change={collection}></label>
      <button type="button" on:click={exportCollection} disabled={!privateAssets.length}>Export private collection</button>
    </div>
    <label class="render-profile">Image rendering for imports<select bind:value={imageProfile}><option value="photo">Photo · smooth tones</option><option value="logo">Logo · crisp ordered dots</option><option value="line-art">Line art · solid black/white</option></select><small>The original stays intact. Rendering happens at the selected printer's {$editor.document.media.dpi} dpi and can be changed later in Properties.</small></label>
  </details>
</section>
<style>
  .assets{display:flex;flex-direction:column;gap:.5rem;padding:.7rem .75rem;font-size:.78rem}
  .toolbar{display:flex;flex-direction:column;gap:.35rem}
  .segmented{display:flex;border:1px solid var(--mble-border-strong,#bbb);border-radius:var(--mble-radius-sm,4px);overflow:hidden}
  .segmented button{flex:1;padding:.3rem .4rem;border:0;border-radius:0;background:transparent;color:var(--mble-text-muted,#59635e);font-size:.72rem;font-weight:600;cursor:pointer}
  .segmented button+button{border-left:1px solid var(--mble-border-strong,#bbb)}
  .segmented button.active{background:var(--mble-primary,#ed6146);color:#fff}
  .segmented button:disabled{opacity:.5;cursor:default}
  .toolbar input[type=search]{box-sizing:border-box}
  .chips{display:flex;flex-wrap:wrap;gap:.25rem}
  .chip{padding:.15rem .5rem;border:1px solid var(--mble-border,#d8d0c3);border-radius:999px;background:var(--mble-surface,#fff);color:var(--mble-text,#17231c);font-size:.68rem;cursor:pointer}
  .chip.active{background:var(--mble-text,#17231c);border-color:var(--mble-text,#17231c);color:var(--mble-surface,#fff)}
  .chip .count{margin-left:.3rem;opacity:.65}
  .status{min-height:1em;margin:0;color:var(--mble-text-muted,#59635e);font-size:.7rem}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(5.2rem,1fr));gap:.4rem}
  .grid.busy{opacity:.55}
  .grid.font-list{grid-template-columns:1fr;gap:.3rem}
  .font-row{display:flex;align-items:center;gap:.6rem;position:relative;padding:.35rem 2rem .35rem .5rem;border:1px solid var(--mble-border,#d8d0c3);border-radius:var(--mble-radius-sm,4px);background:#fff;color:#17231c;cursor:grab;text-align:left}
  .font-row:hover{border-color:var(--mble-border-strong,#948274)}
  .font-row.active{border-color:var(--mble-primary,#ed6146);box-shadow:0 0 0 1px var(--mble-primary,#ed6146)}
  .font-sample{display:flex;align-items:center;flex:1;min-width:0;height:2.1rem;overflow:hidden}
  .font-sample :global(img){display:block;height:100%;width:auto;max-width:none;pointer-events:none}
  .font-sample :global(.preview){width:100%;height:100%}
  .font-meta{display:flex;flex-direction:column;flex:none;max-width:40%;min-width:0}
  .font-meta .name{color:#17231c}
  .font-meta .sub{color:#59635e}
  .detail.font{grid-template-columns:1fr}
  .detail.font .preview{aspect-ratio:auto;height:3.6rem;padding:.3rem .5rem;justify-items:start}
  .detail.font .preview :global(img){width:auto;max-width:100%;height:100%;object-fit:contain;object-position:left center}
  .tile{position:relative;cursor:grab;display:flex;flex-direction:column;gap:.25rem;padding:.3rem;border:1px solid var(--mble-border,#d8d0c3);border-radius:var(--mble-radius-sm,4px);background:var(--mble-surface,#fff);color:inherit;cursor:pointer;text-align:left}
  .tile:hover{border-color:var(--mble-border-strong,#948274)}
  .tile:active{cursor:grabbing}
  .tile.active{border-color:var(--mble-primary,#ed6146);box-shadow:0 0 0 1px var(--mble-primary,#ed6146)}
  .bundled{padding:0 .1rem .4rem}.bundled h3{display:flex;flex-direction:column;gap:.1rem;margin:.2rem 0 .35rem;color:var(--mble-text-muted,#59635e);font-size:.7rem;font-weight:600}.bundled h3 small{font-weight:400}
  .bundled-row{display:flex;flex-wrap:wrap;gap:.35rem}
  .bundled-font{display:flex;align-items:center;gap:.35rem;padding:.25rem .45rem;border:1px solid var(--mble-border,#e5dfd5);border-radius:3px;background:var(--mble-surface,#fff);font:inherit;font-size:.72rem;cursor:pointer}.bundled-font:hover{border-color:var(--mble-border-strong,#948274)}.bundled-font .glyph{font-size:.9rem}
  .thumb{display:grid;place-items:center;aspect-ratio:1;background:#fff;border-radius:3px;overflow:hidden}
  .thumb :global(img){display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}
  .thumb :global(.preview){width:100%;height:100%}
  .glyph{font-size:1.4rem;color:var(--mble-text-muted,#59635e)}
  .name{overflow:hidden;font-size:.68rem;line-height:1.25;white-space:nowrap;text-overflow:ellipsis}
  .sub{overflow:hidden;color:var(--mble-text-muted,#59635e);font-size:.62rem;line-height:1.2;white-space:nowrap;text-overflow:ellipsis}
  .star{position:absolute;top:.15rem;right:.2rem;display:grid;place-items:center;width:1.3rem;height:1.3rem;border-radius:999px;background:color-mix(in srgb,var(--mble-surface,#fff) 85%,transparent);color:var(--mble-border-strong,#948274);font-size:.85rem;line-height:1;opacity:0;transition:opacity .12s}
  .tile:hover .star,.tile:focus-within .star,.star.on{opacity:1}
  .star.on{color:var(--mble-primary,#ed6146)}
  .search-row{display:flex;gap:.3rem}
  .search-row input{flex:1;min-width:0}
  .favorites-toggle{flex:none;padding:.2rem .45rem;border:1px solid var(--mble-border-strong,#bbb);border-radius:var(--mble-radius-sm,4px);background:var(--mble-surface,#fff);color:var(--mble-text-muted,#59635e);cursor:pointer}
  .favorites-toggle .count{margin-left:.25rem;font-size:.68rem}
  .favorites-toggle.active{background:var(--mble-primary,#ed6146);border-color:var(--mble-primary,#ed6146);color:#fff}
  .empty,.hint{margin:0;color:var(--mble-text-muted,#59635e);font-size:.7rem}
  .pager{display:flex;align-items:center;justify-content:space-between;gap:.3rem;font-size:.7rem;color:var(--mble-text-muted,#59635e)}
  .detail{display:grid;grid-template-columns:5.5rem minmax(0,1fr);gap:.6rem;padding:.5rem;border:1px solid var(--mble-border,#d8d0c3);border-radius:var(--mble-radius-sm,4px);background:var(--mble-background,#f7f4ed)}
  .preview{display:grid;place-items:center;aspect-ratio:1;background:#fff;border-radius:3px;overflow:hidden}
  .preview :global(img){width:100%;height:100%;object-fit:contain}
  .meta{display:flex;flex-direction:column;gap:.25rem;min-width:0}
  .meta strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .meta small{color:var(--mble-text-muted,#59635e);font-size:.68rem}
  .detail-actions{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.2rem}
  .primary{background:var(--mble-primary,#ed6146);color:#fff;border-color:var(--mble-primary,#ed6146)}
  .render-profile{display:flex;flex-direction:column;gap:.2rem;font-size:.7rem}
  .render-profile small{line-height:1.35;color:var(--mble-text-muted,#59635e)}
  .import summary{cursor:pointer;color:var(--mble-text-muted,#59635e);font-size:.72rem;font-weight:600}
  .import .actions{display:flex;flex-wrap:wrap;gap:.3rem;margin:.4rem 0}
  .upload{border:1px solid var(--mble-border-strong,#bbb);padding:.3rem;border-radius:var(--mble-radius-sm,4px);cursor:pointer}
  .upload input{position:absolute;opacity:0;width:1px}
</style>
