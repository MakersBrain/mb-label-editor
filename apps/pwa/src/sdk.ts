// SPDX-License-Identifier: AGPL-3.0-or-later
import init, * as wasm from '@makersbrain/printer-sdk/web';
import { executePlan as executeBrowserPlan } from '@makersbrain/printer-sdk/adapters';
import { DocumentMaterializationError, adaptSdkProtocolPlan, defaultDocument, fromSdkDocument, isSheetPlan, isZoneBatchPlanForRequest, structuredMaterializationError, toSdkDocument, toSdkPlanActions, uuid, type DocumentMaterializer, type LabelDocument, type MaterializeOptions, type MediaPreset, type PrinterDefinition, type PrinterSdk, type PrinterStatus, type RasterPreview, type SdkPlanAction, type SheetDiagnostic, type SheetExporter, type ZoneBatchOptions } from '@makersbrain/label-editor';

interface NormalizedPage { page: number; widthUm: number; heightUm: number; rasterWidth: number; rasterHeight: number; pixels: number[] }
interface Stamp extends NormalizedPage { slot: number }
type BrowserSdk = PrinterSdk & SheetExporter & DocumentMaterializer;
let instance: Promise<BrowserSdk> | undefined;

export function loadPrinterSdk(diagnostics?: (event: SheetDiagnostic) => void): Promise<BrowserSdk> {
  return instance ??= (async () => { await init(); return adaptSdk(diagnostics); })();
}

function adaptSdk(diagnostics?: (event: SheetDiagnostic) => void): BrowserSdk {
  const stampCache = new Map<string, Stamp>();
  return {
    async materializeRecord(document, record, options) {
      try { return materializedDocument(JSON.parse(wasm.materializeRecord(JSON.stringify(toSdkDocument(document)), JSON.stringify(record), JSON.stringify(materializeOptions(options)))) as unknown); }
      catch (error) { throw structuredMaterializationError(error); }
    },
    async planZoneBatch(document, input) {
      try { const plan = JSON.parse(wasm.planZoneBatch(JSON.stringify(toSdkDocument(document)), JSON.stringify(input))) as unknown; if (!isZoneBatchPlanForRequest(plan, input)) throw new DocumentMaterializationError('request.encode_failed'); return plan; }
      catch (error) { throw structuredMaterializationError(error); }
    },
    async materializeZoneBatch(document, records, options) {
      try { const pages = JSON.parse(wasm.materializeZoneBatch(JSON.stringify(toSdkDocument(document)), JSON.stringify(records), JSON.stringify(materializeOptions(options)))) as unknown; if (!Array.isArray(pages)) throw new DocumentMaterializationError('request.encode_failed'); return pages.map(materializedDocument); }
      catch (error) { throw structuredMaterializationError(error); }
    },
    async validateCanonical(value) { const errors = JSON.parse(wasm.validateDocument(JSON.stringify(value))) as string[]; return { valid: !errors.length, errors }; },
    async importV3Canonical(value) { return JSON.parse(wasm.importV3(JSON.stringify(value))) as unknown; },
    async validate(document) { const errors = JSON.parse(wasm.validateDocument(JSON.stringify(toSdkDocument(document)))) as string[]; return { valid: !errors.length, errors }; },
    async render(document) { return decodePng(wasm.renderPng(JSON.stringify(toSdkDocument(document)))); },
    async exportPng(document) { return wasm.renderPng(JSON.stringify(toSdkDocument(document))); },
    async exportPdf(documents) { return wasm.renderBatchPdf(JSON.stringify(documents.map(toSdkDocument))); },
    async planSheet(input, layout, options) {
      const started = performance.now();
      try {
        const plan = JSON.parse(wasm.planSheet(JSON.stringify(input), JSON.stringify(layout), JSON.stringify(options))) as unknown;
        if (!isSheetPlan(plan)) throw new Error('The printer SDK returned an invalid sheet plan.');
        diagnostics?.({ operation: 'plan', outcome: 'completed', durationMs: performance.now() - started, pages: plan.pageCount, items: input.itemCount });
        return plan;
      } catch (error) {
        diagnostics?.({ operation: 'plan', outcome: 'failed', durationMs: performance.now() - started, items: input.itemCount, errorCode: sdkErrorCode(error) });
        throw error;
      }
    },
    async exportSheetPdf(documents, layout, options) {
      const started = performance.now();
      try {
        const data = wasm.buildSheetPdf(JSON.stringify(documents.map(toSdkDocument)), JSON.stringify(layout), JSON.stringify(options));
        diagnostics?.({ operation: 'export', outcome: 'completed', durationMs: performance.now() - started, items: documents.length });
        return data;
      } catch (error) {
        diagnostics?.({ operation: 'export', outcome: 'failed', durationMs: performance.now() - started, items: documents.length, errorCode: sdkErrorCode(error) });
        throw error;
      }
    },
    async plan(document, printer, options) {
      const request = JSON.stringify({ copies: options.copies, ...(options.density === undefined ? {} : { density: options.density }), streaming: !!options.streaming, lzo: !!options.lzo });
      const parsed = JSON.parse(wasm.renderProtocolPlanWithOptions(JSON.stringify(toSdkDocument(document)), printer.id, request)) as { protocol: string; actions: SdkPlanAction[] };
      return adaptSdkProtocolPlan(parsed.protocol, parsed.actions);
    },
    async executePlan(plan, transport, progress, signal) {
      return executeBrowserPlan(plan.sdkActions ?? toSdkPlanActions(plan), transport, progress, signal);
    },
    async mediaPresets(printer): Promise<MediaPreset[]> {
      return JSON.parse(wasm.mediaPresets(printer.id)) as MediaPreset[];
    },
    async statusPlan(printer) {
      const parsed = JSON.parse(wasm.statusPlan(printer.id)) as { protocol: string; actions: SdkPlanAction[] };
      return adaptSdkProtocolPlan(parsed.protocol, parsed.actions);
    },
    async parseStatus(printer: PrinterDefinition, frames: Uint8Array[]): Promise<PrinterStatus> {
      const protocol = printer.protocols[0] ?? 'brother';
      if (protocol === 'brother') {
        const status = JSON.parse(wasm.parseBrotherStatus(frames[frames.length - 1])) as Omit<PrinterStatus, 'protocol' | 'raw'>;
        // Name the roll the printer just reported, so the reading is actionable.
        const media = JSON.parse(wasm.matchMedia(printer.id, status.mediaWidthMm ?? 0, status.mediaLengthMm ?? 0)) as MediaPreset | null;
        return { protocol, ...status, media: media ?? undefined, raw: frames };
      }
      const status = JSON.parse(wasm.parsePhomemoStatus(JSON.stringify(frames.map((frame) => [...frame])))) as Omit<PrinterStatus, 'protocol' | 'raw'>;
      return { protocol, ...status, raw: frames };
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

function materializeOptions(options?: MaterializeOptions | ZoneBatchOptions) {
  const now = new Date();
  const currentDate = `${now.getFullYear().toString().padStart(4, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  return { locale: options?.locale ?? globalThis.navigator?.language ?? 'en', currentDate: options?.currentDate ?? currentDate, ...('zoneIds' in (options ?? {}) ? { zoneIds: (options as ZoneBatchOptions).zoneIds } : {}) };
}
function materializedDocument(value: unknown): LabelDocument {
  const canonical = structuredClone(value) as Record<string, unknown>;
  const extensions = canonical.extensions;
  if (extensions && typeof extensions === 'object' && !Array.isArray(extensions)) {
    const state = (extensions as Record<string, unknown>)['makersbrain.editor:state'];
    if (state && typeof state === 'object' && !Array.isArray(state)) {
      const safeState = { ...(state as Record<string, unknown>) }; delete safeState.id; delete safeState.template; delete safeState.elements;
      (extensions as Record<string, unknown>)['makersbrain.editor:state'] = safeState;
    }
  }
  const document = fromSdkDocument(canonical); delete document.template; return document;
}

const sdkErrorCode = (error: unknown) => error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'sheet.unknown';

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
