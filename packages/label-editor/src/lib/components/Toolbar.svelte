<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
import{groupElements,removeElements,ungroup}from'../commands.js';import type{EditorStore}from'../store.js';import{insertElement,insertLabels,insertTypes}from'../insert.js';import Icon from'./Icon.svelte';
export let editor:EditorStore;
function del(){editor.execute(removeElements($editor.selection));editor.clearSelection()}
function group(){editor.execute(groupElements($editor.selection))}
function ungroupSelected(){for(const id of $editor.selection)editor.execute(ungroup(id));editor.clearSelection()}
</script>
<nav aria-label="Drawing tools">
  <div class="group">{#each insertTypes as type}<button class="tool" on:click={()=>insertElement(editor,type)} title={`Insert ${insertLabels[type].toLowerCase()}`}><Icon name={type}/>{insertLabels[type]}</button>{/each}</div>
  <span class="spacer"></span>
  <div class="group">
    <button class="tool" on:click={()=>editor.undo()} disabled={!$editor.canUndo}><Icon name="undo"/>Undo</button>
    <button class="tool" on:click={()=>editor.redo()} disabled={!$editor.canRedo}><Icon name="redo"/>Redo</button>
  </div>
  <div class="group">
    <button class="tool" on:click={group} disabled={$editor.selection.size<2}><Icon name="group"/>Group</button>
    <button class="tool" on:click={ungroupSelected} disabled={!$editor.selectedElements.some(e=>e.type==='group')}><Icon name="ungroup"/>Ungroup</button>
    <button class="tool" on:click={del} disabled={!$editor.selection.size}><Icon name="delete"/>Delete</button>
  </div>
  <div class="group"><label class="zoom-field">Zoom<input class="zoom" type="range" min=".25" max="4" step=".25" value={$editor.view.zoom} on:input={(e)=>editor.setView({zoom:+e.currentTarget.value})}><output>{Math.round($editor.view.zoom*100)}%</output></label></div>
</nav>
<style>
  nav{display:flex;gap:.15rem;align-items:center;padding:.3rem .5rem;background:var(--mble-background,#f7f4ed);border-bottom:1px solid var(--mble-border,#d8d0c3)}
  .group{display:flex;gap:.1rem;align-items:center}
  .group+.group{margin-left:.35rem;padding-left:.45rem;border-left:1px solid var(--mble-border,#d8d0c3)}
  .spacer{flex:1;min-width:.5rem}
  .tool{display:flex;gap:.35rem;align-items:center;white-space:nowrap}
  .zoom-field{display:flex;gap:.35rem;align-items:center;font-size:.75rem;white-space:nowrap}
  .zoom{width:6rem}
  .zoom-field output{min-width:2.5rem;color:var(--mble-text-muted,#59635e);font-variant-numeric:tabular-nums}
  @media(max-width:900px){nav{flex-wrap:wrap;row-gap:.25rem}.group{flex-wrap:wrap;row-gap:.25rem}.spacer{display:none}.group+.group{margin-left:0}.zoom{width:4rem}}
  @media(max-width:600px){.tool{gap:0;font-size:0}.tool :global(.icon){width:17px;height:17px}.zoom-field{font-size:.75rem}}
</style>
