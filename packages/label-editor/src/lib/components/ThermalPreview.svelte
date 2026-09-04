<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { tick } from 'svelte';
  import type { LabelDocument } from '../model.js';
  import type { PrinterSdk } from '../print/types.js';
  export let sdk: PrinterSdk;
  export let document: LabelDocument;
  /** Canvas zoom applied by CSS transform on an ancestor; the raster is resampled to match it. */
  export let zoom = 1;
  let canvas: HTMLCanvasElement;
  let generation = 0;
  let error = '';
  let source: HTMLCanvasElement | undefined;
  let crisp = false;
  $: { document.modifiedAt; void draw(); }
  $: { zoom; paint(); }
  async function draw() {
    const current = ++generation;
    try {
      const preview = await sdk.render(document, { exactThermal: true, record: document.template?.currentRecord });
      if (current !== generation) return;
      await tick();
      const full = globalThis.document.createElement('canvas');
      full.width = preview.width; full.height = preview.height;
      const context = full.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.putImageData(new ImageData(new Uint8ClampedArray(preview.rgba), preview.width, preview.height), 0, 0);
      source = full;
      paint();
      error = '';
    } catch (reason) { if (current === generation) error = reason instanceof Error ? reason.message : String(reason); }
  }
  /**
   * The printer raster is far denser than the screen. Nearest-neighbour sampling drops most
   * one-dot lines, so resample with area averaging to the size the raster is actually shown at.
   */
  function paint() {
    if (!source || !canvas) return;
    const ratio = globalThis.devicePixelRatio || 1;
    const shownWidth = (canvas.clientWidth || source.width) * zoom * ratio;
    const scale = Math.min(1, shownWidth / source.width);
    crisp = scale >= 1;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
  }
</script>
<canvas bind:this={canvas} class:crisp aria-label="Exact thermal SDK preview"></canvas>
{#if error}<span class="error" title={error}>SDK preview unavailable</span>{/if}
<style>canvas{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:multiply;pointer-events:none;z-index:0}canvas.crisp{image-rendering:pixelated}.error{position:absolute;right:.3rem;bottom:.3rem;background:color-mix(in srgb,var(--mble-surface,#fff) 80%,transparent);color:var(--mble-danger,#a21);font-size:9px;z-index:2}</style>
