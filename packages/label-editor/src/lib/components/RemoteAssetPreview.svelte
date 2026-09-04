<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { ExternalResourceProvider } from '../external-resources/types.js';
  export let provider: ExternalResourceProvider;
  export let path: string;
  export let alt = '';
  /** Catalogue previews often carry large transparent margins; trimming lets the artwork fill its tile. */
  export let trim = true;
  let source = '';
  let failed = false;
  onMount(() => {
    let active = true;
    let objectUrl = '';
    void provider.fetchBlob(path).then(async blob => {
      if (!active) return;
      const trimmed = trim ? await trimmedDataUrl(blob).catch(() => '') : '';
      if (!active) return;
      if (trimmed) { source = trimmed; return; }
      objectUrl = URL.createObjectURL(blob);
      source = objectUrl;
    }).catch(() => { if (active) failed = true; });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  });
  /** Crops to the opaque, non-white pixels plus a small margin and returns a PNG data URL, or empty when nothing to crop. */
  async function trimmedDataUrl(blob: Blob): Promise<string> {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return '';
    const bitmap = await createImageBitmap(blob);
    try {
      const { width, height } = bitmap;
      if (!width || !height || width * height > 4_000_000) return '';
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d'); if (!context) return '';
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, width, height);
      let left = width, top = height, right = -1, bottom = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const opaque = data[index + 3] > 16;
        const ink = opaque && (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245);
        if (!ink) continue;
        if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
      }
      if (right < 0) return '';
      const pad = Math.max(2, Math.round(Math.max(right - left, bottom - top) * 0.06));
      const cropX = Math.max(0, left - pad), cropY = Math.max(0, top - pad);
      const cropWidth = Math.min(width, right + pad + 1) - cropX, cropHeight = Math.min(height, bottom + pad + 1) - cropY;
      if (cropWidth >= width && cropHeight >= height) return '';
      const output = new OffscreenCanvas(cropWidth, cropHeight);
      const target = output.getContext('2d'); if (!target) return '';
      target.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const png = await output.convertToBlob({ type: 'image/png' });
      return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(png); });
    } finally { bitmap.close(); }
  }
</script>
{#if source}<img src={source} {alt} draggable="false">{:else}<span class="preview" aria-label={failed ? 'Preview unavailable' : 'Loading preview'}>▧</span>{/if}
<style>.preview{display:grid;width:2.5rem;height:2.5rem;place-items:center;color:var(--mble-text-muted,#666);background:var(--mble-surface-muted,#eee)}</style>
