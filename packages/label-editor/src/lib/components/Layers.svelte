<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
import { SvelteSet } from 'svelte/reactivity'; import type { EditorStore } from '../store.svelte.js'; import { isEffectivelyLocked, isEffectivelyVisible, type LabelDocument, type LabelElement } from '../model.js'; import { createGroup, moveToGroup, reorderElement, setLocked, setVisibility } from '../commands.js';
let { editor }: { editor: EditorStore } = $props();
/** Groups the user folded; everything else stays expanded. */
const collapsed=new SvelteSet<string>();
let dragging=$state<string|undefined>(); let dropTarget=$state<string|undefined>();
/** Effective visibility and lock are resolved once per row instead of per rendered control. */
interface Row { element:LabelElement; depth:number; children:number; visible:boolean; locked:boolean }
const byZ=(a:LabelElement,b:LabelElement)=>b.zIndex-a.zIndex;
function rows(document:LabelDocument,folded:Set<string>):Row[]{
  const elements=document.elements;const byId=new Map(elements.map(item=>[item.id,item]));const out:Row[]=[];
  const visit=(item:LabelElement,depth:number)=>{const children=item.type==='group'?item.childIds.flatMap(id=>byId.get(id)??[]):[];out.push({element:item,depth,children:children.length,visible:isEffectivelyVisible(document,item),locked:isEffectivelyLocked(document,item)});if(!folded.has(item.id))for(const child of [...children].sort(byZ))visit(child,depth+1)};
  for(const item of elements.filter(item=>!item.groupId).sort(byZ))visit(item,0);
  return out;
}
const list=$derived(rows(editor.document,collapsed));
function toggle(id:string){if(collapsed.has(id))collapsed.delete(id);else collapsed.add(id)}
function addGroup(){const command=createGroup();editor.execute(command);editor.select([command.createdId])}
function movedIds(id:string){return editor.selection.has(id)?[...editor.selection]:[id]}
function dragStart(event:DragEvent,id:string){dragging=id;event.dataTransfer?.setData('text/plain',id);if(event.dataTransfer)event.dataTransfer.effectAllowed='move'}
function dragOver(event:DragEvent,id:string|undefined){if(!dragging)return;event.preventDefault();dropTarget=id??'root';if(event.dataTransfer)event.dataTransfer.dropEffect='move'}
function drop(event:DragEvent,target:LabelElement|undefined){event.preventDefault();const id=dragging??event.dataTransfer?.getData('text/plain');dragging=undefined;dropTarget=undefined;if(!id)return;const ids=movedIds(id).filter(item=>item!==target?.id);if(!ids.length)return;const groupId=target?.type==='group'?target.id:target?.groupId;try{editor.execute(moveToGroup(ids,groupId))}catch{/* dropping a group into its own subtree is refused */}}
function dragEnd(){dragging=undefined;dropTarget=undefined}
</script>
<section>
  <div class="heading"><h2>Layers</h2><button class="add" onclick={addGroup} title="Add an empty group; drag layers onto it to nest them">+ Group</button></div>
  <ol ondragover={(e)=>dragOver(e,undefined)} ondrop={(e)=>drop(e,undefined)} class:drop-root={dropTarget==='root'}>
    {#each list as row (row.element.id)}
      {@const element=row.element}
      <li class:selected={editor.selection.has(element.id)} class:group={element.type==='group'} class:drop={dropTarget===element.id} class:dragging={dragging===element.id} style={`--depth:${row.depth}`} draggable="true" ondragstart={(e)=>dragStart(e,element.id)} ondragend={dragEnd} ondragover={(event)=>{event.stopPropagation();((e)=>dragOver(e,element.id))(event)}} ondrop={(event)=>{event.stopPropagation();((e)=>drop(e,element))(event)}}>
        {#if element.type==='group'}<button class="fold" aria-label={collapsed.has(element.id)?`Expand ${element.name}`:`Collapse ${element.name}`} aria-expanded={!collapsed.has(element.id)} onclick={(event)=>{event.stopPropagation();toggle(element.id)}}>{collapsed.has(element.id)?'▸':'▾'}</button>{:else}<span class="fold" aria-hidden="true"></span>{/if}
        <button class="name" onclick={(e)=>editor.select([element.id],e.shiftKey)}>{element.name}{#if element.type==='group'}<span class="count">{row.children}</span>{/if}</button>
        <button aria-label={element.visible?'Hide':'Show'} class:inherited={element.visible&&!row.visible} title={element.visible&&!row.visible?'Hidden by its group':undefined} onclick={()=>editor.execute(setVisibility([element.id],!element.visible))}>{row.visible?'◉':'○'}</button>
        <button aria-label={element.locked?'Unlock':'Lock'} class:inherited={!element.locked&&row.locked} title={!element.locked&&row.locked?'Locked by its group':undefined} onclick={()=>editor.execute(setLocked([element.id],!element.locked))}>{row.locked?'🔒':'♢'}</button>
        <button aria-label="Raise" onclick={()=>editor.execute(reorderElement(element.id,'forward'))}>↑</button>
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
