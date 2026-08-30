<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorStore } from '../store.js';
  import type { PrinterSdk } from '../print/types.js';
  import { addElement, addFont, addResource } from '../commands.js';
  import { importAsset, importFont } from '../imports.js';
  import { uuid, type Resource, type FontResource } from '../model.js';
  import { AssetCatalogue, type CatalogueAsset } from '../catalogue.js';
  import type { ExternalAsset, ExternalFont, ExternalResourceProvider } from '../external-resources/types.js';
  import { EditorDatabase } from '../persistence/database.js';
  import RemoteAssetPreview from './RemoteAssetPreview.svelte';
  import manifest from '../../../assets/public-catalogue.json';

  export let editor: EditorStore;
  export let sdk: PrinterSdk | undefined = undefined;
  export let resourceProvider: ExternalResourceProvider | undefined = undefined;

  const database = new EditorDatabase();
  const pageSize = 12;
  let query = '';
  let category = '';
  let status = '';
  let source: 'service' | 'browser' = resourceProvider ? 'service' : 'browser';
  let remoteKind: 'assets' | 'fonts' = 'assets';
  let privateAssets: CatalogueAsset[] = [];
  let savedResources: Resource[] = [];
  let favorites = new Set<string>();
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

  $: catalogue = new AssetCatalogue([...(manifest as CatalogueAsset[]).filter(item => item.visibility === 'public'), ...privateAssets]);
  $: all = catalogue.search({ query, category: category || undefined }).sort((a, b) => recents.indexOf(b.id) - recents.indexOf(a.id));
  $: results = all.slice(page * pageSize, (page + 1) * pageSize);
  $: pages = Math.max(1, Math.ceil(all.length / pageSize));
  $: if (mounted && source === 'service' && resourceProvider) {
    query; category; remoteKind;
    scheduleRemoteSearch();
  }

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
    recents = (await database.get<string[]>('preferences', 'asset-recents')) ?? [];
  }

  function scheduleRemoteSearch() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void searchRemote(1), 250);
  }

  async function searchRemote(nextPage: number) {
    if (!resourceProvider) return;
    const sequence = ++requestSequence;
    remoteLoading = true;
    try {
      const common = { query, categories: category ? [category] : undefined, page: nextPage, pageSize };
      const result = remoteKind === 'assets'
        ? await resourceProvider.searchAssets(common)
        : await resourceProvider.searchFonts(common);
      if (sequence !== requestSequence) return;
      remotePage = result.page;
      remotePages = result.pages;
      remoteTotal = result.total;
      if (remoteKind === 'assets') { remoteAssets = result.items as ExternalAsset[]; remoteFonts = []; }
      else { remoteFonts = result.items as ExternalFont[]; remoteAssets = []; }
      status = `${result.total} ${remoteKind} from ${resourceProvider.displayName}.`;
    } catch (error) {
      if (sequence === requestSequence) status = message(error);
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
  function place(resource: Resource, width = 20, height = 20) {
    if (resource.mimeType.startsWith('font/')) { editor.execute(addFont(resource as FontResource)); return; }
    editor.execute(addResource(resource));
    const base = { id: uuid(), name: resource.name, resourceId: resource.id, transform: { x: 2, y: 2, width, height, rotation: 0 }, zIndex: $editor.document.elements.length, visible: true, locked: false };
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
  async function use(item: CatalogueAsset) {
    if (!item.dataBase64) return;
    await verifiedBytes(item);
    const resource = { id: uuid(), name: item.name, mimeType: item.mediaType, sha256: item.sha256, data: item.dataBase64 };
    place(resource);
    await saveResource(resource);
    await remember(item.id);
    status = `Added ${item.name}`;
  }
  async function useRemoteAsset(item: ExternalAsset) {
    if (!resourceProvider) return;
    try {
      status = `Downloading ${item.title}…`;
      const blob = await resourceProvider.fetchBlob(item.contentUrl);
      const file = new File([blob], item.title, { type: blob.type });
      if (blob.type.startsWith('font/')) {
        const imported = await importFont(file);
        editor.execute(addFont(imported));
        await saveResource(imported);
      } else {
        const imported = await importAsset(file, sdk, $editor.document.media.dpi);
        place(imported.resource, imported.widthMm ?? 20, imported.heightMm ?? 20);
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

<section>
  <h2>Asset catalogue</h2>
  <div class="filters">
    <select bind:value={source} aria-label="Asset source"><option value="browser">This browser</option><option value="service" disabled={!resourceProvider}>{resourceProvider?.displayName ?? 'External resources'}</option></select>
    {#if source === 'service'}<select bind:value={remoteKind} aria-label="Remote asset kind"><option value="assets">Graphics</option><option value="fonts">Fonts</option></select>{/if}
    <input type="search" bind:value={query} on:input={() => page = 0} placeholder="Search catalogue">
    {#if source === 'browser'}<select bind:value={category} on:change={() => page = 0} aria-label="Asset category"><option value="">All categories</option>{#each catalogue.categories as item}<option>{item}</option>{/each}</select>{:else}<input type="text" bind:value={category} placeholder="Category (optional)" aria-label="Asset category">{/if}
  </div>
  <div class="actions"><label>Image/SVG/PDF<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,.svg,.webp,application/pdf" on:change={asset}></label><label>Font<input type="file" accept=".woff,.woff2,.ttf,.otf,.ttc" on:change={font}></label><label>Private .mb-assets<input type="file" accept=".mb-assets,application/json" on:change={collection}></label><button on:click={exportCollection} disabled={!privateAssets.length}>Export private collection</button></div>
  <label class="render-profile">Image rendering<select bind:value={imageProfile}><option value="photo">Photo · smooth tones</option><option value="logo">Logo · crisp ordered dots</option><option value="line-art">Line art · solid black/white</option></select><small>The original stays intact. Rendering happens at the selected printer's {$editor.document.media.dpi} dpi and can be changed later in Properties.</small></label>
  <p aria-live="polite">{remoteLoading ? `Searching ${resourceProvider?.displayName ?? 'external resources'}…` : status}</p>

  {#if source === 'service' && resourceProvider}
    <ul class:busy={remoteLoading}>
      {#each remoteAssets as item (item.id)}<li><RemoteAssetPreview provider={resourceProvider} path={item.previewUrl} alt=""/><button on:click={() => useRemoteAsset(item)}>{item.title}</button><small>{item.provider} · {item.category} · {item.kinds.join(', ')}</small></li>{/each}
      {#each remoteFonts as item (item.id)}<li><RemoteAssetPreview provider={resourceProvider} path={item.previewUrl} alt=""/><button on:click={() => useRemoteFont(item)}>{item.family}</button><small>{item.provider} · {item.category} · {item.availability} · {item.license}</small></li>{/each}
    </ul>
    {#if !remoteLoading && remoteTotal === 0}<p>No matching remote {remoteKind}.</p>{/if}
    <nav><button on:click={() => searchRemote(remotePage - 1)} disabled={remoteLoading || remotePage <= 1}>Previous</button><span>{remotePage}/{remotePages}</span><button on:click={() => searchRemote(remotePage + 1)} disabled={remoteLoading || remotePage >= remotePages}>Next</button></nav>
  {:else}
    <ul>{#each results as item}<li>{#if item.dataBase64 && item.mediaType === 'image/svg+xml'}<img alt="" src={`data:image/svg+xml;base64,${item.dataBase64}`}>{:else}<span class="kind" aria-hidden="true">{item.kind === 'font' ? 'Aa' : item.kind === 'template' ? '▤' : '▧'}</span>{/if}<button class="star" aria-label={`Favorite ${item.name}`} aria-pressed={favorites.has(item.id)} on:click={() => favorite(item.id)}>★</button><button on:click={() => use(item)}>{item.name}</button><small>{item.kind} · {item.category} · {item.visibility}{recents.includes(item.id) ? ' · recent' : ''}</small></li>{/each}{#each savedResources.filter(item => item.name.toLowerCase().includes(query.toLowerCase())) as item}<li><span>▧</span><button on:click={() => place(item)}>Place {item.name}</button><small>{item.mimeType} · persisted private library</small></li>{/each}</ul>
    <nav><button on:click={() => page--} disabled={page === 0}>Previous</button><span>{page + 1}/{pages}</span><button on:click={() => page++} disabled={page + 1 >= pages}>Next</button></nav>
  {/if}
</section>
<style>
  section{padding:.7rem .75rem;border-top:1px solid var(--mble-border,#e5dfd5)}h2{margin:0 0 .5rem;color:var(--mble-text-muted,#59635e);font-size:.75rem;font-weight:600}.filters,.actions{display:flex;gap:.3rem;flex-wrap:wrap}.filters input[type=search]{flex:1;min-width:10rem}.actions{margin-top:.4rem}.actions label{border:1px solid var(--mble-border-strong,#bbb);padding:.3rem}.actions input{position:absolute;opacity:0;width:1px}.render-profile{display:flex;flex-direction:column;gap:.2rem;margin:.55rem 0 0;font-size:.72rem}.render-profile small{line-height:1.35}ul{list-style:none;padding:0;max-height:24rem;overflow:auto}ul.busy{opacity:.55}li{display:grid;grid-template-columns:2.5rem minmax(0,1fr);gap:.15rem .4rem;align-items:center;margin:.25rem 0}li :global(img){grid-row:span 2;width:2.5rem;height:2.5rem;object-fit:contain}li>.kind,li>span:first-child{grid-row:span 2}.star{position:absolute;margin-left:1.3rem;padding:.1rem}small{color:var(--mble-text-muted,#666);overflow:hidden;text-overflow:ellipsis}nav{display:flex;justify-content:space-between}
</style>
