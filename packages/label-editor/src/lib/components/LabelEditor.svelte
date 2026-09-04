<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { EditorStore } from '../store.svelte.js';
  import { ZOOM_STEP } from '../view.js';
  import type { PrinterDefinition, PrinterSdk } from '../print/types.js';
  import type { DocumentMaterializer } from '../materialization.js';
  import type { AssetCatalogClient } from '../asset-catalog/client.js';
  import type { ExternalResourceProvider } from '../external-resources/types.js';
  import {
    addElement,
    groupElements,
    moveElements,
    removeElements,
    resizeElements,
    rotateElements,
    ungroup,
  } from '../commands.js';
  import { isEffectivelyLocked } from '../model.js';
  import { selectionBounds } from '../zones.js';
  import { copyElements, pasteElements } from '../clipboard.js';
  import Canvas from './Canvas.svelte';
  import ShortcutsPanel from './ShortcutsPanel.svelte';
  import TemplateSyntaxPanel from './TemplateSyntaxPanel.svelte';
  import Inspector from './Inspector.svelte';
  import Layers from './Layers.svelte';
  import DataPanel from './DataPanel.svelte';
  import DataSheet from './DataSheet.svelte';
  import { toolForKey } from '../insert.js';
  import AssetPanel from './AssetPanel.svelte';
  import MediaPanel from './MediaPanel.svelte';
  import LibraryPanel from './LibraryPanel.svelte';
  import GuidesPanel from './GuidesPanel.svelte';
  import ToolRail from './ToolRail.svelte';
  import HistoryButtons from './HistoryButtons.svelte';
  import DocumentTitle from './DocumentTitle.svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import EditorMenus from './EditorMenus.svelte';
  import Modal from './Modal.svelte';
  interface Props {
    editor: EditorStore;
    sdk?: PrinterSdk;
    materializer?: Pick<DocumentMaterializer, 'materializeRecord'>;
    resourceProvider?: ExternalResourceProvider;
    /** @deprecated Pass resourceProvider instead. */
    assetCatalog?: AssetCatalogClient;
    printers?: PrinterDefinition[];
    printerId?: string;
    onPrinter?: (id: string) => void;
    /** What the host knows about persistence, shown under the document title (for example "Saved"). */
    saveState?: string;
    /** Host-provided regions of the shell: brand lockup, extra menus, header actions and the printer tab. */
    brand?: Snippet;
    menuStart?: Snippet;
    menuEnd?: Snippet;
    actions?: Snippet;
    sidebar?: Snippet;
  }
  let {
    editor,
    sdk,
    materializer,
    resourceProvider,
    assetCatalog,
    printers = [],
    printerId = '',
    onPrinter = () => {},
    saveState = '',
    brand,
    menuStart,
    menuEnd,
    actions,
    sidebar,
  }: Props = $props();
  /** Below 64rem the selection bar folds its alignment tools away and the tool rail runs along the top. */
  const narrow = new MediaQuery('(max-width: 64rem)');
  /** Below 40rem the menus collapse behind one Menu button. */
  const phone = new MediaQuery('(max-width: 40rem)');
  /** Below 48rem the side panel overlays the label: a right drawer on tablets, a bottom sheet on phones. */
  const tablet = new MediaQuery('(max-width: 48rem)');
  /** From 90rem the layers and properties get their own pinned rail. */
  const wide = new MediaQuery('(min-width: 90rem)');
  const layout = $derived<'phone' | 'tablet' | 'desktop' | 'wide'>(
    phone.current ? 'phone' : tablet.current ? 'tablet' : wide.current ? 'wide' : 'desktop',
  );
  /** Overlays start closed so the label is visible first; side-by-side layouts start open. Kept per layout. */
  const openByLayout = $state({ phone: false, tablet: false, desktop: true, wide: true });
  const sidebarOpen = $derived(openByLayout[layout]);
  function setSidebarOpen(open: boolean) {
    openByLayout[layout] = open;
  }
  let dialog = $state('');
  const activeResourceProvider = $derived(resourceProvider ?? assetCatalog);
  const selectedPrinter = $derived(printers.find((item) => item.id === printerId));
  const dialogTitles: Record<string, string> = {
    media: 'Media & zones',
    data: 'Data',
    assets: 'Assets',
    library: 'Library',
    guides: 'Guides',
    shortcuts: 'Keyboard shortcuts',
    syntax: 'Template syntax',
  };
  type SidebarTab = 'layers' | 'assets' | 'data' | 'printer';
  const sidebarTabs: SidebarTab[] = ['layers', 'assets', 'data', 'printer'];
  const sidebarTabKey = 'mb-label-editor:sidebar-tab';
  /** The chosen tab survives reloads; storage may be unavailable in private windows. */
  let sidebarTab: SidebarTab = $state(
    (() => {
      try {
        const saved = globalThis.localStorage?.getItem(sidebarTabKey);
        return sidebarTabs.includes(saved as SidebarTab) ? (saved as SidebarTab) : 'layers';
      } catch {
        return 'layers';
      }
    })(),
  );
  /** From 90rem the layers and properties get their own permanent rail beside the tabbed one. */
  /** The record sheet can leave the side panel: a region under the label on desktop, a dialog on small screens. */
  let sheetDocked = $state(false);
  const sheetOpen = $derived(sheetDocked && !!editor.document.template);
  const tabs = $derived(wide.current ? sidebarTabs.filter((tab) => tab !== 'layers') : sidebarTabs);
  const activeTab = $derived(wide.current && sidebarTab === 'layers' ? 'assets' : sidebarTab);
  function selectSidebarTab(tab: SidebarTab) {
    sidebarTab = tab;
    try {
      globalThis.localStorage?.setItem(sidebarTabKey, tab);
    } catch {
      /* storage unavailable */
    }
  }
  function tabKeys(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = tabs.indexOf(activeTab);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectSidebarTab(next);
    (document.getElementById(`sidebar-tab-${next}`) as HTMLElement | null)?.focus();
  }
  /** Assets live in the sidebar; the Label menu entry reveals that tab instead of a dialog. */
  function openPanel(name: string) {
    if (name === 'assets' || name === 'data') {
      selectSidebarTab(name);
      setSidebarOpen(true);
    } else dialog = name;
  }
  const sidebarWidthKey = 'mb-label-editor:sidebar-width';
  const defaultSidebarWidth = 304;
  const minSidebarWidth = 240;
  /** Width in pixels; wider panels let the asset grid grow more columns and keep font rows from wrapping. */
  /** Never more than half the window, and capped so the label keeps room: 480px on desktop, 720px with two rails. */
  const maxSidebarWidth = () =>
    Math.max(
      minSidebarWidth,
      Math.min(
        untrack(() => (wide.current ? 720 : 480)),
        Math.round((globalThis.innerWidth || 1200) * 0.5),
      ),
    );
  let sidebarWidth: number = $state(
    (() => {
      try {
        const saved = Number(globalThis.localStorage?.getItem(sidebarWidthKey));
        return Number.isFinite(saved) && saved >= minSidebarWidth
          ? Math.min(saved, maxSidebarWidth())
          : defaultSidebarWidth;
      } catch {
        return defaultSidebarWidth;
      }
    })(),
  );
  /** A smaller window re-clamps a remembered width instead of squeezing the label. */
  function reclampSidebar() {
    if (sidebarWidth > maxSidebarWidth()) sidebarWidth = maxSidebarWidth();
  }
  function setSidebarWidth(width: number) {
    sidebarWidth = Math.round(Math.min(maxSidebarWidth(), Math.max(minSidebarWidth, width)));
    try {
      globalThis.localStorage?.setItem(sidebarWidthKey, String(sidebarWidth));
    } catch {
      /* storage unavailable */
    }
  }
  let resizing: { pointerId: number; startX: number; startWidth: number } | undefined = $state();
  function startSidebarResize(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizing = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth };
    event.preventDefault();
  }
  function moveSidebarResize(event: PointerEvent) {
    if (!resizing || event.pointerId !== resizing.pointerId) return;
    setSidebarWidth(resizing.startWidth + (resizing.startX - event.clientX));
  }
  function endSidebarResize(event: PointerEvent) {
    if (resizing && event.pointerId === resizing.pointerId) resizing = undefined;
  }
  function sidebarResizeKeys(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSidebarWidth(sidebarWidth + step);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setSidebarWidth(sidebarWidth - step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSidebarWidth(maxSidebarWidth());
    } else if (event.key === 'End') {
      event.preventDefault();
      setSidebarWidth(minSidebarWidth);
    }
  }
  function groupSelected() {
    if (editor.selection.size < 2) return;
    const command = groupElements(editor.selection);
    editor.execute(command);
    editor.select([command.createdId]);
  }
  /** Keyboard resize grows or shrinks the selection's bounding box from its top-left, mirroring the south-east handle. */
  function resizeSelection(dw: number, dh: number) {
    const ids = [...editor.selection].filter((id) => {
      const item = editor.document.elements.find((element) => element.id === id);
      return item && !isEffectivelyLocked(editor.document, item);
    });
    const bounds = selectionBounds(editor.document, ids);
    if (!bounds) return;
    editor.execute(
      resizeElements(ids, {
        ...bounds,
        width: Math.max(0.1, Math.round((bounds.width + dw) * 100) / 100),
        height: Math.max(0.1, Math.round((bounds.height + dh) * 100) / 100),
      }),
    );
  }
  /** Keyboard rotation applies to a single non-group element, like the rotate handle. */
  function rotateSelection(delta: number) {
    const [only] = editor.selectedElements;
    if (editor.selectedElements.length !== 1 || !only || only.type === 'group') return;
    editor.execute(rotateElements([only.id], (((only.transform.rotation + delta) % 360) + 360) % 360));
  }
  function keys(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? editor.redo() : editor.undo();
    } else if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      editor.redo();
    } else if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      editor.select(editor.document.elements.map((e) => e.id));
    } else if (modifier && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copyElements(editor.document.elements, editor.selection);
    } else if (modifier && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      const items = pasteElements();
      for (const item of items) editor.execute(addElement(item));
      editor.select(items.map((i) => i.id));
    } else if (modifier && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (event.shiftKey) {
        for (const item of editor.selectedElements) if (item.type === 'group') editor.execute(ungroup(item.id));
      } else groupSelected();
    } else if (modifier && (event.key === '0' || event.code === 'Digit0')) {
      event.preventDefault();
      editor.setZoom(1);
    } else if (modifier && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      editor.setZoom(editor.view.zoom * ZOOM_STEP);
    } else if (modifier && event.key === '-') {
      event.preventDefault();
      editor.setZoom(editor.view.zoom / ZOOM_STEP);
    } else if (!modifier && event.shiftKey && event.code === 'Digit1') {
      event.preventDefault();
      editor.setView({ zoomMode: 'fit' });
    } else if (!modifier && event.shiftKey && event.code === 'Digit2') {
      event.preventDefault();
      editor.setZoom(2);
    } else if (event.key === 'Escape' && editor.tool) {
      event.preventDefault();
      editor.setTool(undefined);
    } else if (!modifier && !event.altKey && !event.shiftKey && toolForKey(event.key)) {
      event.preventDefault();
      const tool = toolForKey(event.key);
      editor.setTool(editor.tool === tool ? undefined : tool);
    } else if (event.key === '?' && !modifier) {
      event.preventDefault();
      dialog = dialog === 'shortcuts' ? '' : 'shortcuts';
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      editor.execute(removeElements(editor.selection));
      editor.clearSelection();
    } else if (editor.selection.size && (event.key === '[' || event.key === ']')) {
      event.preventDefault();
      rotateSelection((event.key === ']' ? 1 : -1) * (event.shiftKey ? 1 : 15));
    } else if (
      editor.selection.size &&
      modifier &&
      event.altKey &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      event.preventDefault();
      rotateSelection(event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1);
    } else if (
      editor.selection.size &&
      modifier &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      event.preventDefault();
      const step = event.shiftKey ? 1 : 0.1;
      resizeSelection(
        event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0,
        event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0,
      );
    } else if (editor.selection.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const step = event.shiftKey ? 1 : 0.1;
      editor.execute(
        moveElements(editor.selection, {
          x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
          y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
        }),
      );
    }
  }
</script>

<svelte:window onkeydown={keys} onresize={reclampSidebar} />
<div class="editor mb-label-editor">
  {#snippet layersStack()}
    <!-- Layers scroll on their own so the properties below never leave the screen. -->
    <div class="stack">
      <section class="layers-pane" aria-label="Layers">
        <h3 class="pane-title">Layers</h3>
        <Layers {editor} title={undefined} />
      </section>
      <section class="props-pane" aria-label="Properties">
        <h3 class="pane-title">Properties</h3>
        <Inspector {editor} title={undefined} />
      </section>
    </div>
  {/snippet}
  {#snippet menus()}
    {@render menuStart?.()}
    <EditorMenus {editor} {sidebarOpen} onOpen={openPanel} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
    <HistoryButtons {editor} />
    {@render menuEnd?.()}
  {/snippet}
  <header class="appbar" class:phone={phone.current}>
    <div class="brand">{@render brand?.()}</div>
    <DocumentTitle {editor} {saveState} />
    {#if phone.current}
      <details class="menu-drawer">
        <summary aria-label="Menu" title="Menu">☰</summary>
        <nav class="menubar" aria-label="Editor menus">{@render menus()}</nav>
      </details>
    {:else}
      <nav class="menubar" aria-label="Editor menus">{@render menus()}</nav>
    {/if}
    <span class="media-chip" title="Label media"
      >{editor.document.media.width} × {editor.document.media.height} mm · {editor.document.media.shape}</span
    >
    <div class="appbar-actions">{@render actions?.()}</div>
  </header>
  <main
    class:sidebar-closed={!sidebarOpen}
    class:wide={wide.current}
    class:overlay={tablet.current}
    style={`--sidebar-width:${sidebarWidth}px`}
  >
    <ToolRail {editor} orientation={narrow.current ? 'horizontal' : 'vertical'} />
    <div class="canvas">
      <div class="canvas-area">
        <Canvas {editor} {sdk} {materializer} printer={selectedPrinter} compact={narrow.current} />
      </div>
      {#if sheetOpen && !narrow.current}
        <section class="sheet-dock" aria-label="Data records">
          <div class="sheet-dock-bar">
            <h2>Data records</h2>
            <button type="button" onclick={() => (sheetDocked = false)}>Collapse sheet</button>
          </div>
          <div class="sheet-dock-body"><DataSheet {editor} /></div>
        </section>
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    {#if sidebarOpen}<div
        class="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        aria-valuemin={minSidebarWidth}
        aria-valuemax={maxSidebarWidth()}
        aria-valuenow={sidebarWidth}
        tabindex="0"
        title="Drag to resize the side panel"
        onpointerdown={startSidebarResize}
        onpointermove={moveSidebarResize}
        onpointerup={endSidebarResize}
        onpointercancel={endSidebarResize}
        onkeydown={sidebarResizeKeys}
        ondblclick={() => setSidebarWidth(defaultSidebarWidth)}
      ></div>{/if}
    <aside id="side-panels" class:open={sidebarOpen}>
      <div class="tabs mb-tabs" role="tablist" aria-label="Side panels">
        {#if !wide.current}<button
            type="button"
            role="tab"
            class="mb-tab"
            id="sidebar-tab-layers"
            aria-selected={activeTab === 'layers'}
            aria-controls="sidebar-panel-layers"
            tabindex={activeTab === 'layers' ? 0 : -1}
            onclick={() => selectSidebarTab('layers')}
            onkeydown={tabKeys}>Layers</button
          >{/if}
        <button
          type="button"
          role="tab"
          class="mb-tab"
          id="sidebar-tab-assets"
          aria-selected={activeTab === 'assets'}
          aria-controls="sidebar-panel-assets"
          tabindex={activeTab === 'assets' ? 0 : -1}
          onclick={() => selectSidebarTab('assets')}
          onkeydown={tabKeys}>Assets</button
        >
        <button
          type="button"
          role="tab"
          class="mb-tab"
          id="sidebar-tab-data"
          aria-selected={activeTab === 'data'}
          aria-controls="sidebar-panel-data"
          tabindex={activeTab === 'data' ? 0 : -1}
          onclick={() => selectSidebarTab('data')}
          onkeydown={tabKeys}>Data</button
        >
        <button
          type="button"
          role="tab"
          class="mb-tab"
          id="sidebar-tab-printer"
          aria-selected={activeTab === 'printer'}
          aria-controls="sidebar-panel-printer"
          tabindex={activeTab === 'printer' ? 0 : -1}
          onclick={() => selectSidebarTab('printer')}
          onkeydown={tabKeys}>Printer</button
        >
      </div>
      {#if !wide.current}
        <div
          id="sidebar-panel-layers"
          class="layers-panel"
          role="tabpanel"
          aria-labelledby="sidebar-tab-layers"
          hidden={activeTab !== 'layers'}
        >
          {@render layersStack()}
        </div>
      {/if}
      <div
        id="sidebar-panel-assets"
        role="tabpanel"
        aria-labelledby="sidebar-tab-assets"
        hidden={activeTab !== 'assets'}
      >
        <AssetPanel {editor} {sdk} resourceProvider={activeResourceProvider} active={activeTab === 'assets'} />
      </div>
      <div id="sidebar-panel-data" role="tabpanel" aria-labelledby="sidebar-tab-data" hidden={activeTab !== 'data'}>
        <DataPanel
          {editor}
          onSyntaxHelp={() => (dialog = 'syntax')}
          docked={sheetOpen}
          onDock={() => (sheetDocked = !sheetDocked)}
        />
      </div>
      <div
        id="sidebar-panel-printer"
        role="tabpanel"
        aria-labelledby="sidebar-tab-printer"
        hidden={activeTab !== 'printer'}
      >
        {@render sidebar?.()}
      </div>
    </aside>
    {#if wide.current}<aside class="pinned" aria-label="Layers and properties">{@render layersStack()}</aside>{/if}
    {#if tablet.current}
      {#if sidebarOpen}<button
          type="button"
          class="scrim"
          tabindex="-1"
          aria-label="Close side panels"
          onclick={() => setSidebarOpen(false)}
        ></button>{/if}
      <button
        type="button"
        class="panels-toggle"
        aria-expanded={sidebarOpen}
        aria-controls="side-panels"
        onclick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? 'Close panels' : 'Panels'}</button
      >
    {/if}
  </main>
  <Modal open={dialog === 'media'} title={dialogTitles.media} onClose={() => (dialog = '')}
    ><MediaPanel title={undefined} {editor} {sdk} {materializer} {printers} {printerId} {onPrinter} /></Modal
  >
  <Modal open={dialog === 'library'} title={dialogTitles.library} onClose={() => (dialog = '')}
    ><LibraryPanel title={undefined} {editor} /></Modal
  >
  <Modal open={dialog === 'guides'} title={dialogTitles.guides} onClose={() => (dialog = '')}
    ><GuidesPanel title={undefined} {editor} /></Modal
  >
  <Modal open={dialog === 'shortcuts'} title={dialogTitles.shortcuts} onClose={() => (dialog = '')}
    ><ShortcutsPanel title={undefined} /></Modal
  >
  <Modal open={dialog === 'syntax'} title={dialogTitles.syntax} onClose={() => (dialog = '')}
    ><TemplateSyntaxPanel title={undefined} {editor} /></Modal
  >
  <Modal open={sheetOpen && narrow.current} title="Data records" size="lg" onClose={() => (sheetDocked = false)}
    ><DataSheet {editor} /></Modal
  >
</div>

<style>
  .editor {
    height: 100%;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: var(--mble-text);
    background: var(--mble-background);
    font-family: var(--mble-font-ui);
  }
  .appbar {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    min-width: 0;
    flex: none;
    padding: calc(0.3rem + env(safe-area-inset-top, 0px)) calc(0.5rem + env(safe-area-inset-right, 0px)) 0.3rem
      calc(0.5rem + env(safe-area-inset-left, 0px));
    border-bottom: 1px solid var(--mble-border);
  }
  .brand {
    min-width: 0;
    display: flex;
    align-items: center;
  }
  .menubar {
    display: flex;
    gap: 0.1rem;
    align-items: center;
    flex-wrap: wrap;
    min-width: 0;
  }
  .appbar-actions {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    margin-left: auto;
  }
  .media-chip {
    flex: none;
    padding: 0.22rem 0.45rem;
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-sm);
    color: var(--mble-text-muted);
    font-size: var(--mble-text-small);
    white-space: nowrap;
  }
  .menu-drawer {
    position: relative;
  }
  .menu-drawer > summary {
    padding: 0.25rem 0.55rem;
    border-radius: var(--mble-radius-sm);
    list-style: none;
    font-size: var(--mble-text-h4);
    line-height: 1;
  }
  .menu-drawer > summary::-webkit-details-marker {
    display: none;
  }
  .menu-drawer[open] > summary {
    background: var(--mble-surface-sunken);
  }
  .menu-drawer > .menubar {
    position: absolute;
    left: 0;
    top: calc(100% + 0.3rem);
    z-index: var(--mble-z-menu);
    flex-direction: column;
    align-items: stretch;
    min-width: 12rem;
    padding: 0.35rem;
    background: var(--mble-surface);
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-md);
    box-shadow: var(--mble-shadow);
  }
  @media (max-width: 64rem) {
    .media-chip {
      display: none;
    }
  }
  main {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(20rem, 1fr) auto minmax(0, var(--sidebar-width, 19rem));
    min-width: 0;
    min-height: 0;
    flex: 1;
  }
  .sidebar-resizer {
    position: relative;
    z-index: var(--mble-z-panel-sticky);
    width: 6px;
    margin: 0 -3px;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
  }
  .sidebar-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 2px;
    background: transparent;
    transition: background var(--mble-dur-fast);
  }
  /* A finger needs a wider strip and a visible grip. */
  @media (pointer: coarse) {
    .sidebar-resizer {
      width: 16px;
      margin: 0 -8px;
    }
    .sidebar-resizer::after {
      left: 7px;
      top: 50%;
      bottom: auto;
      height: 3rem;
      transform: translateY(-50%);
      border-radius: 2px;
      background: var(--mble-border-strong);
    }
  }
  .sidebar-resizer:hover::after,
  .sidebar-resizer:focus-visible::after {
    background: var(--mble-primary);
  }
  .sidebar-resizer:focus-visible {
    outline: none;
  }
  .canvas {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .canvas-area {
    position: relative;
    isolation: isolate;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .sheet-dock {
    display: flex;
    flex-direction: column;
    max-height: 40%;
    border-top: 1px solid var(--mble-border);
    background: var(--mble-surface);
  }
  .sheet-dock-bar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0.75rem;
    border-bottom: 1px solid var(--mble-border);
  }
  .sheet-dock-bar h2 {
    margin: 0;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-small);
    font-weight: 600;
  }
  .sheet-dock-body {
    min-height: 0;
    overflow: auto;
    padding: 0 0.75rem 0.5rem;
  }
  main.sidebar-closed {
    grid-template-columns: auto minmax(0, 1fr);
  }
  main.sidebar-closed aside {
    display: none;
  }
  aside {
    width: 100%;
    box-sizing: border-box;
  }
  aside {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    overscroll-behavior: contain;
    background: var(--mble-background);
    border-left: 1px solid var(--mble-border);
  }
  aside [role='tabpanel'] {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }
  aside .layers-panel {
    overflow: hidden;
  }
  .stack {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .layers-pane {
    flex: 0 1 auto;
    max-height: 40%;
    min-height: 8rem;
    overflow: auto;
    overscroll-behavior: contain;
    border-bottom: 1px solid var(--mble-border);
  }
  .props-pane {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .pane-title {
    position: sticky;
    top: 0;
    z-index: var(--mble-z-panel-sticky);
    margin: 0;
    padding: 0.5rem 0.75rem 0.2rem;
    background: var(--mble-background);
    color: var(--mble-text-muted);
    font-size: var(--mble-text-micro);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  main.wide {
    grid-template-columns: auto minmax(20rem, 1fr) auto minmax(0, var(--sidebar-width, 19rem)) minmax(0, 20rem);
  }
  main.wide.sidebar-closed {
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 20rem);
  }
  aside.pinned {
    display: flex;
    flex-direction: column;
  }
  .tabs {
    position: sticky;
    top: 0;
    z-index: var(--mble-z-panel-sticky);
    display: flex;
    background: var(--mble-background);
    border-bottom: 1px solid var(--mble-border);
  }
  .tabs {
    gap: 0;
  }
  .tabs [role='tab'] {
    flex: 1;
    justify-content: center;
    padding-inline: 0.75rem;
    font-weight: 600;
  }
  aside [role='tabpanel'][hidden] {
    display: none;
  }
  @media (max-width: 48rem) {
    .appbar {
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .brand {
      flex: none;
      order: 0;
    }
    .appbar-actions {
      order: 1;
      margin-left: auto;
    }
    .menubar {
      order: 2;
      flex-basis: 100%;
    }
  }
  /* Tablet: the side panel is a drawer over the right of the label. */
  @media (max-width: 48rem) {
    .sidebar-resizer {
      display: none;
    }
    main,
    main.sidebar-closed {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
    }
    main.overlay aside {
      position: absolute;
      z-index: var(--mble-z-drawer);
      top: 0;
      right: 0;
      bottom: 0;
      width: min(22rem, 80vw);
      box-shadow: var(--mble-shadow);
    }
    main.overlay.sidebar-closed aside {
      display: none;
    }
    .scrim {
      position: absolute;
      z-index: calc(var(--mble-z-drawer) - 1);
      inset: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: var(--mble-scrim);
    }
    .panels-toggle {
      position: absolute;
      z-index: var(--mble-z-panel-sticky);
      left: 0.6rem;
      bottom: calc(0.6rem + env(safe-area-inset-bottom, 0px));
      min-height: 2.75rem;
      padding: 0 0.9rem;
      border-color: var(--mble-border-strong);
      background: var(--mble-surface);
      box-shadow: var(--mble-shadow);
    }
    main.overlay:not(.sidebar-closed) .panels-toggle {
      z-index: calc(var(--mble-z-drawer) + 1);
    }
  }
  /* Phone: the same panel rises from the bottom as a sheet. */
  @media (max-width: 40rem) {
    main.overlay aside {
      top: auto;
      left: 0;
      right: 0;
      width: auto;
      height: 70dvh;
      border-left: 0;
      border-top: 1px solid var(--mble-border);
      border-radius: var(--mble-radius-md) var(--mble-radius-md) 0 0;
    }
  }
</style>
