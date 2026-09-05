<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { tick } from 'svelte';
  import type { LabelDocument } from '../model.js';
  import type { PrinterSdk } from '../print/types.js';
  /** `zoom` is the canvas zoom applied by CSS transform on an ancestor; the raster is resampled to match it. */
  let { sdk, document, zoom = 1 }: { sdk: PrinterSdk; document: LabelDocument; zoom?: number } = $props();
  let canvas: HTMLCanvasElement | undefined = $state();
  let error = $state('');
  let source: HTMLCanvasElement | undefined;
  let crisp = $state(false);
  // Re-render only for a new prepared document; pan, zoom and selection never reach the WASM rasteriser.
  $effect(() => {
    const target = document;
    let cancelled = false;
    draw(target, () => cancelled).catch((reason: unknown) => {
      if (!cancelled) error = reason instanceof Error ? reason.message : String(reason);
    });
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    paint(canvas, zoom);
  });
  // The shown size and the device pixel ratio both change the resample target: a resized
  // viewport, a window dragged to another screen, or a browser zoom all repaint.
  $effect(() => {
    const target = canvas;
    if (!target || typeof ResizeObserver === 'undefined') return;
    const repaint = () => paint(target, zoom);
    const observer = new ResizeObserver(repaint);
    observer.observe(target);
    let media: MediaQueryList | undefined;
    const onRatioChange = () => {
      repaint();
      arm();
    };
    const arm = () => {
      media?.removeEventListener('change', onRatioChange);
      media = globalThis.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
      media?.addEventListener('change', onRatioChange);
    };
    arm();
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', onRatioChange);
    };
  });
  async function draw(target: LabelDocument, isCancelled: () => boolean) {
    try {
      const preview = await sdk.render(target, { exactThermal: true, record: target.template?.currentRecord });
      if (isCancelled()) return;
      await tick();
      const full = source ?? globalThis.document.createElement('canvas');
      full.width = preview.width;
      full.height = preview.height;
      const context = full.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.putImageData(new ImageData(new Uint8ClampedArray(preview.rgba), preview.width, preview.height), 0, 0);
      source = full;
      paint(canvas, zoom);
      error = '';
    } catch (reason) {
      if (!isCancelled()) error = reason instanceof Error ? reason.message : String(reason);
    }
  }
  /**
   * The printer raster is far denser than the screen. Nearest-neighbour sampling drops most
   * one-dot lines, so resample with area averaging to the size the raster is actually shown at.
   */
  function paint(target: HTMLCanvasElement | undefined, scaleBy: number) {
    const canvas = target;
    if (!source || !canvas) return;
    const ratio = globalThis.devicePixelRatio || 1;
    const shownWidth = (canvas.clientWidth || source.width) * scaleBy * ratio;
    const scale = Math.min(1, shownWidth / source.width);
    crisp = scale >= 1;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    // Area averaging keeps one-dot lines from vanishing but turns the printer's dots into grey haze.
    // Snap the result back to ink or paper, leaning towards ink so thin strokes survive.
    if (scale < 1) {
      const image = context.getImageData(0, 0, width, height);
      const pixels = image.data;
      for (let index = 0; index < pixels.length; index += 4) {
        const luminance = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
        const ink = pixels[index + 3] > 64 && luminance < 176;
        pixels[index] = pixels[index + 1] = pixels[index + 2] = ink ? 0 : 255;
        pixels[index + 3] = ink ? 255 : pixels[index + 3] > 64 ? 255 : 0;
      }
      context.putImageData(image, 0, 0);
    }
  }
</script>

<canvas bind:this={canvas} class:crisp aria-label="Exact thermal SDK preview"></canvas>
{#if error}<span class="error" title={error}>SDK preview unavailable</span>{/if}

<style>
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    mix-blend-mode: multiply;
    pointer-events: none;
  }
  canvas.crisp {
    image-rendering: pixelated;
  }
  .error {
    position: absolute;
    right: 0.3rem;
    bottom: 0.3rem;
    background: color-mix(in srgb, var(--mble-surface) 80%, transparent);
    color: var(--mble-danger);
    font-size: var(--mble-text-micro);
    z-index: 2;
  }
</style>
