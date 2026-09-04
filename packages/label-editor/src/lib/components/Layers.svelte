<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import type { EditorStore } from '../store.svelte.js';
  import { isEffectivelyLocked, isEffectivelyVisible, type LabelDocument, type LabelElement } from '../model.js';
  import {
    createGroup,
    duplicateElements,
    moveToGroup,
    patchElement,
    removeElements,
    reorderElement,
    setLocked,
    setVisibility,
  } from '../commands.js';
  import { layerIcon, layerLabel, type LayerLabel } from '../layers.js';
  import Icon from './Icon.svelte';
  /** `title` is the panel heading; pass undefined when the host already names the panel. */
  let { editor, title = 'Layers' }: { editor: EditorStore; title?: string } = $props();
  /** Groups the user folded; everything else stays expanded. */
  const collapsed = new SvelteSet<string>();
  let dragging = $state<string | undefined>();
  let dropTarget = $state<string | undefined>();
  /** Row whose name is being edited inline, and the draft text. */
  let renaming = $state<string | undefined>();
  let draft = $state('');
  /** Effective visibility and lock are resolved once per row instead of per rendered control. */
  interface Row {
    element: LabelElement;
    depth: number;
    children: number;
    visible: boolean;
    locked: boolean;
    label: LayerLabel;
  }
  const byZ = (a: LabelElement, b: LabelElement) => b.zIndex - a.zIndex;
  function rows(document: LabelDocument, folded: Set<string>): Row[] {
    const elements = document.elements;
    const byId = new Map(elements.map((item) => [item.id, item]));
    const out: Row[] = [];
    const visit = (item: LabelElement, depth: number) => {
      const children = item.type === 'group' ? item.childIds.flatMap((id) => byId.get(id) ?? []) : [];
      out.push({
        element: item,
        depth,
        children: children.length,
        visible: isEffectivelyVisible(document, item),
        locked: isEffectivelyLocked(document, item),
        label: layerLabel(item, document),
      });
      if (!folded.has(item.id)) for (const child of [...children].sort(byZ)) visit(child, depth + 1);
    };
    for (const item of elements.filter((item) => !item.groupId).sort(byZ)) visit(item, 0);
    return out;
  }
  const list = $derived(rows(editor.document, collapsed));
  const layerCount = $derived(editor.document.elements.length);
  function toggle(id: string) {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
  }
  function addGroup() {
    const command = createGroup();
    editor.execute(command);
    editor.select([command.createdId]);
  }
  function movedIds(id: string) {
    return editor.selection.has(id) ? [...editor.selection] : [id];
  }
  function dragStart(event: DragEvent, id: string) {
    dragging = id;
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  function dragOver(event: DragEvent, id: string | undefined) {
    if (!dragging) return;
    event.preventDefault();
    dropTarget = id ?? 'root';
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }
  function drop(event: DragEvent, target: LabelElement | undefined) {
    event.preventDefault();
    const id = dragging ?? event.dataTransfer?.getData('text/plain');
    dragging = undefined;
    dropTarget = undefined;
    if (!id) return;
    const ids = movedIds(id).filter((item) => item !== target?.id);
    if (!ids.length) return;
    const groupId = target?.type === 'group' ? target.id : target?.groupId;
    try {
      editor.execute(moveToGroup(ids, groupId));
    } catch {
      /* dropping a group into its own subtree is refused */
    }
  }
  function dragEnd() {
    dragging = undefined;
    dropTarget = undefined;
  }
  function startRename(element: LabelElement) {
    renaming = element.id;
    draft = element.name;
    // The input exists after the next render; focus it once the frame has painted.
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-rename="${element.id}"]`);
      input?.focus();
      input?.select();
    });
  }
  function commitRename() {
    if (renaming === undefined) return;
    const id = renaming;
    const name = draft.trim();
    renaming = undefined;
    if (name) editor.execute(patchElement(id, { name }));
  }
  function cancelRename() {
    renaming = undefined;
  }
  function renameKeys(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  }
  /** Alt+Arrow moves the layer through the stack; F2 or Enter renames it. */
  function rowKeys(event: KeyboardEvent, element: LabelElement) {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      editor.execute(reorderElement(element.id, event.key === 'ArrowUp' ? 'forward' : 'backward'));
    } else if (event.key === 'F2' || (event.key === 'Enter' && !event.altKey)) {
      event.preventDefault();
      startRename(element);
    }
  }
  function openMenu(event: MouseEvent, element: LabelElement) {
    event.preventDefault();
    const details = (event.currentTarget as HTMLElement).querySelector<HTMLDetailsElement>('details.more');
    if (details) details.open = true;
    editor.select([element.id]);
  }
  function closeMenu(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('button'))
      (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  }
  function dismissMenu(event: FocusEvent) {
    const details = event.currentTarget as HTMLDetailsElement;
    const next = event.relatedTarget as Node | null;
    if (!next || !details.contains(next)) details.open = false;
  }
  function remove(element: LabelElement) {
    editor.execute(removeElements([element.id]));
    editor.selection.delete(element.id);
  }
  function duplicate(element: LabelElement) {
    editor.execute(duplicateElements([element.id]));
  }
</script>

<section>
  <div class="heading">
    {#if title !== undefined}<h2>{title}</h2>{:else}<span></span>{/if}
    <button class="add" onclick={addGroup} title="Add an empty group; drag layers onto it to nest them">+ Group</button>
  </div>
  <ol
    ondragover={(e) => dragOver(e, undefined)}
    ondrop={(e) => drop(e, undefined)}
    class:drop-root={dropTarget === 'root'}
  >
    {#each list as row (row.element.id)}
      {@const element = row.element}
      <li
        class:selected={editor.selection.has(element.id)}
        class:group={element.type === 'group'}
        class:drop={dropTarget === element.id}
        class:dragging={dragging === element.id}
        style={`--depth:${row.depth}`}
        draggable="true"
        ondragstart={(e) => dragStart(e, element.id)}
        ondragend={dragEnd}
        ondragover={(event) => {
          event.stopPropagation();
          dragOver(event, element.id);
        }}
        ondrop={(event) => {
          event.stopPropagation();
          drop(event, element);
        }}
        oncontextmenu={(event) => openMenu(event, element)}
      >
        {#if element.type === 'group'}<button
            class="fold"
            aria-label={collapsed.has(element.id) ? `Expand ${element.name}` : `Collapse ${element.name}`}
            aria-expanded={!collapsed.has(element.id)}
            onclick={(event) => {
              event.stopPropagation();
              toggle(element.id);
            }}>{collapsed.has(element.id) ? '▸' : '▾'}</button
          >{:else}<span class="fold" aria-hidden="true"></span>{/if}
        <span class="type" title={element.type}><Icon name={layerIcon(element)} /></span>
        {#if renaming === element.id}
          <input
            class="rename"
            data-rename={element.id}
            aria-label="Rename layer"
            value={draft}
            oninput={(event) => (draft = event.currentTarget.value)}
            onkeydown={renameKeys}
            onblur={commitRename}
          />
        {:else}
          <button
            class="name"
            onclick={(e) => editor.select([element.id], e.shiftKey)}
            ondblclick={(event) => {
              event.stopPropagation();
              startRename(element);
            }}
            onkeydown={(event) => rowKeys(event, element)}
            >{element.name}{#if element.type === 'group'}<span class="count">{row.children}</span>{/if}</button
          >
          {#if row.label.meta}<span class="meta" title={row.label.meta}>{row.label.meta}</span>{/if}
        {/if}
        <button
          aria-label={element.visible ? 'Hide' : 'Show'}
          class:inherited={element.visible && !row.visible}
          title={element.visible && !row.visible ? 'Hidden by its group' : undefined}
          onclick={() => editor.execute(setVisibility([element.id], !element.visible))}
          >{row.visible ? '◉' : '○'}</button
        >
        <button
          aria-label={element.locked ? 'Unlock' : 'Lock'}
          class:inherited={!element.locked && row.locked}
          title={!element.locked && row.locked ? 'Locked by its group' : undefined}
          onclick={() => editor.execute(setLocked([element.id], !element.locked))}>{row.locked ? '🔒' : '♢'}</button
        >
        <button
          aria-label="Raise"
          title="Bring forward"
          onclick={() => editor.execute(reorderElement(element.id, 'forward'))}><Icon name="raise" /></button
        >
        <button
          aria-label="Lower"
          title="Send backward"
          onclick={() => editor.execute(reorderElement(element.id, 'backward'))}><Icon name="lower" /></button
        >
        <details class="more" onfocusout={dismissMenu}>
          <summary aria-label={`More actions for ${element.name}`} title="More actions"><Icon name="more" /></summary>
          <!-- The sheet only observes clicks that bubble from its own buttons, which stay keyboard-operable themselves. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div class="sheet" onclick={closeMenu}>
            <button type="button" onclick={() => editor.execute(reorderElement(element.id, 'front'))}
              >Bring to front</button
            >
            <button type="button" onclick={() => editor.execute(reorderElement(element.id, 'forward'))}
              >Bring forward</button
            >
            <button type="button" onclick={() => editor.execute(reorderElement(element.id, 'backward'))}
              >Send backward</button
            >
            <button type="button" onclick={() => editor.execute(reorderElement(element.id, 'back'))}
              >Send to back</button
            >
            <button type="button" onclick={() => duplicate(element)}>Duplicate</button>
            <button type="button" onclick={() => startRename(element)}>Rename<kbd>F2</kbd></button>
            <button type="button" onclick={() => remove(element)}>Delete</button>
          </div>
        </details>
      </li>
    {/each}
  </ol>
  <p class="layer-count" aria-live="polite">{layerCount} {layerCount === 1 ? 'layer' : 'layers'}</p>
  <p class="hint">
    Drag a layer onto a group to nest it, or onto a top-level layer to take it out. Double-click a name to rename it;
    Alt+Arrow keys move it through the stack.
  </p>
</section>

<style>
  section {
    padding: 0.7rem 0.75rem;
  }
  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 0.5rem;
  }
  h2 {
    margin: 0;
    color: var(--mble-text-muted, #59635e);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .add {
    font-size: 0.7rem;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 0;
    min-height: 1.5rem;
    border-radius: var(--mble-radius-sm, 4px);
  }
  ol.drop-root {
    outline: 1px dashed var(--mble-accent, #d9724b);
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    padding-left: calc(var(--depth) * 0.9rem);
    border-radius: var(--mble-radius-sm, 4px);
  }
  li.dragging {
    opacity: 0.5;
  }
  li.drop {
    outline: 1px dashed var(--mble-accent, #d9724b);
    outline-offset: -1px;
  }
  .selected {
    background: var(--mble-selection, #f5c8b9);
  }
  .fold {
    width: 1.1rem;
    flex: none;
    padding: 0;
    text-align: center;
    color: var(--mble-text-muted, #59635e);
  }
  .type {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.1rem;
    color: var(--mble-text-muted, #59635e);
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename {
    flex: 1;
    min-width: 0;
    font-size: inherit;
  }
  .meta {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--mble-text-muted, #59635e);
    font-size: 0.68rem;
  }
  .count {
    margin-left: 0.35rem;
    color: var(--mble-text-muted, #59635e);
    font-size: 0.7rem;
  }
  .inherited {
    opacity: 0.55;
  }
  .more {
    position: relative;
  }
  .more > summary {
    display: grid;
    place-items: center;
    padding: 0.2rem 0.3rem;
    border-radius: var(--mble-radius-sm, 4px);
    list-style: none;
    color: var(--mble-text-muted, #59635e);
  }
  .more > summary::-webkit-details-marker {
    display: none;
  }
  .more > summary:hover,
  .more[open] > summary {
    background: var(--mble-surface-sunken, #f0e9e3);
    color: var(--mble-text, #17231c);
  }
  .sheet {
    position: absolute;
    right: 0;
    top: calc(100% + 0.2rem);
    z-index: 20;
    display: grid;
    gap: 0.1rem;
    min-width: 9rem;
    padding: 0.35rem;
    background: var(--mble-surface, #fff);
    border: 1px solid var(--mble-border, #d8d0c3);
    border-radius: var(--mble-radius-md, 6px);
    box-shadow: var(--mble-shadow, 0 8px 24px #17231c22);
  }
  .sheet button {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    text-align: left;
    padding: 0.3rem 0.45rem;
  }
  .sheet kbd {
    color: var(--mble-text-muted, #59635e);
    font-family: var(--mble-font-mono, ui-monospace, monospace);
    font-size: 0.68rem;
  }
  .layer-count {
    margin: 0.4rem 0 0;
    color: var(--mble-text-muted, #59635e);
    font-size: 0.68rem;
  }
  .hint {
    margin: 0.4rem 0 0;
    color: var(--mble-text-muted, #59635e);
    font-size: 0.68rem;
  }
</style>
