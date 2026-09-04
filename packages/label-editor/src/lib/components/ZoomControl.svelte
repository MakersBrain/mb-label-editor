<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { EditorStore } from '../store.svelte.js';
  import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, zoomPresets } from '../view.js';
  let { editor }: { editor: EditorStore } = $props();
  const percent = $derived(Math.round(editor.view.zoom * 100));
  function close(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('button'))
      (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  }
  function dismiss(event: FocusEvent) {
    const details = event.currentTarget as HTMLDetailsElement;
    const next = event.relatedTarget as Node | null;
    if (!next || !details.contains(next)) details.open = false;
  }
</script>

<div class="zoom-control" role="group" aria-label="Zoom">
  <button
    type="button"
    aria-label="Zoom out"
    title="Zoom out"
    onclick={() => editor.setZoom(editor.view.zoom / ZOOM_STEP)}>−</button
  >
  <input
    class="zoom"
    type="range"
    min={ZOOM_MIN}
    max={ZOOM_MAX}
    step="0.05"
    aria-label="Zoom level"
    value={editor.view.zoom}
    oninput={(event) => editor.setZoom(+event.currentTarget.value)}
  />
  <button
    type="button"
    aria-label="Zoom in"
    title="Zoom in"
    onclick={() => editor.setZoom(editor.view.zoom * ZOOM_STEP)}>+</button
  >
  <details class="presets" onfocusout={dismiss}>
    <summary aria-label="Zoom presets" title="Zoom presets"
      ><span class="percent">{percent}%</span>{#if editor.view.zoomMode === 'fit'}<span class="fit">Fit</span
        >{/if}</summary
    >
    <!-- The sheet only observes clicks that bubble from its own buttons, which stay keyboard-operable themselves. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="sheet" onclick={close}>
      <button type="button" onclick={() => editor.setView({ zoomMode: 'fit' })}>Fit to window<kbd>Shift+1</kbd></button>
      {#each zoomPresets as preset (preset)}
        <button type="button" onclick={() => editor.setZoom(preset)}
          >{Math.round(preset * 100)}%{#if preset === 1}<kbd>Ctrl+0</kbd>{/if}</button
        >
      {/each}
    </div>
  </details>
</div>

<style>
  .zoom-control {
    position: absolute;
    right: 0.6rem;
    bottom: 0.6rem;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.2rem 0.3rem;
    background: color-mix(in srgb, var(--mble-surface, #fff) 92%, transparent);
    border: 1px solid var(--mble-border, #d8d0c3);
    border-radius: var(--mble-radius-md, 6px);
    box-shadow: var(--mble-shadow, 0 8px 24px #17231c22);
    font-size: 0.75rem;
  }
  .zoom-control > button {
    width: 1.6rem;
    padding: 0.15rem 0;
    line-height: 1;
    text-align: center;
  }
  .zoom {
    width: 6rem;
  }
  .presets {
    position: relative;
  }
  .presets > summary {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 3.4rem;
    padding: 0.2rem 0.4rem;
    border-radius: var(--mble-radius-sm, 4px);
    list-style: none;
    cursor: default;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .presets > summary::-webkit-details-marker {
    display: none;
  }
  .presets > summary:hover,
  .presets[open] > summary {
    background: var(--mble-surface-sunken, #f0e9e3);
  }
  .fit {
    padding: 0 0.3rem;
    border-radius: 999px;
    background: var(--mble-selection, #f5c8b9);
    color: var(--mble-text, #17231c);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sheet {
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.3rem);
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
  @media (pointer: coarse) {
    .zoom-control > button,
    .presets > summary {
      min-height: 2.75rem;
    }
  }
</style>
