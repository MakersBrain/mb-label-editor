<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { tick } from 'svelte';
  import type { LabelDocument } from '../model.js';
  import type { PrinterSdk } from '../print/types.js';
  export let sdk: PrinterSdk;
  export let document: LabelDocument;
  let canvas: HTMLCanvasElement;
  let generation = 0;
  let error = '';
  $: { document.modifiedAt; void draw(); }
  async function draw() {
    const current = ++generation;
    try {
      const preview = await sdk.render(document, { exactThermal: true, record: document.template?.currentRecord });
      if (current !== generation) return;
      await tick();
      canvas.width = preview.width; canvas.height = preview.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.putImageData(new ImageData(new Uint8ClampedArray(preview.rgba), preview.width, preview.height), 0, 0);
      error = '';
    } catch (reason) { if (current === generation) error = reason instanceof Error ? reason.message : String(reason); }
  }
</script>
<canvas bind:this={canvas} aria-label="Exact thermal SDK preview"></canvas>
{#if error}<span class="error" title={error}>SDK preview unavailable</span>{/if}
<style>canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;mix-blend-mode:multiply;pointer-events:none;z-index:0}.error{position:absolute;right:.3rem;bottom:.3rem;background:color-mix(in srgb,var(--mble-surface,#fff) 80%,transparent);color:var(--mble-danger,#a21);font-size:9px;z-index:2}</style>
