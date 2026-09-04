<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
import{alignElements,distributeElements,groupElements,removeElements,reorderElement,ungroup,addElement,type Alignment}from'../commands.js';import{copyElements,pasteElements}from'../clipboard.js';import type{EditorStore}from'../store.js';import{insertElement,insertLabels,insertTypes}from'../insert.js';import Icon from'./Icon.svelte';import Menu from'./Menu.svelte';import{shortcutLabel}from'../shortcuts.js';
export let editor:EditorStore;export let sidebarOpen=true;export let onOpen:(dialog:string)=>void=()=>{};export let onToggleSidebar:()=>void=()=>{};
const alignments:[Alignment,string][]=[['left','Left'],['center-x','Center'],['right','Right'],['top','Top'],['center-y','Middle'],['bottom','Bottom']];
const orders:['front'|'forward'|'backward'|'back',string][]=[['front','Bring to front'],['forward','Bring forward'],['backward','Send backward'],['back','Send to back']];
const align=(value:Alignment)=>editor.execute(alignElements($editor.selection,value));
function reorder(value:'front'|'forward'|'backward'|'back'){const id=[...$editor.selection][0];if(id)editor.execute(reorderElement(id,value))}
function group(){if($editor.selection.size<2)return;const command=groupElements($editor.selection);editor.execute(command);editor.select([command.createdId])}
function paste(){const items=pasteElements();for(const item of items)editor.execute(addElement(item));editor.select(items.map(item=>item.id))}
</script>
<Menu label="Edit">
  <button on:click={()=>editor.undo()} disabled={!$editor.canUndo} title={shortcutLabel('Mod+Z')}><Icon name="undo"/>Undo<kbd>{shortcutLabel('Mod+Z')}</kbd></button>
  <button on:click={()=>editor.redo()} disabled={!$editor.canRedo} title={shortcutLabel('Mod+Shift+Z')}><Icon name="redo"/>Redo<kbd>{shortcutLabel('Mod+Shift+Z')}</kbd></button>
  <hr>
  <button on:click={()=>editor.select($editor.document.elements.map(item=>item.id))}>Select all</button>
  <button on:click={()=>copyElements($editor.document.elements,$editor.selection)} disabled={!$editor.selection.size}>Copy</button>
  <button on:click={paste}>Paste</button>
  <hr>
  <button on:click={group} disabled={$editor.selection.size<2}><Icon name="group"/>Group</button>
  <button on:click={()=>{for(const id of $editor.selection)editor.execute(ungroup(id));editor.clearSelection()}} disabled={!$editor.selectedElements.some(item=>item.type==='group')}><Icon name="ungroup"/>Ungroup</button>
  <button on:click={()=>{editor.execute(removeElements($editor.selection));editor.clearSelection()}} disabled={!$editor.selection.size}><Icon name="delete"/>Delete</button>
</Menu>
<Menu label="Insert">
  {#each insertTypes as type}<button on:click={()=>insertElement(editor,type)}><Icon name={type}/>{insertLabels[type]}</button>{/each}
</Menu>
<Menu label="Label">
  <button on:click={()=>onOpen('media')}>Media &amp; zones…</button>
  <button on:click={()=>onOpen('data')}>Data…</button>
  <button on:click={()=>onOpen('assets')}>Assets…</button>
  <button on:click={()=>onOpen('library')}>Library…</button>
</Menu>
<Menu label="Arrange">
  <p class="group-label">Align</p>
  {#each alignments as [value,text]}<button on:click={()=>align(value)} disabled={$editor.selection.size<2}>{text}</button>{/each}
  <p class="group-label">Distribute</p>
  <button on:click={()=>editor.execute(distributeElements($editor.selection,'horizontal'))} disabled={$editor.selection.size<3}>Horizontally</button>
  <button on:click={()=>editor.execute(distributeElements($editor.selection,'vertical'))} disabled={$editor.selection.size<3}>Vertically</button>
  <p class="group-label">Order</p>
  {#each orders as [value,text]}<button on:click={()=>reorder(value)} disabled={$editor.selection.size!==1}>{text}</button>{/each}
</Menu>
<Menu label="View">
  <label class="check"><input type="checkbox" checked={$editor.view.showGrid} on:change={e=>editor.setView({showGrid:e.currentTarget.checked})}>Grid</label>
  <label class="check"><input type="checkbox" checked={$editor.view.showRulers} on:change={e=>editor.setView({showRulers:e.currentTarget.checked})}>Rulers</label>
  <label class="check"><input type="checkbox" checked={$editor.view.snapping} on:change={e=>editor.setView({snapping:e.currentTarget.checked})}>Snap</label>
  <label>Grid mm<input type="number" min=".1" step=".1" value={$editor.view.gridSize} on:change={e=>editor.setView({gridSize:Math.max(.1,+e.currentTarget.value)})}></label>
  <hr>
  <button on:click={()=>onOpen('guides')}>Guides…</button>
  <button on:click={onToggleSidebar}>{sidebarOpen?'Hide panels':'Show panels'}</button>
  <hr>
  <button on:click={()=>editor.setView({zoom:Math.min(4,$editor.view.zoom+.25)})}>Zoom in</button>
  <button on:click={()=>editor.setView({zoom:Math.max(.25,$editor.view.zoom-.25)})}>Zoom out</button>
  <button on:click={()=>editor.setView({zoom:1,pan:{x:0,y:0}})}>Reset view</button>
</Menu>
<Menu label="Help">
  <button on:click={()=>onOpen('shortcuts')}>Keyboard shortcuts…<kbd>?</kbd></button>
  <button on:click={()=>onOpen('syntax')}>Template syntax…</button>
</Menu>
