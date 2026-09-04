<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { EditorStore } from '../store.svelte.js';
  import { insertElement, insertLabels, insertTypes } from '../insert.js';
  import Icon from './Icon.svelte';
  /** `orientation` lays the rail out as a column beside the canvas or a row above it on narrow screens. */
  let { editor, orientation = 'vertical' }: { editor: EditorStore; orientation?: 'vertical' | 'horizontal' } = $props();
</script>

<nav class="rail" class:horizontal={orientation === 'horizontal'} aria-label="Drawing tools">
  {#each insertTypes as type (type)}
    <button
      type="button"
      class="tool"
      aria-label={insertLabels[type]}
      title={`Insert ${insertLabels[type].toLowerCase()}`}
      onclick={() => insertElement(editor, type)}><Icon name={type} /></button
    >
  {/each}
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.4rem 0.3rem;
    background: var(--mble-background, #f7f4ed);
    border-right: 1px solid var(--mble-border, #d8d0c3);
  }
  .rail.horizontal {
    flex-direction: row;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding: 0.3rem 0.4rem;
    border-right: 0;
    border-bottom: 1px solid var(--mble-border, #d8d0c3);
  }
  .tool {
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    scroll-snap-align: start;
  }
  .tool :global(.icon) {
    width: 18px;
    height: 18px;
  }
  @media (pointer: coarse) {
    .tool {
      width: 2.75rem;
      height: 2.75rem;
    }
  }
</style>
