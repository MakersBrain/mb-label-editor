<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { alignElementsToBounds, groupElements, removeElements, ungroup, type Alignment } from '../commands.js';
  import type { Bounds } from '../model.js';
  import type { EditorStore } from '../store.svelte.js';
  import { insertElement, insertLabels, insertTypes } from '../insert.js';
  import { shortcutLabel } from '../shortcuts.js';
  import Icon from './Icon.svelte';
  let { editor }: { editor: EditorStore } = $props();
  let alignmentTarget = $state('root');
  function del() {
    editor.execute(removeElements(editor.selection));
    editor.clearSelection();
  }
  function group() {
    if (editor.selection.size < 2) return;
    const command = groupElements(editor.selection);
    editor.execute(command);
    editor.select([command.createdId]);
  }
  function ungroupSelected() {
    for (const id of editor.selection) editor.execute(ungroup(id));
    editor.clearSelection();
  }
  function targetBounds(): Bounds {
    const zone = editor.document.media.zones?.find((item) => item.id === alignmentTarget);
    return zone ?? { x: 0, y: 0, width: editor.document.media.width, height: editor.document.media.height };
  }
  function align(alignment: Alignment) {
    editor.execute(alignElementsToBounds(editor.selection, alignment, targetBounds()));
  }
  const alignments: [Alignment, string][] = [
    ['left', 'Left'],
    ['center-x', 'Horizontal center'],
    ['right', 'Right'],
    ['top', 'Top'],
    ['center-y', 'Vertical center'],
    ['bottom', 'Bottom'],
  ];
</script>

<nav aria-label="Drawing tools">
  <div class="group">
    {#each insertTypes as type}<button
        class="tool"
        onclick={() => insertElement(editor, type)}
        title={`Insert ${insertLabels[type].toLowerCase()}`}><Icon name={type} />{insertLabels[type]}</button
      >{/each}
  </div>
  <span class="spacer"></span>
  <div class="group">
    <button
      class="tool"
      onclick={() => editor.undo()}
      disabled={!editor.canUndo}
      title={`Undo (${shortcutLabel('Mod+Z')})`}><Icon name="undo" />Undo</button
    >
    <button
      class="tool"
      onclick={() => editor.redo()}
      disabled={!editor.canRedo}
      title={`Redo (${shortcutLabel('Mod+Shift+Z')})`}><Icon name="redo" />Redo</button
    >
  </div>
  <div class="group">
    <button class="tool" onclick={group} disabled={editor.selection.size < 2}><Icon name="group" />Group</button>
    <button class="tool" onclick={ungroupSelected} disabled={!editor.selectedElements.some((e) => e.type === 'group')}
      ><Icon name="ungroup" />Ungroup</button
    >
    <button class="tool" onclick={del} disabled={!editor.selection.size}><Icon name="delete" />Delete</button>
  </div>
  <div class="group align-tools" aria-label="Align selection inside">
    <label
      >Align to<select bind:value={alignmentTarget}
        ><option value="root">Label</option>{#each editor.document.media.zones ?? [] as zone}<option value={zone.id}
            >{zone.name}</option
          >{/each}</select
      ></label
    >
    {#each alignments as item}<button
        class="align"
        title={`Align ${item[1].toLowerCase()} inside ${alignmentTarget === 'root' ? 'label' : 'zone'}`}
        aria-label={`Align ${item[1].toLowerCase()}`}
        onclick={() => align(item[0])}
        disabled={!editor.selection.size}
        >{item[1] === 'Horizontal center' ? '↔' : item[1] === 'Vertical center' ? '↕' : item[1]}</button
      >{/each}
  </div>
</nav>

<style>
  nav {
    display: flex;
    gap: 0.15rem;
    align-items: center;
    padding: 0.3rem 0.5rem;
    background: var(--mble-background, #f7f4ed);
    border-bottom: 1px solid var(--mble-border, #d8d0c3);
  }
  .group {
    display: flex;
    gap: 0.1rem;
    align-items: center;
  }
  .group + .group {
    margin-left: 0.35rem;
    padding-left: 0.45rem;
    border-left: 1px solid var(--mble-border, #d8d0c3);
  }
  .spacer {
    flex: 1;
    min-width: 0.5rem;
  }
  .tool {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    white-space: nowrap;
  }
  .align-tools label {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .align-tools select {
    max-width: 7rem;
  }
  .align {
    min-width: 1.8rem;
    padding-inline: 0.3rem;
    font-size: 0.7rem;
  }
  @media (max-width: 900px) {
    nav {
      flex-wrap: wrap;
      row-gap: 0.25rem;
    }
    .group {
      flex-wrap: wrap;
      row-gap: 0.25rem;
    }
    .spacer {
      display: none;
    }
    .group + .group {
      margin-left: 0;
    }
  }
  @media (max-width: 600px) {
    .tool {
      gap: 0;
      font-size: 0;
    }
    .tool :global(.icon) {
      width: 17px;
      height: 17px;
    }
  }
</style>
