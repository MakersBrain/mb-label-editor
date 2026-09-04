<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">import type { EditorStore } from '../store.svelte.js';import type{PrinterDefinition,PrinterSdk}from'../print/types.js';import type{DocumentMaterializer}from'../materialization.js';import type{AssetCatalogClient}from'../asset-catalog/client.js';import type{ExternalResourceProvider}from'../external-resources/types.js'; import {addElement,groupElements,moveElements,removeElements,ungroup} from '../commands.js';import {copyElements,pasteElements} from '../clipboard.js'; import Canvas from './Canvas.svelte';import ShortcutsPanel from './ShortcutsPanel.svelte';import TemplateSyntaxPanel from './TemplateSyntaxPanel.svelte';import Inspector from './Inspector.svelte';import Layers from './Layers.svelte';import DataPanel from './DataPanel.svelte';import AssetPanel from './AssetPanel.svelte';import MediaPanel from './MediaPanel.svelte';import LibraryPanel from './LibraryPanel.svelte';import GuidesPanel from './GuidesPanel.svelte';import Toolbar from './Toolbar.svelte';import EditorMenus from './EditorMenus.svelte';import Modal from './Modal.svelte'; export let editor:EditorStore;export let sdk:PrinterSdk|undefined=undefined;export let materializer:Pick<DocumentMaterializer,'materializeRecord'>|undefined=undefined;export let resourceProvider:ExternalResourceProvider|undefined=undefined;/** @deprecated Pass resourceProvider instead. */export let assetCatalog:AssetCatalogClient|undefined=undefined;export let printers:PrinterDefinition[]=[];export let printerId='';export let onPrinter:(id:string)=>void=()=>{};let sidebarOpen=true;let dialog='';$: activeResourceProvider=resourceProvider??assetCatalog;
const dialogTitles:Record<string,string>={media:'Media & zones',data:'Data',assets:'Assets',library:'Library',guides:'Guides',shortcuts:'Keyboard shortcuts',syntax:'Template syntax'};
type SidebarTab='layers'|'assets'|'data'|'printer';const sidebarTabs:SidebarTab[]=['layers','assets','data','printer'];const sidebarTabKey='mb-label-editor:sidebar-tab';
/** The chosen tab survives reloads; storage may be unavailable in private windows. */
let sidebarTab:SidebarTab=(()=>{try{const saved=globalThis.localStorage?.getItem(sidebarTabKey);return sidebarTabs.includes(saved as SidebarTab)?saved as SidebarTab:'layers'}catch{return 'layers'}})();
function selectSidebarTab(tab:SidebarTab){sidebarTab=tab;try{globalThis.localStorage?.setItem(sidebarTabKey,tab)}catch{/* storage unavailable */}}
function tabKeys(event:KeyboardEvent){if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();const index=sidebarTabs.indexOf(sidebarTab);const next=sidebarTabs[(index+(event.key==='ArrowRight'?1:sidebarTabs.length-1))%sidebarTabs.length];selectSidebarTab(next);(document.getElementById(`sidebar-tab-${next}`) as HTMLElement|null)?.focus()}
/** Assets live in the sidebar; the Label menu entry reveals that tab instead of a dialog. */
function openPanel(name:string){if(name==='assets'||name==='data'){selectSidebarTab(name);sidebarOpen=true}else dialog=name}
const sidebarWidthKey='mb-label-editor:sidebar-width';const defaultSidebarWidth=304;const minSidebarWidth=240;
/** Width in pixels; wider panels let the asset grid grow more columns and keep font rows from wrapping. */
let sidebarWidth:number=(()=>{try{const saved=Number(globalThis.localStorage?.getItem(sidebarWidthKey));return Number.isFinite(saved)&&saved>=minSidebarWidth?saved:defaultSidebarWidth}catch{return defaultSidebarWidth}})();
const maxSidebarWidth=()=>Math.max(minSidebarWidth,Math.round((globalThis.innerWidth||1200)*0.6));
function setSidebarWidth(width:number){sidebarWidth=Math.round(Math.min(maxSidebarWidth(),Math.max(minSidebarWidth,width)));try{globalThis.localStorage?.setItem(sidebarWidthKey,String(sidebarWidth))}catch{/* storage unavailable */}}
let resizing:{pointerId:number;startX:number;startWidth:number}|undefined;
function startSidebarResize(event:PointerEvent){if(event.button!==0)return;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);resizing={pointerId:event.pointerId,startX:event.clientX,startWidth:sidebarWidth};event.preventDefault()}
function moveSidebarResize(event:PointerEvent){if(!resizing||event.pointerId!==resizing.pointerId)return;setSidebarWidth(resizing.startWidth+(resizing.startX-event.clientX))}
function endSidebarResize(event:PointerEvent){if(resizing&&event.pointerId===resizing.pointerId)resizing=undefined}
function sidebarResizeKeys(event:KeyboardEvent){const step=event.shiftKey?64:16;if(event.key==='ArrowLeft'){event.preventDefault();setSidebarWidth(sidebarWidth+step)}else if(event.key==='ArrowRight'){event.preventDefault();setSidebarWidth(sidebarWidth-step)}else if(event.key==='Home'){event.preventDefault();setSidebarWidth(maxSidebarWidth())}else if(event.key==='End'){event.preventDefault();setSidebarWidth(minSidebarWidth)}}
function groupSelected(){if($editor.selection.size<2)return;const command=groupElements($editor.selection);editor.execute(command);editor.select([command.createdId])}
function keys(event:KeyboardEvent){const target=event.target as HTMLElement;if(['INPUT','TEXTAREA','SELECT'].includes(target.tagName))return;const modifier=event.ctrlKey||event.metaKey;
  if(modifier&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?editor.redo():editor.undo()}else if(modifier&&event.key.toLowerCase()==='y'){event.preventDefault();editor.redo()}
  else if(modifier&&event.key.toLowerCase()==='a'){event.preventDefault();editor.select($editor.document.elements.map(e=>e.id))}else if(modifier&&event.key.toLowerCase()==='c'){event.preventDefault();copyElements($editor.document.elements,$editor.selection)}
  else if(modifier&&event.key.toLowerCase()==='v'){event.preventDefault();const items=pasteElements();for(const item of items)editor.execute(addElement(item));editor.select(items.map(i=>i.id))}
  else if(modifier&&event.key.toLowerCase()==='g'){event.preventDefault();if(event.shiftKey){for(const item of $editor.selectedElements)if(item.type==='group')editor.execute(ungroup(item.id))}else groupSelected()}
  else if(event.key==='?'&&!modifier){event.preventDefault();dialog=dialog==='shortcuts'?'':'shortcuts'}
  else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();editor.execute(removeElements($editor.selection));editor.clearSelection()}
  else if($editor.selection.size&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const step=event.shiftKey?1:.1;editor.execute(moveElements($editor.selection,{x:event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,y:event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0}))}}
</script>
<svelte:window on:keydown={keys}/>
<div class="editor mb-label-editor">
  <header class="appbar">
    <div class="brand"><slot name="brand"/></div>
    <nav class="menubar" aria-label="Editor menus">
      <slot name="menu-start"/>
      <EditorMenus {editor} {sidebarOpen} onOpen={openPanel} onToggleSidebar={()=>sidebarOpen=!sidebarOpen}/>
      <slot name="menu-end"/>
    </nav>
    <div class="appbar-actions"><slot name="actions"/></div>
  </header>
  <Toolbar {editor}/>
  <main class:sidebar-closed={!sidebarOpen} style={`--sidebar-width:${sidebarWidth}px`}>
    <div class="canvas"><Canvas {editor} {sdk} {materializer} printer={printers.find(item=>item.id===printerId)}/></div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
    {#if sidebarOpen}<div class="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize side panel" aria-valuemin={minSidebarWidth} aria-valuemax={maxSidebarWidth()} aria-valuenow={sidebarWidth} tabindex="0" title="Drag to resize the side panel" on:pointerdown={startSidebarResize} on:pointermove={moveSidebarResize} on:pointerup={endSidebarResize} on:pointercancel={endSidebarResize} on:keydown={sidebarResizeKeys} on:dblclick={()=>setSidebarWidth(defaultSidebarWidth)}></div>{/if}
    <aside class:open={sidebarOpen}>
      <div class="tabs" role="tablist" aria-label="Side panels">
        <button type="button" role="tab" id="sidebar-tab-layers" aria-selected={sidebarTab==='layers'} aria-controls="sidebar-panel-layers" tabindex={sidebarTab==='layers'?0:-1} on:click={()=>selectSidebarTab('layers')} on:keydown={tabKeys}>Layers</button>
        <button type="button" role="tab" id="sidebar-tab-assets" aria-selected={sidebarTab==='assets'} aria-controls="sidebar-panel-assets" tabindex={sidebarTab==='assets'?0:-1} on:click={()=>selectSidebarTab('assets')} on:keydown={tabKeys}>Assets</button>
        <button type="button" role="tab" id="sidebar-tab-data" aria-selected={sidebarTab==='data'} aria-controls="sidebar-panel-data" tabindex={sidebarTab==='data'?0:-1} on:click={()=>selectSidebarTab('data')} on:keydown={tabKeys}>Data</button>
        <button type="button" role="tab" id="sidebar-tab-printer" aria-selected={sidebarTab==='printer'} aria-controls="sidebar-panel-printer" tabindex={sidebarTab==='printer'?0:-1} on:click={()=>selectSidebarTab('printer')} on:keydown={tabKeys}>Printer</button>
      </div>
      <div id="sidebar-panel-layers" role="tabpanel" aria-labelledby="sidebar-tab-layers" hidden={sidebarTab!=='layers'}>
        <details open><summary>Layers</summary><Layers {editor}/></details>
        <details open><summary>Properties</summary><Inspector {editor}/></details>
      </div>
      <div id="sidebar-panel-assets" role="tabpanel" aria-labelledby="sidebar-tab-assets" hidden={sidebarTab!=='assets'}>
        <AssetPanel {editor} {sdk} resourceProvider={activeResourceProvider} active={sidebarTab==='assets'}/>
      </div>
      <div id="sidebar-panel-data" role="tabpanel" aria-labelledby="sidebar-tab-data" hidden={sidebarTab!=='data'}>
        <DataPanel {editor} onSyntaxHelp={()=>dialog='syntax'}/>
      </div>
      <div id="sidebar-panel-printer" role="tabpanel" aria-labelledby="sidebar-tab-printer" hidden={sidebarTab!=='printer'}>
        <slot name="sidebar"/>
      </div>
    </aside>
  </main>
  <Modal open={dialog==='media'} title={dialogTitles.media} onClose={()=>dialog=''}><MediaPanel {editor} {sdk} {materializer} {printers} {printerId} {onPrinter}/></Modal>
  <Modal open={dialog==='library'} title={dialogTitles.library} onClose={()=>dialog=''}><LibraryPanel {editor}/></Modal>
  <Modal open={dialog==='guides'} title={dialogTitles.guides} onClose={()=>dialog=''}><GuidesPanel {editor}/></Modal>
  <Modal open={dialog==='shortcuts'} title={dialogTitles.shortcuts} onClose={()=>dialog=''}><ShortcutsPanel/></Modal>
  <Modal open={dialog==='syntax'} title={dialogTitles.syntax} onClose={()=>dialog=''}><TemplateSyntaxPanel {editor}/></Modal>
</div>
<style>
  .editor{height:100%;min-width:0;overflow:hidden;display:flex;flex-direction:column;color:var(--mble-text,#17231c);background:var(--mble-background,#f7f4ed);font-family:var(--mble-font-ui,Inter,system-ui,sans-serif)}
  .appbar{display:flex;gap:.6rem;align-items:center;min-width:0;flex:none;padding:.3rem .5rem;border-bottom:1px solid var(--mble-border,#d8d0c3)}
  .brand{min-width:0;display:flex;align-items:center}
  .menubar{display:flex;gap:.1rem;align-items:center;flex-wrap:wrap;min-width:0}
  .appbar-actions{display:flex;gap:.25rem;align-items:center;margin-left:auto}
  main{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,var(--sidebar-width,19rem));min-width:0;min-height:0;flex:1}
  .sidebar-resizer{position:relative;z-index:7;width:6px;margin:0 -3px;cursor:col-resize;touch-action:none;background:transparent}
  .sidebar-resizer::after{content:'';position:absolute;top:0;bottom:0;left:2px;width:2px;background:transparent;transition:background .12s}
  .sidebar-resizer:hover::after,.sidebar-resizer:focus-visible::after{background:var(--mble-primary,#ed6146)}
  .sidebar-resizer:focus-visible{outline:none}
  .canvas{position:relative;min-width:0;min-height:0;overflow:hidden}
  main.sidebar-closed{grid-template-columns:minmax(0,1fr)}main.sidebar-closed aside{display:none}
  aside{width:100%;box-sizing:border-box}
  aside{min-width:0;overflow:auto;overscroll-behavior:contain;background:var(--mble-background,#f7f4ed);border-left:1px solid var(--mble-border,#d8d0c3)}
  .tabs{position:sticky;top:0;z-index:6;display:flex;background:var(--mble-background,#f7f4ed);border-bottom:1px solid var(--mble-border,#d8d0c3)}
  .tabs [role=tab]{flex:1;padding:.5rem .75rem;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--mble-text-muted,#59635e);font-size:.75rem;font-weight:600;cursor:pointer}
  .tabs [role=tab][aria-selected=true]{color:var(--mble-text,#17231c);border-bottom-color:var(--mble-primary,#ed6146)}
  aside [role=tabpanel][hidden]{display:none}
  aside details{border-bottom:1px solid var(--mble-border,#e5dfd5)}
  aside summary{position:sticky;top:0;z-index:5;display:flex;gap:.4rem;align-items:center;padding:.5rem .75rem;background:var(--mble-background,#f7f4ed);color:var(--mble-text-muted,#59635e);cursor:pointer;font-size:.75rem;font-weight:600;list-style:none}
  aside summary::-webkit-details-marker{display:none}
  aside summary::before{content:'\203A';display:inline-block;width:.6rem;color:var(--mble-text-muted,#59635e);transition:transform .12s ease}
  aside details[open]>summary{color:var(--mble-text,#17231c)}
  aside details[open]>summary::before{transform:rotate(90deg)}
  aside :global(details>section){border-top:0}
  aside :global(details>section>h2){display:none}
  @media(max-width:800px){.appbar{flex-wrap:wrap;gap:.35rem}.brand{flex:none;order:0}.appbar-actions{order:1;margin-left:auto}.menubar{order:2;flex-basis:100%}}
  @media(max-width:760px){.sidebar-resizer{display:none}main,main.sidebar-closed{grid-template-columns:1fr;grid-template-rows:minmax(16rem,1fr) minmax(0,42vh)}main.sidebar-closed{grid-template-rows:minmax(0,1fr)}aside{display:block;max-height:none;border-left:0;border-top:1px solid var(--mble-border,#d8d0c3)}}
</style>
