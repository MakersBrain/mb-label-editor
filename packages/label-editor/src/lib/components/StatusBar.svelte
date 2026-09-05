<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { EditorStore } from '../store.svelte.js';
  import { selectionBounds } from '../zones.js';
  let { editor }: { editor: EditorStore } = $props();
  const mm = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  const media = $derived(editor.document.media);
  const bounds = $derived(editor.selection.size ? selectionBounds(editor.document, editor.selection) : undefined);
  const shapeLabel = $derived(
    media.shape === 'continuous' ? 'continuous roll' : media.shape === 'round' ? 'round' : 'rectangle',
  );
</script>

<div class="statusbar" aria-label="Status bar">
  <span class="label-info" title="Label media"
    >{mm(media.width)} × {media.shape === 'continuous' ? 'auto' : mm(media.height)} mm · {shapeLabel} · {media.dpi} dpi</span
  >
  {#if bounds}
    <span class="selection" title="Selection size and position"
      >{editor.selection.size === 1 ? 'Selection' : `${editor.selection.size} selected`}
      {mm(bounds.width)} × {mm(bounds.height)} mm at {mm(bounds.x)}, {mm(bounds.y)}</span
    >
  {/if}
  <span class="pointer" title="Pointer position on the label"
    >{#if editor.pointer}X {editor.pointer.x.toFixed(1)} mm · Y {editor.pointer.y.toFixed(1)} mm{:else}X — · Y —{/if}</span
  >
  <span class="zoom" title="Zoom">{Math.round(editor.view.zoom * 100)}%</span>
</div>

<style>
  .statusbar {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex: none;
    min-width: 0;
    padding: 0.2rem 0.75rem calc(0.2rem + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--mble-border);
    color: var(--mble-text-muted);
    font-size: var(--mble-text-micro);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
  }
  .statusbar > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pointer {
    margin-left: auto;
    min-width: 11rem;
    text-align: right;
  }
  .selection {
    color: var(--mble-text);
  }
  @media (hover: none) {
    .pointer {
      display: none;
    }
  }
</style>
