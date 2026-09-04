<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { EditorStore } from '../store.svelte.js';
  import type { PrinterSdk } from '../print/types.js';
  import { addElement, addFont, addResource } from '../commands.js';
  import { fontMimeType, importAsset, importFont } from '../imports.js';
  import { uuid, type Resource, type FontResource } from '../model.js';
  import { AssetCatalogue, type CatalogueAsset } from '../catalogue.js';
  import type { ExternalAsset, ExternalFont, ExternalResourceProvider } from '../external-resources/types.js';
  import { EditorDatabase } from '../persistence/database.js';
  import RemoteAssetPreview from './RemoteAssetPreview.svelte';
  import { assetDrag, ASSET_DRAG_TYPE } from '../asset-drag.svelte.js';
  import type { Point } from '../model.js';
  import manifest from '../../../assets/public-catalogue.json';
  import bundledFonts from '../../../assets/fonts/bundled-fonts.json';

  interface Props {
    editor: EditorStore;
    sdk?: PrinterSdk;
    resourceProvider?: ExternalResourceProvider;
    /** False while the panel sits in a hidden tab, so it does not query the catalogue in the background. */ active?: boolean;
  }
  let { editor, sdk, resourceProvider, active = true }: Props = $props();

  const database = new EditorDatabase();
  const pageSize = 24;
  let query = $state('');
  let category = $state('');
  let status = $state('');
  /** Search summaries live apart from action feedback so a late search result cannot overwrite an import message. */
  let searchStatus = $state('');
  /** A failed catalogue search is shown as an alert with a retry, instead of vanishing into the status line. */
  let searchError = $state('');
  let source = $state<'service' | 'browser'>(untrack(() => resourceProvider) ? 'service' : 'browser');
  let remoteKind = $state<'assets' | 'fonts'>('assets');
  let privateAssets = $state.raw<CatalogueAsset[]>([]);
  let savedResources = $state.raw<Resource[]>([]);
  let favorites = $state.raw(new Set<string>());
  /** Catalogue favourites keep the whole record so they can be shown without a search. */
  let remoteFavorites: { assets: Record<string, ExternalAsset>; fonts: Record<string, ExternalFont> } = {
    assets: {},
    fonts: {},
  };
  let onlyFavorites = $state(false);
  let recents = $state.raw<string[]>([]);
  let page = $state(0);
  let remotePage = $state(1);
  let remotePages = $state(1);
  let remoteTotal = $state(0);
  let remoteAssets = $state.raw<ExternalAsset[]>([]);
  let remoteFonts = $state.raw<ExternalFont[]>([]);
  let remoteLoading = $state(false);
  let imageProfile = $state<'photo' | 'logo' | 'line-art'>('photo');
  let mounted = $state(false);
  let timer = $state.raw<ReturnType<typeof setTimeout> | undefined>();
  let requestSequence = $state(0);
  let providerFilter = $state('');
  let facetCategories: { value: string; count: number }[] = $state.raw([]);
  let facetProviders: { value: string; count: number }[] = $state.raw([]);
  /** Tile the user clicked; placing happens from the detail strip or by double-click. */
  let selected:
    | { kind: 'local'; item: CatalogueAsset }
    | { kind: 'asset'; item: ExternalAsset }
    | { kind: 'font'; item: ExternalFont }
    | undefined = $state.raw();
  let importOpen = $state(false);

  const catalogue = $derived(
    new AssetCatalogue([
      ...(manifest as CatalogueAsset[]).filter((item) => item.visibility === 'public'),
      ...privateAssets,
    ]),
  );
  const all = $derived(
    catalogue
      .search({ query, category: category || undefined })
      .filter((item) => !onlyFavorites || favorites.has(item.id))
      .sort((a, b) => recents.indexOf(b.id) - recents.indexOf(a.id)),
  );
  const matchesQuery = (text: string) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase());
  const favoriteAssets = $derived(
    Object.values(remoteFavorites.assets).filter(
      (item) =>
        matchesQuery(`${item.title} ${item.category} ${item.provider}`) && (!category || item.category === category),
    ),
  );
  const favoriteFonts = $derived(
    Object.values(remoteFavorites.fonts).filter(
      (item) =>
        matchesQuery(`${item.family} ${item.category} ${item.provider}`) && (!category || item.category === category),
    ),
  );
  const shownAssets = $derived(onlyFavorites ? favoriteAssets : remoteAssets);
  const shownFonts = $derived(onlyFavorites ? favoriteFonts : remoteFonts);
  const favoriteCount = $derived(
    source === 'service'
      ? remoteKind === 'assets'
        ? Object.keys(remoteFavorites.assets).length
        : Object.keys(remoteFavorites.fonts).length
      : favorites.size,
  );
  const results = $derived(all.slice(page * pageSize, (page + 1) * pageSize));
  const pages = $derived(Math.max(1, Math.ceil(all.length / pageSize)));
  // Remote search and facets follow the query inputs; the work itself runs untracked so it cannot re-trigger the effect.
  $effect(() => {
    const inputs = `${query}\u0000${category}\u0000${remoteKind}\u0000${providerFilter}`;
    if (mounted && active && source === 'service' && resourceProvider && inputs) untrack(scheduleRemoteSearch);
  });
  $effect(() => {
    const inputs = `${query}\u0000${remoteKind}`;
    if (mounted && active && source === 'service' && resourceProvider && inputs)
      untrack(() => loadFacets()).catch(() => {});
  });
  const localCategories = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const asset of catalogue.search({ query })) counts[asset.category] = (counts[asset.category] ?? 0) + 1;
    return Object.keys(counts)
      .sort()
      .map((value) => ({ value, count: counts[value] }));
  });
  const chips = $derived(source === 'service' ? facetCategories : localCategories);
  /** Switching source or kind drops the detail strip, which belongs to the previous list. */
  $effect(() => {
    const scope = `${source}:${remoteKind}`;
    if (scope)
      untrack(() => {
        selected = undefined;
      });
  });

  onMount(() => {
    mounted = true;
    void restoreLocalAssets();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      requestSequence += 1;
    };
  });

  async function restoreLocalAssets() {
    const stored = await database.entries<unknown>('assets');
    privateAssets = stored
      .map((item) => item.value)
      .filter(
        (item): item is CatalogueAsset =>
          !!item && typeof item === 'object' && 'visibility' in item && item.visibility === 'private',
      );
    savedResources = stored
      .map((item) => item.value)
      .filter((item): item is Resource => !!item && typeof item === 'object' && 'mimeType' in item && 'data' in item);
    favorites = new Set((await database.get<string[]>('preferences', 'asset-favorites')) ?? []);
    const savedFavorites = await database.get<typeof remoteFavorites>('preferences', 'asset-remote-favorites');
    if (savedFavorites && typeof savedFavorites === 'object')
      remoteFavorites = { assets: savedFavorites.assets ?? {}, fonts: savedFavorites.fonts ?? {} };
    recents = (await database.get<string[]>('preferences', 'asset-recents')) ?? [];
  }

  async function loadFacets() {
    if (!resourceProvider) {
      facetCategories = [];
      facetProviders = [];
      return;
    }
    const loader = remoteKind === 'assets' ? resourceProvider.assetFacets : resourceProvider.fontFacets;
    if (!loader) {
      facetCategories = [];
      facetProviders = [];
      return;
    }
    try {
      const facets = await loader.call(resourceProvider, query);
      facetCategories = facets.categories.slice(0, 16);
      facetProviders = facets.providers;
      if (providerFilter && !facetProviders.some((item) => item.value === providerFilter)) providerFilter = '';
    } catch {
      facetCategories = [];
      facetProviders = [];
    }
  }
  function toggleCategory(value: string) {
    category = category === value ? '' : value;
    page = 0;
  }
  function placeSelected() {
    if (!selected) return;
    if (selected.kind === 'local') void use(selected.item);
    else if (selected.kind === 'asset') void useRemoteAsset(selected.item);
    else void useRemoteFont(selected.item);
  }
  const isSelected = (kind: string, id: string) => selected?.kind === kind && selected.item.id === id;
  /** Font previews are rendered by the catalogue; the family name set in its own face reads like a type specimen. */
  const fontSample = (item: ExternalFont, text = item.family, size = 40) =>
    `${item.previewUrl}?text=${encodeURIComponent(text)}&size=${size}`;
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
      const common = {
        query,
        categories: category ? [category] : undefined,
        providers: providerFilter ? [providerFilter] : undefined,
        page: nextPage,
        pageSize,
      };
      const result =
        remoteKind === 'assets'
          ? await resourceProvider.searchAssets(common)
          : await resourceProvider.searchFonts(common);
      if (sequence !== requestSequence) return;
      remotePage = result.page;
      remotePages = result.pages;
      remoteTotal = result.total;
      if (remoteKind === 'assets') {
        remoteAssets = result.items as ExternalAsset[];
        remoteFonts = [];
      } else {
        remoteFonts = result.items as ExternalFont[];
        remoteAssets = [];
      }
      searchStatus = `${result.total} ${remoteKind} from ${resourceProvider.displayName}.`;
      searchError = '';
    } catch (error) {
      if (sequence === requestSequence) {
        searchStatus = '';
        searchError = message(error);
      }
    } finally {
      if (sequence === requestSequence) remoteLoading = false;
    }
  }

  async function remember(id: string) {
    recents = [id, ...recents.filter((item) => item !== id)].slice(0, 24);
    await database.put('preferences', 'asset-recents', recents);
    await database.saveRecent({ id, kind: 'asset', openedAt: new Date().toISOString() });
  }
  async function favorite(id: string) {
    favorites = new Set(favorites);
    favorites.has(id) ? favorites.delete(id) : favorites.add(id);
    await database.put('preferences', 'asset-favorites', [...favorites]);
  }
  const isRemoteFavorite = (kind: 'asset' | 'font', id: string) =>
    kind === 'asset' ? id in remoteFavorites.assets : id in remoteFavorites.fonts;
  async function favoriteRemote(kind: 'asset' | 'font', item: ExternalAsset | ExternalFont) {
    const bucket = kind === 'asset' ? { ...remoteFavorites.assets } : { ...remoteFavorites.fonts };
    if (item.id in bucket) delete bucket[item.id];
    else bucket[item.id] = structuredClone(item) as never;
    remoteFavorites =
      kind === 'asset'
        ? { ...remoteFavorites, assets: bucket as Record<string, ExternalAsset> }
        : { ...remoteFavorites, fonts: bucket as Record<string, ExternalFont> };
    await database.put('preferences', 'asset-remote-favorites', remoteFavorites);
  }
  function toggleFavoriteFor(entry: NonNullable<typeof selected>) {
    if (entry.kind === 'local') void favorite(entry.item.id);
    else void favoriteRemote(entry.kind, entry.item);
  }
  const isFavoriteEntry = (entry: NonNullable<typeof selected>) =>
    entry.kind === 'local' ? favorites.has(entry.item.id) : isRemoteFavorite(entry.kind, entry.item.id);
  /** Starts a drag the canvas can resolve into a drop position on the label. */
  function dragTile(event: DragEvent, label: string, placeAt: (at: Point) => Promise<void> | void) {
    event.dataTransfer?.setData(ASSET_DRAG_TYPE, label);
    event.dataTransfer?.setData('text/plain', label);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    assetDrag.current = { label, place: placeAt };
  }
  const endDrag = () => {
    assetDrag.current = undefined;
  };
  function place(resource: Resource, width = 20, height = 20, at?: Point) {
    if (resource.mimeType.startsWith('font/')) {
      editor.execute(addFont(resource as FontResource));
      return;
    }
    editor.execute(addResource(resource));
    const origin = at ? { x: Math.max(0, at.x - width / 2), y: Math.max(0, at.y - height / 2) } : { x: 2, y: 2 };
    const base = {
      id: uuid(),
      name: resource.name,
      resourceId: resource.id,
      transform: { ...origin, width, height, rotation: 0 },
      zIndex: editor.document.elements.length,
      visible: true,
      locked: false,
    };
    const dither =
      imageProfile === 'photo'
        ? { algorithm: 'floyd-steinberg' as const, threshold: 128 }
        : imageProfile === 'logo'
          ? { algorithm: 'bayer' as const, threshold: 128 }
          : { algorithm: 'threshold' as const, threshold: 150 };
    editor.execute(
      addElement(
        resource.mimeType === 'image/svg+xml'
          ? { ...base, type: 'svg' }
          : { ...base, type: 'image', fit: 'contain', dither },
      ),
    );
  }
  async function verifiedBytes(item: CatalogueAsset) {
    const bytes = Uint8Array.from(atob(item.dataBase64 ?? ''), (character) => character.charCodeAt(0));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    if (hash !== item.sha256) throw new Error(`Catalogue hash mismatch for ${item.name}`);
    return bytes;
  }
  async function use(item: CatalogueAsset, at?: Point) {
    if (!item.dataBase64) return;
    const data = await verifiedBytes(item);
    const font = item.kind === 'font' ? fontMimeType(data, item.name, item.mediaType) : undefined;
    if (font) {
      const imported = await importFont(new File([data as BlobPart], item.name, { type: font }));
      editor.execute(addFont(imported));
      await saveResource(imported);
      await remember(item.id);
      status = `Added ${item.name}`;
      return;
    }
    const resource = {
      id: uuid(),
      name: item.name,
      mimeType: item.mediaType,
      sha256: item.sha256,
      data: item.dataBase64,
    };
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
      const font =
        item.kinds.includes('font') || blob.type.startsWith('font/')
          ? fontMimeType(new Uint8Array(await blob.slice(0, 4).arrayBuffer()), item.title, blob.type)
          : undefined;
      if (font) {
        const imported = await importFont(new File([blob], item.title, { type: font }));
        editor.execute(addFont(imported));
        await saveResource(imported);
      } else {
        const imported = await importAsset(file, sdk, editor.document.media.dpi);
        place(imported.resource, imported.widthMm ?? 20, imported.heightMm ?? 20, at);
        await saveResource(imported.resource);
      }
      await remember(`remote:${item.id}`);
      status = `Added ${item.title}`;
    } catch (error) {
      status = message(error);
    }
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
      const face = family.faces.find((candidate) => candidate.variant === 'regular') ?? family.faces[0];
      if (!face) throw new Error(`${family.family} has no downloadable font face.`);
      const blob = await resourceProvider.fetchBlob(face.fileUrl);
      const extension = face.format === 'opentype' ? 'otf' : face.format === 'collection' ? 'ttc' : 'ttf';
      const mimeType = blob.type || (extension === 'ttc' ? 'font/collection' : `font/${extension}`);
      const imported = await importFont(new File([blob], `${family.family}.${extension}`, { type: mimeType }), {
        family: face.familyName || family.family,
        weight: face.weight,
        style: face.style === 'italic' ? 'italic' : 'normal',
      });
      editor.execute(addFont(imported));
      await saveResource(imported);
      await remember(`remote-font:${family.id}`);
      status = `Added ${family.family}`;
      await searchRemote(remotePage);
    } catch (error) {
      status = message(error);
    }
  }
  /** Static URLs so the bundler emits the faces as assets: they are fetched on demand rather than inlined into the app. */
  const bundledFontUrls: Record<string, string> = {
    'plex-sans-400.ttf': new URL('../../../assets/fonts/plex-sans-400.ttf', import.meta.url).href,
    'plex-sans-700.ttf': new URL('../../../assets/fonts/plex-sans-700.ttf', import.meta.url).href,
    'plex-mono-400.ttf': new URL('../../../assets/fonts/plex-mono-400.ttf', import.meta.url).href,
    'plex-mono-700.ttf': new URL('../../../assets/fonts/plex-mono-700.ttf', import.meta.url).href,
  };
  type BundledFont = (typeof bundledFonts)[number];
  const bundledName = (item: BundledFont) => `${item.family} ${item.weight === 700 ? 'Bold' : 'Regular'}`;
  /** Embeds a shipped face into the document, so a label prints in it without a catalogue or a network. */
  async function useBundledFont(item: BundledFont) {
    try {
      status = `Adding ${bundledName(item)}…`;
      const existing = editor.document.fonts.find((font) => font.sha256 === item.sha256);
      if (existing) {
        status = `${bundledName(item)} is already in this label.`;
        return;
      }
      const response = await fetch(bundledFontUrls[item.file]);
      if (!response.ok) throw new Error(`${bundledName(item)} is unavailable (${response.status}).`);
      const data = new Uint8Array(await response.arrayBuffer());
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      if (digest !== item.sha256) throw new Error(`Bundled font hash mismatch for ${item.file}`);
      const imported = await importFont(new File([data as BlobPart], item.file, { type: item.mediaType }), {
        family: item.family,
        weight: item.weight,
        style: item.style as 'normal' | 'italic',
      });
      editor.execute(addFont({ ...imported, name: bundledName(item) }));
      await saveResource({ ...imported, name: bundledName(item) });
      status = `Added ${bundledName(item)}`;
    } catch (error) {
      status = message(error);
    }
  }
  async function saveResource(resource: Resource) {
    await database.saveAsset(resource);
    savedResources = [resource, ...savedResources.filter((value) => value.sha256 !== resource.sha256)];
  }
  async function collection(event: Event) {
    try {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (!file) return;
      const value = JSON.parse(await file.text()) as CatalogueAsset[] | { assets: CatalogueAsset[] };
      const imported = (Array.isArray(value) ? value : value.assets).map((item) => ({
        ...item,
        visibility: 'private' as const,
        redistributionStatus: 'private-only' as const,
      }));
      for (const item of imported) await database.put('assets', `catalogue:${item.id}`, item);
      privateAssets = [...privateAssets, ...imported];
      status = `Persisted ${imported.length} private assets locally.`;
    } catch (error) {
      status = message(error);
    }
  }
  function exportCollection() {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, assets: privateAssets }, null, 2)], { type: 'application/json' }),
    );
    anchor.download = 'private-assets.mb-assets';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }
  async function asset(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const imported = await importAsset(file, sdk, editor.document.media.dpi);
      place(imported.resource, imported.widthMm ?? 20, imported.heightMm ?? 20);
      await saveResource(imported.resource);
      status = `Imported and placed ${file.name}`;
    } catch (error) {
      status = message(error);
    }
  }
  async function font(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) {
      const imported = await importFont(file);
      editor.execute(addFont(imported));
      await saveResource(imported);
    }
  }
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
</script>

<section class="assets">
  <div class="toolbar">
    <div class="segmented" role="group" aria-label="Asset source">
      <button
        type="button"
        class:active={source === 'browser'}
        aria-pressed={source === 'browser'}
        onclick={() => {
          source = 'browser';
          page = 0;
        }}>This browser</button
      >
      <button
        type="button"
        class:active={source === 'service'}
        aria-pressed={source === 'service'}
        disabled={!resourceProvider}
        onclick={() => {
          source = 'service';
        }}>{resourceProvider?.displayName ?? 'External resources'}</button
      >
    </div>
    {#if source === 'service'}
      <div class="segmented" role="group" aria-label="Asset kind">
        <button
          type="button"
          class:active={remoteKind === 'assets'}
          aria-pressed={remoteKind === 'assets'}
          onclick={() => {
            remoteKind = 'assets';
            category = '';
          }}>Graphics</button
        >
        <button
          type="button"
          class:active={remoteKind === 'fonts'}
          aria-pressed={remoteKind === 'fonts'}
          onclick={() => {
            remoteKind = 'fonts';
            category = '';
          }}>Fonts</button
        >
      </div>
    {/if}
    <div class="search-row">
      <input
        type="search"
        bind:value={query}
        oninput={() => (page = 0)}
        placeholder={source === 'service' ? `Search ${remoteKind}` : 'Search this browser'}
        aria-label="Search assets"
      />
      <button
        type="button"
        class="favorites-toggle"
        class:active={onlyFavorites}
        aria-pressed={onlyFavorites}
        aria-label="Show favourites only"
        title="Show favourites only"
        onclick={() => {
          onlyFavorites = !onlyFavorites;
          page = 0;
        }}>★<span class="count">{favoriteCount}</span></button
      >
    </div>
    {#if source === 'service' && facetProviders.length > 1}
      <select bind:value={providerFilter} aria-label="Provider"
        ><option value="">All providers</option>{#each facetProviders as item}<option value={item.value}
            >{item.value} ({item.count})</option
          >{/each}</select
      >
    {/if}
  </div>
  {#if chips.length}
    <div class="chips" role="group" aria-label="Categories">
      <button
        type="button"
        class="chip"
        class:active={!category}
        aria-pressed={!category}
        onclick={() => {
          category = '';
          page = 0;
        }}>All</button
      >
      {#each chips as item (item.value)}<button
          type="button"
          class="chip"
          class:active={category === item.value}
          aria-pressed={category === item.value}
          onclick={() => toggleCategory(item.value)}>{item.value}<span class="count">{item.count}</span></button
        >{/each}
    </div>
  {/if}
  <p class="status" aria-live="polite">
    {status ||
      (remoteLoading
        ? `Searching ${resourceProvider?.displayName ?? 'external resources'}…`
        : source === 'service'
          ? searchStatus
          : '')}
  </p>

  {#if selected}
    <div class="detail" class:font={selected.kind === 'font'} aria-label="Selected asset">
      <span class="preview">
        {#if selected.kind === 'local'}{#if selected.item.dataBase64 && selected.item.mediaType === 'image/svg+xml'}<img
              alt=""
              src={`data:image/svg+xml;base64,${selected.item.dataBase64}`}
            />{:else}<span class="glyph" aria-hidden="true">{selected.item.kind === 'font' ? 'Aa' : '▧'}</span>{/if}
        {:else if selected.kind === 'font' && resourceProvider}{#key selected.item.id}<RemoteAssetPreview
              provider={resourceProvider}
              path={fontSample(selected.item, 'The quick brown fox jumps over 0123', 48)}
              alt=""
            />{/key}
        {:else if resourceProvider}{#key selected.item.id}<RemoteAssetPreview
              provider={resourceProvider}
              path={selected.item.previewUrl}
              alt=""
            />{/key}{/if}
      </span>
      <div class="meta">
        <strong
          >{selected.kind === 'font'
            ? selected.item.family
            : selected.kind === 'asset'
              ? selected.item.title
              : selected.item.name}</strong
        >
        {#if selected.kind === 'local'}<small
            >{selected.item.kind} · {selected.item.category} · {selected.item.license}</small
          >
        {:else if selected.kind === 'asset'}<small
            >{selected.item.provider} · {selected.item.category} · {selected.item.kinds.join(', ')}</small
          >
        {:else}<small
            >{selected.item.provider} · {selected.item.category} · {selected.item.availability} · {selected.item
              .license}</small
          ><small>{selected.item.variants.length} variants</small>{/if}
        {#if selected.kind !== 'font' && !(selected.kind === 'local' && selected.item.kind === 'font')}
          <label class="render-profile"
            >Image rendering<select bind:value={imageProfile}
              ><option value="photo">Photo · smooth tones</option><option value="logo">Logo · crisp ordered dots</option
              ><option value="line-art">Line art · solid black/white</option></select
            ></label
          >
        {/if}
        <div class="detail-actions">
          <button type="button" class="primary" onclick={placeSelected}
            >{selected.kind === 'font' || (selected.kind === 'local' && selected.item.kind === 'font')
              ? 'Add font'
              : 'Place on label'}</button
          >
          <button
            type="button"
            aria-pressed={isFavoriteEntry(selected)}
            onclick={() => {
              if (selected) toggleFavoriteFor(selected);
            }}>{isFavoriteEntry(selected) ? '★ Favourite' : '☆ Favourite'}</button
          >
          <button type="button" onclick={() => (selected = undefined)}>Close</button>
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
        <button
          type="button"
          class="bundled-font"
          title={`${bundledName(item)} · ${item.license} · ${Math.round(item.bytes / 1024)} kB`}
          onclick={() => useBundledFont(item)}
        >
          <span class="glyph" aria-hidden="true">Aa</span>
          <span class="name">{bundledName(item)}</span>
        </button>
      {/each}
    </div>
  </div>
  {#if source === 'service' && resourceProvider}
    {#if searchError}<p class="search-error" role="alert">
        <span>{searchError}</span>
        <button type="button" onclick={() => void searchRemote(remotePage)}>Retry</button>
      </p>{/if}
    <div
      class="grid"
      class:font-list={remoteKind === 'fonts'}
      class:busy={remoteLoading}
      role="group"
      aria-label="Catalogue results"
    >
      {#each shownAssets as item (item.id)}
        <div class="tile-wrap">
          <button
            type="button"
            class="tile"
            class:active={isSelected('asset', item.id)}
            aria-pressed={isSelected('asset', item.id)}
            title={`${item.title} · ${item.provider} · ${item.category}`}
            onclick={() => (selected = { kind: 'asset', item })}
            ondblclick={() => useRemoteAsset(item)}
            draggable="true"
            ondragstart={(event) => dragTile(event, item.title, (at) => useRemoteAsset(item, at))}
            ondragend={endDrag}
          >
            <span class="thumb"><RemoteAssetPreview provider={resourceProvider} path={item.previewUrl} alt="" /></span>
            <span class="name">{item.title}</span>
            <span class="sub">{item.category}</span>
          </button>
          <button
            type="button"
            class="star"
            aria-label={`Favourite ${item.title}`}
            aria-pressed={isRemoteFavorite('asset', item.id)}
            class:on={isRemoteFavorite('asset', item.id)}
            onclick={() => void favoriteRemote('asset', item)}>★</button
          >
        </div>
      {/each}
      {#each shownFonts as item (item.id)}
        <div class="tile-wrap">
          <button
            type="button"
            class="font-row"
            class:active={isSelected('font', item.id)}
            aria-pressed={isSelected('font', item.id)}
            title={`${item.family} · ${item.provider} · ${item.category}`}
            onclick={() => (selected = { kind: 'font', item })}
            ondblclick={() => useRemoteFont(item)}
            draggable="true"
            ondragstart={(event) => dragTile(event, item.family, () => useRemoteFont(item))}
            ondragend={endDrag}
          >
            <span class="font-sample"
              >{#key item.id}<RemoteAssetPreview
                  provider={resourceProvider}
                  path={fontSample(item)}
                  alt={item.family}
                />{/key}</span
            >
            <span class="font-meta"
              ><span class="name">{item.family}</span><span class="sub"
                >{item.category} · {item.variants.length}
                {item.variants.length === 1 ? 'style' : 'styles'}{item.availability === 'remote'
                  ? ' · download'
                  : ''}</span
              ></span
            >
          </button>
          <button
            type="button"
            class="star"
            aria-label={`Favourite ${item.family}`}
            aria-pressed={isRemoteFavorite('font', item.id)}
            class:on={isRemoteFavorite('font', item.id)}
            onclick={() => void favoriteRemote('font', item)}>★</button
          >
        </div>
      {/each}
    </div>
    {#if onlyFavorites && !shownAssets.length && !shownFonts.length}<p class="empty">
        No favourite {remoteKind} yet. Star a tile to keep it here.
      </p>
    {:else if !onlyFavorites && !remoteLoading && remoteTotal === 0}<p class="empty">No matching {remoteKind}.</p>{/if}
    {#if !onlyFavorites}<nav class="pager">
        <button type="button" onclick={() => searchRemote(remotePage - 1)} disabled={remoteLoading || remotePage <= 1}
          >Previous</button
        ><span>Page {remotePage} of {remotePages}{remoteTotal ? ` · ${remoteTotal} ${remoteKind}` : ''}</span><button
          type="button"
          onclick={() => searchRemote(remotePage + 1)}
          disabled={remoteLoading || remotePage >= remotePages}>Next</button
        >
      </nav>{/if}
  {:else}
    <div class="grid" role="group" aria-label="Browser assets">
      {#each results as item (item.id)}
        <div class="tile-wrap">
          <button
            type="button"
            class="tile"
            class:active={isSelected('local', item.id)}
            aria-pressed={isSelected('local', item.id)}
            title={`${item.name} · ${item.kind} · ${item.category}`}
            onclick={() => (selected = { kind: 'local', item })}
            ondblclick={() => use(item)}
            draggable="true"
            ondragstart={(event) => dragTile(event, item.name, (at) => use(item, at))}
            ondragend={endDrag}
          >
            <span class="thumb"
              >{#if item.dataBase64 && item.mediaType === 'image/svg+xml'}<img
                  alt=""
                  src={`data:image/svg+xml;base64,${item.dataBase64}`}
                />{:else}<span class="glyph" aria-hidden="true"
                  >{item.kind === 'font' ? 'Aa' : item.kind === 'template' ? '▤' : '▧'}</span
                >{/if}</span
            >
            <span class="name">{item.name}</span>
            <span class="sub">{item.category}</span>
          </button>
          <button
            type="button"
            class="star"
            aria-label={`Favourite ${item.name}`}
            aria-pressed={favorites.has(item.id)}
            class:on={favorites.has(item.id)}
            onclick={() => void favorite(item.id)}>★</button
          >
        </div>
      {/each}
    </div>
    {#if !all.length}<p class="empty">
        {onlyFavorites
          ? 'No favourites match. Star a tile to keep it here.'
          : 'Nothing in this browser matches. Import a file below or switch to the catalogue.'}
      </p>{/if}
    <nav class="pager">
      <button type="button" onclick={() => page--} disabled={page === 0}>Previous</button><span
        >Page {page + 1} of {pages}{all.length ? ` · ${all.length} assets` : ''}</span
      ><button type="button" onclick={() => page++} disabled={page + 1 >= pages}>Next</button>
    </nav>
  {/if}

  <details class="import" bind:open={importOpen}>
    <summary>Import files</summary>
    <div class="actions">
      <label class="upload"
        >Image/SVG/PDF<input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,.svg,.webp,application/pdf"
          onchange={asset}
        /></label
      >
      <label class="upload">Font<input type="file" accept=".woff,.woff2,.ttf,.otf,.ttc" onchange={font} /></label>
      <label class="upload"
        >Private .mb-assets<input type="file" accept=".mb-assets,application/json" onchange={collection} /></label
      >
      <button type="button" onclick={exportCollection} disabled={!privateAssets.length}
        >Export private collection</button
      >
    </div>
    <label class="render-profile"
      >Image rendering for imports<select bind:value={imageProfile}
        ><option value="photo">Photo · smooth tones</option><option value="logo">Logo · crisp ordered dots</option
        ><option value="line-art">Line art · solid black/white</option></select
      ><small
        >The original stays intact. Rendering happens at the selected printer's {editor.document.media.dpi} dpi and can be
        changed later in Properties.</small
      ></label
    >
  </details>
</section>

<style>
  .assets {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.75rem;
    font-size: 0.78rem;
  }
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .segmented {
    display: flex;
    border: 1px solid var(--mble-border-strong);
    border-radius: var(--mble-radius-sm);
    overflow: hidden;
  }
  .segmented button {
    flex: 1;
    padding: 0.3rem 0.4rem;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--mble-text-muted);
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
  }
  .segmented button + button {
    border-left: 1px solid var(--mble-border-strong);
  }
  .segmented button.active {
    background: var(--mble-primary);
    color: var(--mble-primary-text);
  }
  .segmented button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .toolbar input[type='search'] {
    box-sizing: border-box;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .chip {
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--mble-border);
    border-radius: 999px;
    background: var(--mble-surface);
    color: var(--mble-text);
    font-size: 0.68rem;
    cursor: pointer;
  }
  .chip.active {
    background: var(--mble-text);
    border-color: var(--mble-text);
    color: var(--mble-surface);
  }
  .chip .count {
    margin-left: 0.3rem;
    opacity: 0.65;
  }
  .status {
    min-height: 1em;
    margin: 0;
    color: var(--mble-text-muted);
    font-size: 0.7rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.2rem, 1fr));
    gap: 0.4rem;
  }
  .grid.busy {
    opacity: 0.55;
  }
  .grid.font-list {
    grid-template-columns: 1fr;
    gap: 0.3rem;
  }
  .font-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    position: relative;
    padding: 0.35rem 2rem 0.35rem 0.5rem;
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-sm);
    background: var(--mble-paper);
    color: var(--mble-ink);
    cursor: grab;
    text-align: left;
  }
  .font-row:hover {
    border-color: var(--mble-border-strong);
  }
  .font-row.active {
    border-color: var(--mble-primary);
    box-shadow: 0 0 0 1px var(--mble-primary);
  }
  .font-sample {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 2.1rem;
    overflow: hidden;
  }
  .font-sample :global(img) {
    display: block;
    height: 100%;
    width: auto;
    max-width: none;
    pointer-events: none;
  }
  .font-sample :global(.preview) {
    width: 100%;
    height: 100%;
  }
  .font-meta {
    display: flex;
    flex-direction: column;
    flex: none;
    max-width: 40%;
    min-width: 0;
  }
  .font-meta .name {
    color: var(--mble-ink);
  }
  .font-meta .sub {
    color: var(--mble-text-muted);
  }
  .detail.font {
    grid-template-columns: 1fr;
  }
  .detail.font .preview {
    aspect-ratio: auto;
    height: 3.6rem;
    padding: 0.3rem 0.5rem;
    justify-items: start;
  }
  .detail.font .preview :global(img) {
    width: auto;
    max-width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: left center;
  }
  .tile {
    position: relative;
    cursor: grab;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.3rem;
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-sm);
    background: var(--mble-surface);
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .tile:hover {
    border-color: var(--mble-border-strong);
  }
  .tile:active {
    cursor: grabbing;
  }
  .tile.active {
    border-color: var(--mble-primary);
    box-shadow: 0 0 0 1px var(--mble-primary);
  }
  .bundled {
    padding: 0 0.1rem 0.4rem;
  }
  .bundled h3 {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    margin: 0.2rem 0 0.35rem;
    color: var(--mble-text-muted);
    font-size: 0.7rem;
    font-weight: 600;
  }
  .bundled h3 small {
    font-weight: 400;
  }
  .bundled-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .bundled-font {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.45rem;
    border: 1px solid var(--mble-border);
    border-radius: 3px;
    background: var(--mble-surface);
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
  }
  .bundled-font:hover {
    border-color: var(--mble-border-strong);
  }
  .bundled-font .glyph {
    font-size: 0.9rem;
  }
  .thumb {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    background: var(--mble-paper);
    border-radius: 3px;
    overflow: hidden;
  }
  .thumb :global(img) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
  .thumb :global(.preview) {
    width: 100%;
    height: 100%;
  }
  .glyph {
    font-size: 1.4rem;
    color: var(--mble-text-muted);
  }
  .name {
    overflow: hidden;
    font-size: 0.68rem;
    line-height: 1.25;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sub {
    overflow: hidden;
    color: var(--mble-text-muted);
    font-size: 0.62rem;
    line-height: 1.2;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tile-wrap {
    position: relative;
    display: flex;
    min-width: 0;
  }
  .tile-wrap > .tile,
  .tile-wrap > .font-row {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
  }
  .search-error {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 0.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--mble-danger);
    border-radius: var(--mble-radius-sm);
    color: var(--mble-danger);
    font-size: 0.75rem;
  }
  .star {
    position: absolute;
    top: 0.15rem;
    right: 0.2rem;
    display: grid;
    place-items: center;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--mble-surface) 85%, transparent);
    color: var(--mble-border-strong);
    font-size: 0.85rem;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .tile-wrap:hover .star,
  .tile-wrap:focus-within .star,
  .star.on {
    opacity: 1;
  }
  @media (hover: none) {
    .star {
      opacity: 1;
    }
  }
  .star.on {
    color: var(--mble-primary);
  }
  .search-row {
    display: flex;
    gap: 0.3rem;
  }
  .search-row input {
    flex: 1;
    min-width: 0;
  }
  .favorites-toggle {
    flex: none;
    padding: 0.2rem 0.45rem;
    border: 1px solid var(--mble-border-strong);
    border-radius: var(--mble-radius-sm);
    background: var(--mble-surface);
    color: var(--mble-text-muted);
    cursor: pointer;
  }
  .favorites-toggle .count {
    margin-left: 0.25rem;
    font-size: 0.68rem;
  }
  .favorites-toggle.active {
    background: var(--mble-primary);
    border-color: var(--mble-primary);
    color: var(--mble-primary-text);
  }
  .empty,
  .hint {
    margin: 0;
    color: var(--mble-text-muted);
    font-size: 0.7rem;
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: var(--mble-text-muted);
  }
  .detail {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    gap: 0.6rem;
    padding: 0.5rem;
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-sm);
    background: var(--mble-background);
  }
  .preview {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    background: var(--mble-paper);
    border-radius: 3px;
    overflow: hidden;
  }
  .preview :global(img) {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .meta strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta small {
    color: var(--mble-text-muted);
    font-size: 0.68rem;
  }
  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.2rem;
  }
  .primary {
    background: var(--mble-primary);
    color: var(--mble-primary-text);
    border-color: var(--mble-primary);
  }
  .render-profile {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.7rem;
  }
  .render-profile small {
    line-height: 1.35;
    color: var(--mble-text-muted);
  }
  .import summary {
    cursor: pointer;
    color: var(--mble-text-muted);
    font-size: 0.72rem;
    font-weight: 600;
  }
  .import .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0.4rem 0;
  }
  .upload {
    border: 1px solid var(--mble-border-strong);
    padding: 0.3rem;
    border-radius: var(--mble-radius-sm);
    cursor: pointer;
  }
  .upload input {
    position: absolute;
    opacity: 0;
    width: 1px;
  }
</style>
