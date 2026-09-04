<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import {
    alignElements,
    distributeElements,
    groupElements,
    removeElements,
    reorderElement,
    ungroup,
    addElement,
    type Alignment,
  } from '../commands.js';
  import { copyElements, pasteElements } from '../clipboard.js';
  import type { EditorStore } from '../store.svelte.js';
  import { insertElement, insertLabels, insertTypes } from '../insert.js';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import { shortcutLabel } from '../shortcuts.js';
  let {
    editor,
    sidebarOpen = true,
    onOpen = () => {},
    onToggleSidebar = () => {},
  }: {
    editor: EditorStore;
    sidebarOpen?: boolean;
    onOpen?: (dialog: string) => void;
    onToggleSidebar?: () => void;
  } = $props();
  const alignments: [Alignment, string][] = [
    ['left', 'Left'],
    ['center-x', 'Center'],
    ['right', 'Right'],
    ['top', 'Top'],
    ['center-y', 'Middle'],
    ['bottom', 'Bottom'],
  ];
  const orders: ['front' | 'forward' | 'backward' | 'back', string][] = [
    ['front', 'Bring to front'],
    ['forward', 'Bring forward'],
    ['backward', 'Send backward'],
    ['back', 'Send to back'],
  ];
  const align = (value: Alignment) => editor.execute(alignElements(editor.selection, value));
  function reorder(value: 'front' | 'forward' | 'backward' | 'back') {
    const id = [...editor.selection][0];
    if (id) editor.execute(reorderElement(id, value));
  }
  function group() {
    if (editor.selection.size < 2) return;
    const command = groupElements(editor.selection);
    editor.execute(command);
    editor.select([command.createdId]);
  }
  function paste() {
    const items = pasteElements();
    for (const item of items) editor.execute(addElement(item));
    editor.select(items.map((item) => item.id));
  }
</script>

<Menu label="Edit">
  <button onclick={() => editor.undo()} disabled={!editor.canUndo} title={shortcutLabel('Mod+Z')}
    ><Icon name="undo" />Undo<kbd>{shortcutLabel('Mod+Z')}</kbd></button
  >
  <button onclick={() => editor.redo()} disabled={!editor.canRedo} title={shortcutLabel('Mod+Shift+Z')}
    ><Icon name="redo" />Redo<kbd>{shortcutLabel('Mod+Shift+Z')}</kbd></button
  >
  <hr />
  <button onclick={() => editor.select(editor.document.elements.map((item) => item.id))}>Select all</button>
  <button onclick={() => copyElements(editor.document.elements, editor.selection)} disabled={!editor.selection.size}
    >Copy</button
  >
  <button onclick={paste}>Paste</button>
  <hr />
  <button onclick={group} disabled={editor.selection.size < 2}><Icon name="group" />Group</button>
  <button
    onclick={() => {
      for (const id of editor.selection) editor.execute(ungroup(id));
      editor.clearSelection();
    }}
    disabled={!editor.selectedElements.some((item) => item.type === 'group')}><Icon name="ungroup" />Ungroup</button
  >
  <button
    onclick={() => {
      editor.execute(removeElements(editor.selection));
      editor.clearSelection();
    }}
    disabled={!editor.selection.size}><Icon name="delete" />Delete</button
  >
</Menu>
<Menu label="Insert">
  {#each insertTypes as type}<button onclick={() => insertElement(editor, type)}
      ><Icon name={type} />{insertLabels[type]}</button
    >{/each}
</Menu>
<Menu label="Label">
  <button onclick={() => onOpen('media')}>Media &amp; zones…</button>
  <button onclick={() => onOpen('data')}>Data…</button>
  <button onclick={() => onOpen('assets')}>Assets…</button>
  <button onclick={() => onOpen('library')}>Library…</button>
</Menu>
<Menu label="Arrange">
  <p class="group-label">Align</p>
  {#each alignments as [value, text]}<button onclick={() => align(value)} disabled={editor.selection.size < 2}
      >{text}</button
    >{/each}
  <p class="group-label">Distribute</p>
  <button
    onclick={() => editor.execute(distributeElements(editor.selection, 'horizontal'))}
    disabled={editor.selection.size < 3}>Horizontally</button
  >
  <button
    onclick={() => editor.execute(distributeElements(editor.selection, 'vertical'))}
    disabled={editor.selection.size < 3}>Vertically</button
  >
  <p class="group-label">Order</p>
  {#each orders as [value, text]}<button onclick={() => reorder(value)} disabled={editor.selection.size !== 1}
      >{text}</button
    >{/each}
</Menu>
<Menu label="View">
  <label class="check"
    ><input
      type="checkbox"
      checked={editor.view.showGrid}
      onchange={(e) => editor.setView({ showGrid: e.currentTarget.checked })}
    />Grid</label
  >
  <label class="check"
    ><input
      type="checkbox"
      checked={editor.view.showRulers}
      onchange={(e) => editor.setView({ showRulers: e.currentTarget.checked })}
    />Rulers</label
  >
  <label class="check"
    ><input
      type="checkbox"
      checked={editor.view.snapping}
      onchange={(e) => editor.setView({ snapping: e.currentTarget.checked })}
    />Snap</label
  >
  <label
    >Grid mm<input
      type="number"
      min=".1"
      step=".1"
      value={editor.view.gridSize}
      onchange={(e) => editor.setView({ gridSize: Math.max(0.1, +e.currentTarget.value) })}
    /></label
  >
  <hr />
  <button onclick={() => onOpen('guides')}>Guides…</button>
  <button onclick={onToggleSidebar}>{sidebarOpen ? 'Hide panels' : 'Show panels'}</button>
  <hr />
  <button onclick={() => editor.setView({ zoom: Math.min(4, editor.view.zoom + 0.25) })}>Zoom in</button>
  <button onclick={() => editor.setView({ zoom: Math.max(0.25, editor.view.zoom - 0.25) })}>Zoom out</button>
  <button onclick={() => editor.setView({ zoom: 1, pan: { x: 0, y: 0 } })}>Reset view</button>
</Menu>
<Menu label="Help">
  <button onclick={() => onOpen('shortcuts')}>Keyboard shortcuts…<kbd>?</kbd></button>
  <button onclick={() => onOpen('syntax')}>Template syntax…</button>
</Menu>
