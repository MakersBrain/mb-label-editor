<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
import type { EditorStore } from '../store.svelte.js'; import { isEffectivelyLocked, isEffectivelyVisible, type LabelElement } from '../model.js'; import { createGroup, moveToGroup, reorderElement, setLocked, setVisibility } from '../commands.js';
export let editor:EditorStore;
/** Groups the user folded; everything else stays expanded. */
let collapsed=new Set<string>();
let dragging:string|undefined; let dropTarget:string|undefined;
interface Row { element:LabelElement; depth:number; children:number }
const byZ=(a:LabelElement,b:LabelElement)=>b.zIndex-a.zIndex;
function rows(elements:LabelElement[],folded:Set<string>):Row[]{
  const byId=new Map(elements.map(item=>[item.id,item]));const out:Row[]=[];
  const visit=(item:LabelElement,depth:number)=>{const children=item.type==='group'?item.childIds.flatMap(id=>byId.get(id)??[]):[];out.push({element:item,depth,children:children.length});if(!folded.has(item.id))for(const child of [...children].sort(byZ))visit(child,depth+1)};
  for(const item of elements.filter(item=>!item.groupId).sort(byZ))visit(item,0);
  return out;
}
$: list=rows($editor.document.elements,collapsed);
function toggle(id:string){const next=new Set(collapsed);if(next.has(id))next.delete(id);else next.add(id);collapsed=next}
function addGroup(){const command=createGroup();editor.execute(command);editor.select([command.createdId])}
function movedIds(id:string){return $editor.selection.has(id)?[...$editor.selection]:[id]}
function dragStart(event:DragEvent,id:string){dragging=id;event.dataTransfer?.setData('text/plain',id);if(event.dataTransfer)event.dataTransfer.effectAllowed='move'}
function dragOver(event:DragEvent,id:string|undefined){if(!dragging)return;event.preventDefault();dropTarget=id??'root';if(event.dataTransfer)event.dataTransfer.dropEffect='move'}
function drop(event:DragEvent,target:LabelElement|undefined){event.preventDefault();const id=dragging??event.dataTransfer?.getData('text/plain');dragging=undefined;dropTarget=undefined;if(!id)return;const ids=movedIds(id).filter(item=>item!==target?.id);if(!ids.length)return;const groupId=target?.type==='group'?target.id:target?.groupId;try{editor.execute(moveToGroup(ids,groupId))}catch{/* dropping a group into its own subtree is refused */}}
function dragEnd(){dragging=undefined;dropTarget=undefined}
</script>
<section>
  <div class="heading"><h2>Layers</h2><button class="add" on:click={addGroup} title="Add an empty group; drag layers onto it to nest them">+ Group</button></div>
  <ol on:dragover={(e)=>dragOver(e,undefined)} on:drop={(e)=>drop(e,undefined)} class:drop-root={dropTarget==='root'}>
    {#each list as row (row.element.id)}
      {@const element=row.element}
      <li class:selected={$editor.selection.has(element.id)} class:group={element.type==='group'} class:drop={dropTarget===element.id} class:dragging={dragging===element.id} style={`--depth:${row.depth}`} draggable="true" on:dragstart={(e)=>dragStart(e,element.id)} on:dragend={dragEnd} on:dragover|stopPropagation={(e)=>dragOver(e,element.id)} on:drop|stopPropagation={(e)=>drop(e,element)}>
        {#if element.type==='group'}<button class="fold" aria-label={collapsed.has(element.id)?`Expand ${element.name}`:`Collapse ${element.name}`} aria-expanded={!collapsed.has(element.id)} on:click|stopPropagation={()=>toggle(element.id)}>{collapsed.has(element.id)?'▸':'▾'}</button>{:else}<span class="fold" aria-hidden="true"></span>{/if}
        <button class="name" on:click={(e)=>editor.select([element.id],e.shiftKey)}>{element.name}{#if element.type==='group'}<span class="count">{row.children}</span>{/if}</button>
        <button aria-label={element.visible?'Hide':'Show'} class:inherited={element.visible&&!isEffectivelyVisible($editor.document,element)} title={element.visible&&!isEffectivelyVisible($editor.document,element)?'Hidden by its group':undefined} on:click={()=>editor.execute(setVisibility([element.id],!element.visible))}>{isEffectivelyVisible($editor.document,element)?'◉':'○'}</button>
        <button aria-label={element.locked?'Unlock':'Lock'} class:inherited={!element.locked&&isEffectivelyLocked($editor.document,element)} title={!element.locked&&isEffectivelyLocked($editor.document,element)?'Locked by its group':undefined} on:click={()=>editor.execute(setLocked([element.id],!element.locked))}>{isEffectivelyLocked($editor.document,element)?'🔒':'♢'}</button>
        <button aria-label="Raise" on:click={()=>editor.execute(reorderElement(element.id,'forward'))}>↑</button>
      </li>
    {/each}
  </ol>
  <p class="hint">Drag a layer onto a group to nest it, or onto a top-level layer to take it out.</p>
</section>
<style>
  section{padding:.7rem .75rem}
  .heading{display:flex;align-items:center;justify-content:space-between;margin:0 0 .5rem}
  h2{margin:0;color:var(--mble-text-muted,#59635e);font-size:.75rem;font-weight:600}
  .add{font-size:.7rem}
  ol{list-style:none;padding:0;margin:0;min-height:1.5rem;border-radius:var(--mble-radius-sm,4px)}
  ol.drop-root{outline:1px dashed var(--mble-accent,#d9724b)}
  li{display:flex;align-items:center;padding-left:calc(var(--depth) * .9rem);border-radius:var(--mble-radius-sm,4px)}
  li.dragging{opacity:.5}
  li.drop{outline:1px dashed var(--mble-accent,#d9724b);outline-offset:-1px}
  .selected{background:var(--mble-selection,#f5c8b9)}
  .fold{width:1.1rem;flex:none;padding:0;text-align:center;color:var(--mble-text-muted,#59635e)}
  .name{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .count{margin-left:.35rem;color:var(--mble-text-muted,#59635e);font-size:.7rem}
  .inherited{opacity:.55}
  .hint{margin:.4rem 0 0;color:var(--mble-text-muted,#59635e);font-size:.68rem}
</style>
