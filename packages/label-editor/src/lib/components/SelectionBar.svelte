<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import {
    alignElementsToBounds,
    duplicateElements,
    groupElements,
    removeElements,
    reorderElement,
    ungroup,
    type Alignment,
  } from '../commands.js';
  import type { Bounds, Point } from '../model.js';
  import type { EditorStore } from '../store.svelte.js';
  import Icon from './Icon.svelte';

  interface Props {
    editor: EditorStore;
    /** Screen position (viewport pixels) of the selection's top centre and bottom centre. */
    above: Point;
    below: Point;
    /** Viewport size in pixels, for clamping. */
    viewport: { width: number; height: number };
    /** Below about 64rem the alignment and ordering controls fold into a More menu. */
    compact?: boolean;
  }
  let { editor, above, below, viewport, compact = false }: Props = $props();
  let alignmentTarget = $state('root');
  let width = $state(0);
  let height = $state(0);
  const single = $derived(editor.selection.size === 1);
  const hasGroup = $derived(editor.selectedElements.some((item) => item.type === 'group'));
  const flipped = $derived(above.y - height - 4 < 0);
  const left = $derived(
    Math.min(Math.max(width / 2 + 4, above.x), Math.max(width / 2 + 4, viewport.width - width / 2 - 4)),
  );
  const top = $derived(flipped ? Math.min(below.y, viewport.height - height - 4) : above.y - height);
  const alignments: [Alignment, string][] = [
    ['left', 'Left'],
    ['center-x', 'Horizontal center'],
    ['right', 'Right'],
    ['top', 'Top'],
    ['center-y', 'Vertical center'],
    ['bottom', 'Bottom'],
  ];
  function targetBounds(): Bounds {
    const zone = editor.document.media.zones?.find((item) => item.id === alignmentTarget);
    return zone ?? { x: 0, y: 0, width: editor.document.media.width, height: editor.document.media.height };
  }
  function align(alignment: Alignment) {
    editor.execute(alignElementsToBounds(editor.selection, alignment, targetBounds()));
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
  function remove() {
    editor.execute(removeElements(editor.selection));
    editor.clearSelection();
  }
  function duplicate() {
    editor.execute(duplicateElements(editor.selection));
  }
  function reorder(target: 'forward' | 'backward') {
    const id = [...editor.selection][0];
    if (id) editor.execute(reorderElement(id, target));
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
</script>

<div
  class="selection-bar"
  class:flipped
  role="toolbar"
  aria-label="Selection"
  style={`left:${left}px;top:${top}px`}
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  <button type="button" onclick={group} disabled={editor.selection.size < 2} title="Group the selection (Ctrl+G)"
    ><Icon name="group" />Group</button
  >
  {#if hasGroup}<button type="button" onclick={ungroupSelected} title="Ungroup (Ctrl+Shift+G)"
      ><Icon name="ungroup" />Ungroup</button
    >{/if}
  <button type="button" onclick={duplicate} title="Duplicate the selection"><Icon name="duplicate" />Duplicate</button>
  <button type="button" onclick={remove} title="Delete the selection (Delete)"><Icon name="delete" />Delete</button>
  {#snippet alignAndOrder()}
    <div class="group align-tools" aria-label="Align selection inside">
      <label
        >Align to<select bind:value={alignmentTarget}
          ><option value="root">Label</option>{#each editor.document.media.zones ?? [] as zone (zone.id)}<option
              value={zone.id}>{zone.name}</option
            >{/each}</select
        ></label
      >
      {#each alignments as item (item[0])}<button
          type="button"
          class="align"
          title={`Align ${item[1].toLowerCase()} inside ${alignmentTarget === 'root' ? 'label' : 'zone'}`}
          aria-label={`Align ${item[1].toLowerCase()}`}
          onclick={() => align(item[0])}
          >{item[1] === 'Horizontal center' ? '↔' : item[1] === 'Vertical center' ? '↕' : item[1]}</button
        >{/each}
    </div>
    <div class="group">
      <button
        type="button"
        onclick={() => reorder('forward')}
        disabled={!single}
        aria-label="Bring forward"
        title="Bring forward"><Icon name="raise" /></button
      >
      <button
        type="button"
        onclick={() => reorder('backward')}
        disabled={!single}
        aria-label="Send backward"
        title="Send backward"><Icon name="lower" /></button
      >
    </div>
  {/snippet}
  {#if compact}
    <details class="more" onfocusout={dismissMenu}>
      <summary aria-label="More selection actions" title="More"><Icon name="more" /></summary>
      <!-- The sheet only observes clicks that bubble from its own buttons, which stay keyboard-operable themselves. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="sheet" onclick={closeMenu}>{@render alignAndOrder()}</div>
    </details>
  {:else}
    {@render alignAndOrder()}
  {/if}
</div>

<style>
  .selection-bar {
    position: absolute;
    z-index: 6;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.2rem 0.3rem;
    background: color-mix(in srgb, var(--mble-surface) 94%, transparent);
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-md);
    box-shadow: var(--mble-shadow);
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .selection-bar > button,
  .group > button {
    display: flex;
    gap: 0.3rem;
    align-items: center;
  }
  .group {
    display: flex;
    gap: 0.1rem;
    align-items: center;
    margin-left: 0.3rem;
    padding-left: 0.4rem;
    border-left: 1px solid var(--mble-border);
  }
  .align-tools label {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    font-size: 0.72rem;
  }
  .align-tools select {
    max-width: 6rem;
  }
  .align {
    min-width: 1.8rem;
    padding-inline: 0.3rem;
    font-size: 0.7rem;
  }
  .more {
    position: relative;
    margin-left: 0.2rem;
  }
  .more > summary {
    display: grid;
    place-items: center;
    width: 1.8rem;
    height: 1.7rem;
    border-radius: var(--mble-radius-sm);
    list-style: none;
  }
  .more > summary::-webkit-details-marker {
    display: none;
  }
  .more > summary:hover,
  .more[open] > summary {
    background: var(--mble-surface-sunken);
  }
  .sheet {
    position: absolute;
    right: 0;
    top: calc(100% + 0.3rem);
    display: grid;
    gap: 0.3rem;
    padding: 0.4rem;
    background: var(--mble-surface);
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-md);
    box-shadow: var(--mble-shadow);
  }
  .sheet .group {
    margin: 0;
    padding: 0;
    border: 0;
    flex-wrap: wrap;
  }
</style>
