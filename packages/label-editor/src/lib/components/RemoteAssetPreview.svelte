<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { ExternalResourceProvider } from '../external-resources/types.js';
  /** `trim` crops large transparent margins that catalogue previews often carry, so the artwork fills its tile. */
  let {
    provider,
    path,
    alt = '',
    trim = true,
  }: { provider: ExternalResourceProvider; path: string; alt?: string; trim?: boolean } = $props();
  let source = $state('');
  let failed = $state(false);
  $effect(() => {
    let active = true;
    source = '';
    failed = false;
    let objectUrl = '';
    void provider
      .fetchBlob(path)
      .then(async (blob) => {
        if (!active) return;
        const trimmed = trim
          ? await (blob.type.includes('svg') ? trimmedSvgDataUrl(blob) : trimmedDataUrl(blob)).catch(() => '')
          : '';
        if (!active) return;
        if (trimmed) {
          source = trimmed;
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        source = objectUrl;
      })
      .catch(() => {
        if (active) failed = true;
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  });
  /** Finds the inked pixel bounds of an image; null when it is blank. */
  function inkBounds(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): { left: number; top: number; right: number; bottom: number } | null {
    let left = width,
      top = height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const opaque = data[index + 3] > 16;
        const ink = opaque && (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245);
        if (!ink) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    return right < 0 ? null : { left, top, right, bottom };
  }
  /** Tightens an SVG's viewBox to its drawing by rasterising it once, so vector artwork fills the tile and stays crisp. */
  async function trimmedSvgDataUrl(blob: Blob): Promise<string> {
    const text = await blob.text();
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.nodeName !== 'svg') return '';
    const box = (root.getAttribute('viewBox') ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const [minX, minY, boxWidth, boxHeight] =
      box.length === 4 && box.every(Number.isFinite)
        ? box
        : [0, 0, parseFloat(root.getAttribute('width') ?? '0'), parseFloat(root.getAttribute('height') ?? '0')];
    if (!(boxWidth > 0 && boxHeight > 0)) return '';
    const scale = 256 / Math.max(boxWidth, boxHeight);
    const rasterWidth = Math.max(1, Math.round(boxWidth * scale)),
      rasterHeight = Math.max(1, Math.round(boxHeight * scale));
    const probe = root.cloneNode(true) as SVGSVGElement;
    probe.setAttribute('viewBox', `${minX} ${minY} ${boxWidth} ${boxHeight}`);
    probe.setAttribute('width', String(rasterWidth));
    probe.setAttribute('height', String(rasterHeight));
    const probeUrl = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(probe)], { type: 'image/svg+xml' }),
    );
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('svg raster failed'));
        image.src = probeUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = rasterWidth;
      canvas.height = rasterHeight;
      const context = canvas.getContext('2d');
      if (!context) return '';
      context.drawImage(image, 0, 0, rasterWidth, rasterHeight);
      const bounds = inkBounds(context.getImageData(0, 0, rasterWidth, rasterHeight).data, rasterWidth, rasterHeight);
      if (!bounds) return '';
      const pad = Math.max(1, Math.round(Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) * 0.06));
      const left = Math.max(0, bounds.left - pad),
        top = Math.max(0, bounds.top - pad);
      const right = Math.min(rasterWidth, bounds.right + pad + 1),
        bottom = Math.min(rasterHeight, bounds.bottom + pad + 1);
      if ((right - left) * (bottom - top) > rasterWidth * rasterHeight * 0.9) return '';
      const output = root.cloneNode(true) as SVGSVGElement;
      output.setAttribute(
        'viewBox',
        `${minX + left / scale} ${minY + top / scale} ${(right - left) / scale} ${(bottom - top) / scale}`,
      );
      output.removeAttribute('width');
      output.removeAttribute('height');
      output.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(output))}`;
    } finally {
      URL.revokeObjectURL(probeUrl);
    }
  }
  /** Crops to the opaque, non-white pixels plus a small margin and returns a PNG data URL, or empty when nothing to crop. */
  async function trimmedDataUrl(blob: Blob): Promise<string> {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return '';
    const bitmap = await createImageBitmap(blob);
    try {
      const { width, height } = bitmap;
      if (!width || !height || width * height > 4_000_000) return '';
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) return '';
      context.drawImage(bitmap, 0, 0);
      const bounds = inkBounds(context.getImageData(0, 0, width, height).data, width, height);
      if (!bounds) return '';
      const { left, top, right, bottom } = bounds;
      const pad = Math.max(2, Math.round(Math.max(right - left, bottom - top) * 0.06));
      const cropX = Math.max(0, left - pad),
        cropY = Math.max(0, top - pad);
      const cropWidth = Math.min(width, right + pad + 1) - cropX,
        cropHeight = Math.min(height, bottom + pad + 1) - cropY;
      if (cropWidth >= width && cropHeight >= height) return '';
      const output = new OffscreenCanvas(cropWidth, cropHeight);
      const target = output.getContext('2d');
      if (!target) return '';
      target.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const png = await output.convertToBlob({ type: 'image/png' });
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(png);
      });
    } finally {
      bitmap.close();
    }
  }
</script>

{#if source}<img src={source} {alt} draggable="false" />{:else}<span
    class="preview"
    aria-label={failed ? 'Preview unavailable' : 'Loading preview'}>▧</span
  >{/if}

<style>
  .preview {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    color: var(--mble-text-muted, #666);
    background: var(--mble-surface-muted, #eee);
  }
</style>
