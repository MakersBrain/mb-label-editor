// SPDX-License-Identifier: AGPL-3.0-or-later
import init, * as wasm from '@makersbrain/printer-sdk/web';
import { adaptSdkProtocolPlan, defaultDocument, toSdkDocument, uuid, type LabelDocument, type PrinterSdk, type RasterPreview, type SdkPlanAction } from '@makersbrain/label-editor';

interface NormalizedPage { page: number; widthUm: number; heightUm: number; rasterWidth: number; rasterHeight: number; pixels: number[] }
interface Stamp extends NormalizedPage { slot: number }
let instance: Promise<PrinterSdk> | undefined;

export function loadPrinterSdk(): Promise<PrinterSdk> {
  return instance ??= (async () => { await init(); return adaptSdk(); })();
}

function adaptSdk(): PrinterSdk {
  const stampCache = new Map<string, Stamp>();
  return {
    async validate(document) { const errors = JSON.parse(wasm.validateDocument(JSON.stringify(toSdkDocument(document)))) as string[]; return { valid: !errors.length, errors }; },
    async render(document) { return decodePng(wasm.renderPng(JSON.stringify(toSdkDocument(document)))); },
    async exportPng(document) { return wasm.renderPng(JSON.stringify(toSdkDocument(document))); },
    async exportPdf(documents) { return wasm.renderBatchPdf(JSON.stringify(documents.map(toSdkDocument))); },
    async plan(document, printer) {
      const parsed = JSON.parse(wasm.renderProtocolPlan(JSON.stringify(toSdkDocument(document)), printer.id)) as { protocol: string; actions: SdkPlanAction[] };
      return adaptSdkProtocolPlan(parsed.protocol, parsed.actions);
    },
    async printerDefinitions() {
      const definitions = JSON.parse(wasm.printerCapabilities()) as { id: string; name: string; dpi: number; protocol: string; min_width_mm?: number; max_width_mm?: number; min_height_mm?: number; max_height_mm?: number }[];
      return definitions.map((item) => ({ id: item.id, displayName: item.name, dpi: item.dpi, protocols: [item.protocol], media: { minWidth: item.min_width_mm ?? 1, maxWidth: item.max_width_mm ?? 300, minHeight: item.min_height_mm ?? 1, maxHeight: item.max_height_mm ?? 1000 } }));
    },
    async importFirstPdfPage(data, dpi) {
      const [page] = JSON.parse(wasm.normalizePdf(data, dpi, true)) as NormalizedPage[];
      if (!page) throw new Error('PDF contains no page.');
      return { mimeType: 'image/png', data: await grayPng(page), widthMm: page.widthUm / 1000, heightMm: page.heightUm / 1000 };
    },
    async inspectLaPoste(data, format, options) {
      const stamps = JSON.parse(wasm.extractLaPostePdf(format, data, options?.dpi ?? 203)) as Stamp[];
      return stamps.filter((stamp) => !options?.pages || options.pages.includes(stamp.page)).map((stamp) => {
        const id = `${format}:${stamp.page}:${stamp.slot}`; stampCache.set(id, stamp);
        return { id, sourcePage: stamp.page, slot: stamp.slot, occupied: true, widthMm: 63.5, heightMm: 33.9, preview: grayPreview(stamp) };
      });
    },
    async laPosteSlotDocument(data, format, slot) {
      let stamp = stampCache.get(slot.id);
      if (!stamp) stamp = (JSON.parse(wasm.extractLaPostePdf(format, data, 203)) as Stamp[]).find((item) => item.page === slot.sourcePage && item.slot === slot.slot);
      if (!stamp) throw new Error('Selected La Poste slot is no longer available.');
      return imageDocument(await grayPng(stamp), `La Poste ${format} page ${stamp.page} slot ${stamp.slot}`);
    }
  };
}

async function decodePng(data: Uint8Array): Promise<RasterPreview> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(data).buffer], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(bitmap, 0, 0); const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data; bitmap.close();
  return { width: canvas.width, height: canvas.height, rgba: new Uint8Array(rgba) };
}
function grayPreview(page: NormalizedPage): RasterPreview {
  const rgba = new Uint8Array(page.rasterWidth * page.rasterHeight * 4);
  page.pixels.forEach((gray, index) => rgba.set([gray, gray, gray, 255], index * 4));
  return { width: page.rasterWidth, height: page.rasterHeight, rgba };
}
async function grayPng(page: NormalizedPage) {
  const canvas = new OffscreenCanvas(page.rasterWidth, page.rasterHeight); const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas is unavailable.');
  context.putImageData(new ImageData(new Uint8ClampedArray(grayPreview(page).rgba), page.rasterWidth, page.rasterHeight), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}
async function imageDocument(png: Uint8Array, title: string): Promise<LabelDocument> {
  const document = defaultDocument(); document.title = title; document.media.width = 63.5; document.media.height = 33.9; document.media.printableBounds = { x: 0, y: 0, width: 63.5, height: 33.9 };
  const id = uuid(); const input = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer; const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))].map((value) => value.toString(16).padStart(2, '0')).join('');
  let binary = ''; for (let offset = 0; offset < png.length; offset += 0x8000) binary += String.fromCharCode(...png.subarray(offset, offset + 0x8000));
  document.resources = [{ id, name: `${title}.png`, mimeType: 'image/png', sha256: digest, data: btoa(binary) }];
  document.elements = [{ id: uuid(), name: title, type: 'image', resourceId: id, fit: 'stretch', transform: { x: 0, y: 0, width: 63.5, height: 33.9, rotation: 0 }, zIndex: 0, visible: true, locked: false }];
  return document;
}
