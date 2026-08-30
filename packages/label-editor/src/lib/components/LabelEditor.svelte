<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">import type { EditorStore } from '../store.js';import type{PrinterDefinition,PrinterSdk}from'../print/types.js';import {addElement,groupElements,moveElements,removeElements,ungroup} from '../commands.js';import {copyElements,pasteElements} from '../clipboard.js'; import Canvas from './Canvas.svelte';import Inspector from './Inspector.svelte';import Layers from './Layers.svelte';import DataPanel from './DataPanel.svelte';import AssetPanel from './AssetPanel.svelte';import MediaPanel from './MediaPanel.svelte';import LibraryPanel from './LibraryPanel.svelte';import GuidesPanel from './GuidesPanel.svelte';import Toolbar from './Toolbar.svelte';import EditorMenus from './EditorMenus.svelte';import Modal from './Modal.svelte'; export let editor:EditorStore;export let sdk:PrinterSdk|undefined=undefined;export let printers:PrinterDefinition[]=[];export let printerId='';export let onPrinter:(id:string)=>void=()=>{};let sidebarOpen=true;let dialog='';
const dialogTitles:Record<string,string>={media:'Media & zones',data:'Data',assets:'Assets',library:'Library',guides:'Guides'};
function keys(event:KeyboardEvent){const target=event.target as HTMLElement;if(['INPUT','TEXTAREA','SELECT'].includes(target.tagName))return;const modifier=event.ctrlKey||event.metaKey;
  if(modifier&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?editor.redo():editor.undo()}else if(modifier&&event.key.toLowerCase()==='y'){event.preventDefault();editor.redo()}
  else if(modifier&&event.key.toLowerCase()==='a'){event.preventDefault();editor.select($editor.document.elements.map(e=>e.id))}else if(modifier&&event.key.toLowerCase()==='c'){event.preventDefault();copyElements($editor.document.elements,$editor.selection)}
  else if(modifier&&event.key.toLowerCase()==='v'){event.preventDefault();const items=pasteElements();for(const item of items)editor.execute(addElement(item));editor.select(items.map(i=>i.id))}
  else if(modifier&&event.key.toLowerCase()==='g'){event.preventDefault();if(event.shiftKey){for(const item of $editor.selectedElements)if(item.type==='group')editor.execute(ungroup(item.id))}else editor.execute(groupElements($editor.selection))}
  else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();editor.execute(removeElements($editor.selection));editor.clearSelection()}
  else if($editor.selection.size&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const step=event.shiftKey?1:.1;editor.execute(moveElements($editor.selection,{x:event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,y:event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0}))}}
</script>
<svelte:window on:keydown={keys}/>
<div class="editor mb-label-editor">
  <header class="appbar">
    <div class="brand"><slot name="brand"/></div>
    <nav class="menubar" aria-label="Editor menus">
      <slot name="menu-start"/>
      <EditorMenus {editor} {sidebarOpen} onOpen={(name)=>dialog=name} onToggleSidebar={()=>sidebarOpen=!sidebarOpen}/>
      <slot name="menu-end"/>
    </nav>
    <div class="appbar-actions"><slot name="actions"/></div>
  </header>
  <Toolbar {editor}/>
  <main class:sidebar-closed={!sidebarOpen}>
    <div class="canvas"><Canvas {editor} {sdk}/></div>
    <aside class:open={sidebarOpen}>
      <details open><summary>Layers</summary><Layers {editor}/></details>
      <details open><summary>Properties</summary><Inspector {editor}/></details>
      <slot name="sidebar"/>
    </aside>
  </main>
  <Modal open={dialog==='media'} title={dialogTitles.media} onClose={()=>dialog=''}><MediaPanel {editor} {sdk} {printers} {printerId} {onPrinter}/></Modal>
  <Modal open={dialog==='data'} title={dialogTitles.data} onClose={()=>dialog=''}><DataPanel {editor}/></Modal>
  <Modal open={dialog==='assets'} title={dialogTitles.assets} onClose={()=>dialog=''}><AssetPanel {editor} {sdk}/></Modal>
  <Modal open={dialog==='library'} title={dialogTitles.library} onClose={()=>dialog=''}><LibraryPanel {editor}/></Modal>
  <Modal open={dialog==='guides'} title={dialogTitles.guides} onClose={()=>dialog=''}><GuidesPanel {editor}/></Modal>
</div>
<style>
  .editor{height:100%;min-width:0;overflow:hidden;display:flex;flex-direction:column;color:var(--mble-text,#17231c);background:var(--mble-background,#f7f4ed);font-family:var(--mble-font-ui,Inter,system-ui,sans-serif)}
  .appbar{display:flex;gap:.6rem;align-items:center;min-width:0;flex:none;padding:.3rem .5rem;border-bottom:1px solid var(--mble-border,#d8d0c3)}
  .brand{min-width:0;display:flex;align-items:center}
  .menubar{display:flex;gap:.1rem;align-items:center;flex-wrap:wrap;min-width:0}
  .appbar-actions{display:flex;gap:.25rem;align-items:center;margin-left:auto}
  main{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 19rem;min-width:0;min-height:0;flex:1}
  .canvas{position:relative;min-width:0;min-height:0;overflow:hidden}
  main.sidebar-closed{grid-template-columns:minmax(0,1fr)}main.sidebar-closed aside{display:none}
  aside{min-width:0;overflow:auto;overscroll-behavior:contain;background:var(--mble-background,#f7f4ed);border-left:1px solid var(--mble-border,#d8d0c3)}
  aside details{border-bottom:1px solid var(--mble-border,#e5dfd5)}
  aside summary{position:sticky;top:0;z-index:5;display:flex;gap:.4rem;align-items:center;padding:.5rem .75rem;background:var(--mble-background,#f7f4ed);color:var(--mble-text-muted,#59635e);cursor:pointer;font-size:.75rem;font-weight:600;list-style:none}
  aside summary::-webkit-details-marker{display:none}
  aside summary::before{content:'\203A';display:inline-block;width:.6rem;color:var(--mble-text-muted,#59635e);transition:transform .12s ease}
  aside details[open]>summary{color:var(--mble-text,#17231c)}
  aside details[open]>summary::before{transform:rotate(90deg)}
  aside :global(details>section){border-top:0}
  aside :global(details>section>h2){display:none}
  @media(max-width:800px){.appbar{flex-wrap:wrap;gap:.35rem}.brand{flex:none;order:0}.appbar-actions{order:1;margin-left:auto}.menubar{order:2;flex-basis:100%}}
  @media(max-width:760px){main,main.sidebar-closed{grid-template-columns:1fr;grid-template-rows:minmax(16rem,1fr) minmax(0,42vh)}main.sidebar-closed{grid-template-rows:minmax(0,1fr)}aside{display:block;max-height:none;border-left:0;border-top:1px solid var(--mble-border,#d8d0c3)}}
</style>
