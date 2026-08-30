// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrinterDefinition, PrinterSdk, PrinterStatus, PrintRequest, PrintResult, PrintRoute, ProtocolAction, ProtocolPlan } from './types.js';
import type { JobJournal } from '../jobs.js';
import type { PersistedJob } from '../persistence/database.js';

export interface DirectTransport {
  readonly kind: 'bluetooth' | 'usb' | 'serial'; readonly physicalWriteLimit?: number; readonly commandWriteLimit?: number; readonly negotiatedAttMtu?: number;
  connect(): Promise<void>; disconnect(): Promise<void>; write(data: Uint8Array, signal?: AbortSignal): Promise<void>;
  subscribe(channel: string, signal?: AbortSignal): Promise<void>; waitResponse(channel: string, timeoutMs: number, validation?: string, signal?: AbortSignal): Promise<Uint8Array>;
}
export class DirectPrintRoute implements PrintRoute {
  readonly id: string; readonly label: string; private retryProhibited = false; private transport?: DirectTransport;
  constructor(private sdk: PrinterSdk, private transportFactory: () => Promise<DirectTransport>, private kind: 'bluetooth' | 'usb' | 'serial', private supported: () => boolean = () => true, private journal?: JobJournal) { this.id = `web-${kind}`; this.label = kind === 'serial' ? 'Bluetooth SPP (Web Serial)' : `Web ${kind === 'bluetooth' ? 'Bluetooth' : 'USB'}`; }
  get connected() { return this.transport !== undefined; }
  isSupported() { return globalThis.isSecureContext === true && this.supported(); }
  async connect(options?: { signal?: AbortSignal }) {
    if (this.transport) return;
    const candidate = await this.transportFactory();
    try {
      await abortable(candidate.connect(), options?.signal);
      this.transport = candidate;
    } catch (error) {
      try { await candidate.disconnect(); } catch { /* connection never became usable */ }
      throw error;
    }
  }
  async disconnect() {
    const transport = this.transport;
    this.transport = undefined;
    if (transport) await transport.disconnect();
  }
  async print(request: PrintRequest): Promise<PrintResult> {
    if (this.retryProhibited) return { outcome: 'failed', bytesSent: 0, lastCompletedAction: -1, error: 'Automatic retry is prohibited after an ambiguous direct-print outcome. Inspect the printer and start a new explicit job.' };
    const persisted = await this.journal?.begin(request.document, this.id);
    let transport: DirectTransport | undefined; let transient = false; let bytesSent = 0; let lastCompletedAction = -1; let potentiallyAccepted = false; let notificationsAvailable = true;
    const finish = async (result: PrintResult) => { if (persisted) await this.journal?.finish(persisted, result); if (result.outcome === 'outcome-unknown' || result.outcome === 'cancelled-partial') this.retryProhibited = true; return result; };
    try {
      // Only GATT needs the per-chunk pacing; a serial port or a bulk endpoint
      // streams the job the way the vendor drivers do.
      const plan = await this.sdk.plan(request.document, request.printer, { copies: request.copies, density: request.density, record: request.record, streaming: this.kind !== 'bluetooth', lzo: request.compressRaster });
      transport = this.transport;
      if (!transport) { transport = await this.transportFactory(); transient = true; }
      preflightPlan(plan, transport);
      if (request.signal?.aborted) return await finish({ outcome: 'cancelled-before-send', bytesSent, lastCompletedAction });
      if (transient) await abortable(transport.connect(), request.signal);
      for (let index = 0; index < plan.actions.length; index++) {
        if (request.signal?.aborted) return await finish({ outcome: potentiallyAccepted ? 'cancelled-partial' : 'cancelled-before-send', bytesSent, lastCompletedAction });
        const action = plan.actions[index];
        if (action.type === 'subscribe') {
          try { await abortable(transport.subscribe(action.channel, request.signal), request.signal); }
          catch (error) { if (isNotificationUnavailable(error)) notificationsAvailable = false; else throw error; }
        } else if (action.type === 'wait-response' && !notificationsAvailable) {
          if (action.fallbackDelayMs === undefined) throw new Error('Notifications are unavailable and this protocol has no safe fallback.');
          await monotonicDelay(action.fallbackDelayMs, request.signal);
        } else {
          await executeAction(action, transport, request.signal, async (chunk) => {
            potentiallyAccepted = true; await abortable(transport!.write(chunk, request.signal), request.signal); bytesSent += chunk.byteLength;
          });
        }
        lastCompletedAction = index; const progress = { action: index + 1, actions: plan.actions.length, bytesSent, totalBytes: plan.totalBytes, phase: action.type };
        request.onProgress?.(progress); if (persisted) void this.journal?.progress(persisted, progress);
      }
      return await finish({ outcome: 'completed', bytesSent, lastCompletedAction });
    } catch (error) {
      const aborted = request.signal?.aborted; const result: PrintResult = { outcome: potentiallyAccepted ? (aborted ? 'cancelled-partial' : 'outcome-unknown') : (aborted ? 'cancelled-before-send' : 'failed'), bytesSent, lastCompletedAction, error: error instanceof Error ? error.message : String(error) };
      return await finish(result);
    } finally { if (transient) try { await transport?.disconnect(); } catch { /* connection may already be gone */ } }
  }
  /** Runs the SDK's status-only plan and decodes the reply. Brother printers report media width, type, and errors. */
  async queryStatus(printer: PrinterDefinition, options?: { signal?: AbortSignal }): Promise<PrinterStatus> {
    if (!this.sdk.statusPlan || !this.sdk.parseStatus) throw new Error('The installed printer SDK cannot query printer status.');
    const plan = await this.sdk.statusPlan(printer);
    const transport = this.transport ?? await this.transportFactory();
    const transient = transport !== this.transport;
    try {
      preflightPlan(plan, transport);
      if (transient) await abortable(transport.connect(), options?.signal);
      const captured: Uint8Array[] = [];
      let notificationsAvailable = true;
      for (const action of plan.actions) {
        if (action.type === 'subscribe') {
          try { await abortable(transport.subscribe(action.channel, options?.signal), options?.signal); }
          catch (error) { if (isNotificationUnavailable(error)) notificationsAvailable = false; else throw error; }
          continue;
        }
        // One unanswered query must not hide the answers already collected.
        const tolerate = action.type === 'wait-response' && (!notificationsAvailable || action.fallbackDelayMs !== undefined);
        try {
          const response = await executeAction(action, transport, options?.signal, async (chunk) => { await abortable(transport.write(chunk, options?.signal), options?.signal); }, { requireResponse: true });
          if (response) captured.push(response);
        } catch (error) { if (!tolerate) throw error; }
      }
      if (!captured.length) throw new Error('The printer did not return a status reply.');
      return await this.sdk.parseStatus(printer, captured);
    } finally { if (transient) try { await transport.disconnect(); } catch { /* connection may already be gone */ } }
  }
}

export function preflightPlan(plan: ProtocolPlan, transport: DirectTransport) {
  const mtuPayload = transport.negotiatedAttMtu === undefined ? Infinity : transport.negotiatedAttMtu - 3;
  const cap = Math.min(transport.physicalWriteLimit ?? Infinity, mtuPayload);
  const commandCap = transport.commandWriteLimit ?? cap;
  if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('The transport has no safe, finite physical write cap.');
  if (!Number.isSafeInteger(commandCap) || commandCap <= 0) throw new Error('The transport has no safe, finite command write cap.');
  for (const [index, action] of plan.actions.entries()) {
    if (action.type !== 'write') continue;
    if (!Number.isSafeInteger(action.logicalChunkSize) || action.logicalChunkSize <= 0) throw new Error(`Action ${index} has an unsafe logical chunk size.`);
    if ((action.atomic || !action.chunkable) && action.data.length > Math.min(commandCap, action.logicalChunkSize)) throw new Error(`Atomic command ${index} (${action.data.length} bytes) exceeds the safe transport cap before connection.`);
  }
}
async function executeAction(action: ProtocolAction, transport: DirectTransport, signal: AbortSignal | undefined, write: (data: Uint8Array) => Promise<void>, options?: { requireResponse?: boolean }): Promise<Uint8Array | undefined> {
  if (action.type === 'delay') { await monotonicDelay(action.milliseconds, signal); return; }
  if (action.type === 'wait-response') { try { const response = await abortable(transport.waitResponse(action.channel, action.timeoutMs, action.validate, signal), signal); validateResponse(response, action.validate); return response; } catch(error) { if(!options?.requireResponse&&action.validate==='brother-status32'&&isOptionalBrotherResponse(error))return;throw error } }
  if (action.type !== 'write') return;
  const physicalLimit = Math.min(action.logicalChunkSize, transport.physicalWriteLimit!, transport.negotiatedAttMtu === undefined ? Infinity : transport.negotiatedAttMtu - 3);
  if (!action.chunkable) { await write(action.data); if (action.delayAfterMs) await monotonicDelay(action.delayAfterMs, signal); return; }
  // The pacing delay belongs to the protocol's logical chunk. Transports whose
  // physical write is smaller, notably BLE, must not multiply it by the number
  // of fragments they need to carry that chunk.
  for (let start = 0; start < action.data.length; start += action.logicalChunkSize) {
    const chunk = action.data.subarray(start, start + action.logicalChunkSize);
    for (let offset = 0; offset < chunk.length; offset += physicalLimit) { if (signal?.aborted) throw abortError(); await write(chunk.slice(offset, offset + physicalLimit)); }
    if (action.delayAfterMs) await monotonicDelay(action.delayAfterMs, signal);
  }
}
function validateResponse(response: Uint8Array, validation?: string) {
  if (!response.length) throw new Error('Printer returned an empty response.');
  if (validation === 'phomemo-notification' && (response.length < 3 || response[0] !== 0x1a)) throw new Error('Printer response failed Phomemo notification validation.');
  if (validation === 'brother-status32' && (response.length !== 32 || response[0] !== 0x80 || response[1] !== 0x20 || response[2] !== 0x42)) throw new Error('Printer response failed Brother status validation.');
}
const isNotificationUnavailable = (error: unknown) => error instanceof Error && ('code' in error ? (error as Error & { code?: string }).code === 'notification-unavailable' : /notification.*unavailable/i.test(error.message));
const isOptionalBrotherResponse = (error: unknown) => error instanceof Error && ('code' in error ? ['notification-unavailable','response-timeout'].includes((error as Error & { code?: string }).code??'') : /notification.*unavailable|response.*timed out/i.test(error.message));
const abortError = () => new DOMException('Print cancelled.', 'AbortError');
async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise; if (signal.aborted) throw abortError();
  return await Promise.race([promise, new Promise<T>((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }))]);
}
export const monotonicDelay = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const start = performance.now(); const poll = () => { if (signal?.aborted) { reject(abortError()); return; } const remaining = milliseconds - (performance.now() - start); if (remaining <= 0) resolve(); else setTimeout(poll, Math.min(remaining, 50)); }; poll();
});
