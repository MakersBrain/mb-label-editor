<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
import{addElement,alignElements,distributeElements,groupElements,removeElements,reorderElement,ungroup,type Alignment}from'../commands.js';import type{EditorStore}from'../store.js';import{uuid,type LabelElement}from'../model.js';export let editor:EditorStore;let axis:'x'|'y'='x';let guideValue=10;
function create(type:'text'|'rectangle'|'ellipse'|'triangle'|'line'|'barcode'|'qr'){const base={id:uuid(),name:type[0].toUpperCase()+type.slice(1),transform:{x:5,y:5,width:type==='text'?25:12,height:type==='text'?7:12,rotation:0},zIndex:$editor.document.elements.length,visible:true,locked:false};let element:LabelElement;if(type==='text')element={...base,type,text:'Text',fontFamily:'sans-serif',fontSize:14,fontWeight:400,horizontalAlign:'left',verticalAlign:'top',overflow:'word-wrap'};else if(type==='barcode')element={...base,type,value:'123456789',symbology:'code128',showText:true};else if(type==='qr')element={...base,type,value:'https://makersbrain.com',errorCorrection:'M'};else element={...base,type,strokeWidth:.3,filled:false};editor.execute(addElement(element));editor.select([element.id])}
const align=(value:Alignment)=>editor.execute(alignElements($editor.selection,value));const reorder=(value:'front'|'back'|'forward'|'backward')=>{const id=[...$editor.selection][0];if(id)editor.execute(reorderElement(id,value))};function addGuide(){if(Number.isFinite(guideValue))editor.setView({manualGuides:[...$editor.view.manualGuides,{axis,value:guideValue}]})}function editGuide(index:number,value:number){const guides=$editor.view.manualGuides.map((guide,i)=>i===index?{...guide,value}:guide);editor.setView({manualGuides:guides})}function removeGuide(index:number){editor.setView({manualGuides:$editor.view.manualGuides.filter((_,i)=>i!==index)})}function del(){editor.execute(removeElements($editor.selection));editor.clearSelection()}function group(){editor.execute(groupElements($editor.selection))}function ungroupSelected(){for(const id of $editor.selection)editor.execute(ungroup(id));editor.clearSelection()}
function dismiss(event:FocusEvent){const menu=event.currentTarget as HTMLDetailsElement;const next=event.relatedTarget as Node|null;if(!next||!menu.contains(next))menu.open=false}
</script>
<nav aria-label="Editor tools">
  <div class="group">{#each ['text','rectangle','ellipse','triangle','line','barcode','qr'] as type}<button on:click={()=>create(type as Parameters<typeof create>[0])}>{type==='qr'?'QR':type[0].toUpperCase()+type.slice(1)}</button>{/each}</div>
  <div class="group">
    <details class="menu" on:focusout={dismiss}><summary>Arrange</summary><div class="sheet">
      <p class="hint">Align</p><div class="row">{#each ['left','center-x','right','top','center-y','bottom'] as item}<button on:click={()=>align(item as Alignment)} disabled={$editor.selection.size<2}>{item}</button>{/each}</div>
      <p class="hint">Distribute</p><div class="row"><button on:click={()=>editor.execute(distributeElements($editor.selection,'horizontal'))} disabled={$editor.selection.size<3}>Distribute X</button><button on:click={()=>editor.execute(distributeElements($editor.selection,'vertical'))} disabled={$editor.selection.size<3}>Distribute Y</button></div>
      <p class="hint">Order</p><div class="row">{#each ['front','forward','backward','back'] as item}<button on:click={()=>reorder(item as Parameters<typeof reorder>[0])} disabled={$editor.selection.size!==1}>{item}</button>{/each}</div>
    </div></details>
    <details class="menu" on:focusout={dismiss}><summary>Guides</summary><div class="sheet">
      <div class="row"><label>Guide<select bind:value={axis}><option value="x">X</option><option value="y">Y</option></select></label><input aria-label="Guide position" type="number" step=".1" bind:value={guideValue}><button on:click={addGuide}>Add guide</button></div>
      {#each $editor.view.manualGuides as guide,index}<div class="row"><label>{guide.axis.toUpperCase()} guide<input aria-label={`${guide.axis.toUpperCase()} guide ${index+1}`} type="number" step=".1" value={guide.value} on:change={e=>editGuide(index,+e.currentTarget.value)}></label><button aria-label={`Remove guide ${index+1}`} on:click={()=>removeGuide(index)}>×</button></div>{/each}
    </div></details>
    <details class="menu" on:focusout={dismiss}><summary>View</summary><div class="sheet">
      <label class="check"><input type="checkbox" checked={$editor.view.showGrid} on:change={e=>editor.setView({showGrid:e.currentTarget.checked})}>Grid</label>
      <label class="check"><input type="checkbox" checked={$editor.view.showRulers} on:change={e=>editor.setView({showRulers:e.currentTarget.checked})}>Rulers</label>
      <label class="check"><input type="checkbox" checked={$editor.view.snapping} on:change={e=>editor.setView({snapping:e.currentTarget.checked})}>Snap</label>
      <label>Grid mm<input type="number" min=".1" step=".1" value={$editor.view.gridSize} on:change={e=>editor.setView({gridSize:Math.max(.1,+e.currentTarget.value)})}></label>
    </div></details>
  </div>
  <span class="spacer"></span>
  <div class="group"><button on:click={()=>editor.undo()} disabled={!$editor.canUndo}>Undo</button><button on:click={()=>editor.redo()} disabled={!$editor.canRedo}>Redo</button></div>
  <div class="group"><button on:click={group} disabled={$editor.selection.size<2}>Group</button><button on:click={ungroupSelected} disabled={!$editor.selectedElements.some(e=>e.type==='group')}>Ungroup</button><button on:click={del} disabled={!$editor.selection.size}>Delete</button></div>
  <div class="group"><label class="zoom-field">Zoom<input class="zoom" type="range" min=".25" max="4" step=".25" value={$editor.view.zoom} on:input={(e)=>editor.setView({zoom:+e.currentTarget.value})}><output>{Math.round($editor.view.zoom*100)}%</output></label></div>
</nav>
<style>
  nav{display:flex;gap:.15rem;align-items:center;overflow:visible;padding:.3rem .5rem;background:var(--mble-background,#f7f4ed);border-bottom:1px solid var(--mble-border,#d8d0c3)}
  .group{display:flex;gap:.1rem;align-items:center}
  .group+.group{margin-left:.35rem;padding-left:.45rem;border-left:1px solid var(--mble-border,#d8d0c3)}
  .spacer{flex:1;min-width:.5rem}
  button,label{white-space:nowrap}
  .menu{position:relative}
  .menu>summary{padding:.25rem .5rem;border-radius:var(--mble-radius-sm,4px);list-style:none;color:var(--mble-text-muted,#59635e)}
  .menu>summary::-webkit-details-marker{display:none}
  .menu>summary::after{content:'⌄';margin-left:.3rem;font-size:.7em;vertical-align:.15em}
  .menu>summary:hover,.menu[open]>summary{background:var(--mble-surface-sunken,#f0e9e3);color:var(--mble-text,#17231c)}
  .sheet{position:absolute;z-index:40;left:0;top:calc(100% + .3rem);display:grid;gap:.35rem;min-width:14rem;max-width:calc(100vw - 1rem);padding:.6rem;background:var(--mble-surface,#fff);border:1px solid var(--mble-border,#d8d0c3);border-radius:var(--mble-radius-md,6px);box-shadow:var(--mble-shadow,0 8px 24px #17231c22)}
  .sheet .row{display:flex;flex-wrap:wrap;gap:.25rem;align-items:center}
  .sheet .hint{margin:.15rem 0 0;color:var(--mble-text-muted,#59635e);font-size:.7rem}
  .sheet label{display:flex;gap:.3rem;align-items:center;font-size:.75rem}
  .sheet input[type=number]{width:4.5rem}
  .sheet .check{gap:.35rem}
  .zoom-field{display:flex;gap:.35rem;align-items:center;font-size:.75rem}
  .zoom{width:6rem}
  .zoom-field output{min-width:2.5rem;color:var(--mble-text-muted,#59635e);font-variant-numeric:tabular-nums}
  @media(max-width:900px){nav{flex-wrap:wrap;row-gap:.25rem}.group{flex-wrap:wrap;row-gap:.25rem}.spacer{display:none}.group+.group{margin-left:0}.zoom{width:4rem}}
</style>
