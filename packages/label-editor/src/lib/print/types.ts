// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from '../model.js';

export type ProtocolAction =
  | { type: 'job-boundary'; phase: 'start' | 'end'; id: string }
  | { type: 'subscribe'; channel: string }
  | { type: 'write'; data: Uint8Array; chunkable: boolean; atomic: boolean; logicalChunkSize: number; delayAfterMs: number }
  | { type: 'delay'; milliseconds: number }
  | { type: 'wait-response'; channel: string; timeoutMs: number; fallbackDelayMs?: number; validate?: string };
export interface ProtocolPlan { protocol: string; actions: ProtocolAction[]; totalBytes: number }
/** Wire shape emitted by the sibling mb-printer-core/WASM package. */
export type SdkPlanAction =
  | { action:'job-boundary';kind:'start'|'end' }
  | { action:'subscribe-notifications' }
  | { action:'command-write';name:string;bytes:number[];atomic:boolean }
  | { action:'raster-write';bytes:number[];logical_chunk:number;delay_after_each_physical_write_ms:number }
  | { action:'delay';milliseconds:number }
  | { action:'wait-for-response';timeout_ms:number;fallback_delay_ms:number;validation:string };
export function adaptSdkProtocolPlan(protocol:string,actions:SdkPlanAction[]):ProtocolPlan { let totalBytes=0;const normalized:ProtocolAction[]=actions.map((item)=>{switch(item.action){case'job-boundary':return{type:'job-boundary',phase:item.kind,id:`${protocol}-${item.kind}`};case'subscribe-notifications':return{type:'subscribe',channel:'printer'};case'command-write':{const data=Uint8Array.from(item.bytes);totalBytes+=data.length;return{type:'write',data,chunkable:false,atomic:item.atomic,logicalChunkSize:data.length,delayAfterMs:0}}case'raster-write':{const data=Uint8Array.from(item.bytes);totalBytes+=data.length;return{type:'write',data,chunkable:true,atomic:false,logicalChunkSize:item.logical_chunk,delayAfterMs:item.delay_after_each_physical_write_ms}}case'delay':return{type:'delay',milliseconds:item.milliseconds};case'wait-for-response':return{type:'wait-response',channel:'printer',timeoutMs:item.timeout_ms,fallbackDelayMs:item.fallback_delay_ms,validate:item.validation}}});return{protocol,actions:normalized,totalBytes} }
export interface PrinterDefinition { id: string; displayName: string; dpi: number; protocols: string[]; media: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number } }
export interface PrinterStatus { protocol: string; mediaWidthMm?: number; mediaLengthMm?: number; mediaType?: string; statusType?: string; phase?: string; errors: string[]; raw: Uint8Array }
export interface RasterPreview { width: number; height: number; rgba: Uint8Array }
export interface LaPosteSlot { id: string; sourcePage: number; slot: number; occupied: boolean; widthMm: 63.5; heightMm: 33.9; preview: RasterPreview }
export interface PrinterSdk {
  /** Validates an unmodified canonical value so schema-unknown fields cannot be lost by an adapter. */
  validateCanonical(value: unknown): Promise<{ valid: boolean; errors: string[] }>;
  importV3Canonical?(value: unknown): Promise<unknown>;
  validate(document: LabelDocument): Promise<{ valid: boolean; errors: string[] }>;
  render(document: LabelDocument, options?: { exactThermal?: boolean; record?: number }): Promise<RasterPreview>;
  exportPng(document: LabelDocument, options?: { record?: number }): Promise<Uint8Array>;
  exportPdf(documents: LabelDocument[]): Promise<Uint8Array>;
  plan(document: LabelDocument, printer: PrinterDefinition, options: { copies: number; density?: number; record?: number }): Promise<ProtocolPlan>;
  printerDefinitions(): Promise<PrinterDefinition[]>;
  /** Document-free plan that only asks the printer for its status. Absent when the protocol cannot answer. */
  statusPlan?(printer: PrinterDefinition): Promise<ProtocolPlan>;
  /** Decodes a captured status reply for the printer's protocol. */
  parseStatus?(printer: PrinterDefinition, data: Uint8Array): Promise<PrinterStatus>;
  importFirstPdfPage(data: Uint8Array, dpi: number): Promise<{ mimeType: 'image/png'; data: Uint8Array; widthMm: number; heightMm: number }>;
  inspectLaPoste(data: Uint8Array, format: LaPosteFormat, options?: { pages?: number[]; dpi?: number }): Promise<LaPosteSlot[]>;
  laPosteSlotDocument(data: Uint8Array, format: LaPosteFormat, slot: LaPosteSlot): Promise<LabelDocument>;
}
export const LA_POSTE_FORMATS = ['L24A', 'L24B', 'L21A', 'L18A', 'L16A', 'L14A', 'L12A', 'L24A_SHEET', 'SHEET'] as const;
export type LaPosteFormat = typeof LA_POSTE_FORMATS[number];
export type PrintOutcome = 'completed' | 'cancelled-before-send' | 'cancelled-partial' | 'outcome-unknown' | 'failed';
export interface PrintProgress { action: number; actions: number; bytesSent: number; totalBytes: number; phase: string }
export interface PrintResult { outcome: PrintOutcome; lastCompletedAction: number; bytesSent: number; error?: string }
export interface PrintRequest { document: LabelDocument; printer: PrinterDefinition; copies: number; density?: number; record?: number; signal?: AbortSignal; onProgress?: (progress: PrintProgress) => void }
export interface PrintRoute { readonly id: string; readonly label: string; isSupported(): boolean; print(request: PrintRequest): Promise<PrintResult>; queryStatus?(printer: PrinterDefinition, options?: { signal?: AbortSignal }): Promise<PrinterStatus> }
