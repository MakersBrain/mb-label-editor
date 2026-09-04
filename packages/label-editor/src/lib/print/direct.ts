// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  validateContinuousPrintOptions,
  type PrinterDefinition,
  type PrinterSdk,
  type PrinterStatus,
  type PrintRequest,
  type PrintResult,
  type PrintRoute,
  type ProtocolExecutionProgress,
  type ProtocolExecutionTransport,
  type ProtocolPlan,
} from './types.js';
import type { JobJournal } from '../jobs.js';
import { assertDocumentReadyForOutput } from '../continuous-media.js';
import { toSdkDocument } from '../sdk-document.js';

export interface DirectTransport {
  readonly kind: 'bluetooth' | 'usb' | 'serial';
  readonly physicalWriteLimit?: number;
  readonly commandWriteLimit?: number;
  readonly negotiatedAttMtu?: number;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array, signal?: AbortSignal): Promise<void>;
  subscribe(channel: string, signal?: AbortSignal): Promise<void>;
  waitResponse(channel: string, timeoutMs: number, validation?: string, signal?: AbortSignal): Promise<Uint8Array>;
}
export class DirectPrintRoute implements PrintRoute {
  readonly supportsNativeBatch = true;
  readonly id: string;
  readonly label: string;
  private retryProhibited = false;
  private transport?: DirectTransport;
  constructor(
    private sdk: PrinterSdk,
    private transportFactory: () => Promise<DirectTransport>,
    private kind: 'bluetooth' | 'usb' | 'serial',
    private supported: () => boolean = () => true,
    private journal?: JobJournal,
  ) {
    this.id = `web-${kind}`;
    this.label = kind === 'serial' ? 'Bluetooth SPP (Web Serial)' : `Web ${kind === 'bluetooth' ? 'Bluetooth' : 'USB'}`;
  }
  get connected() {
    return this.transport !== undefined;
  }
  isSupported() {
    return globalThis.isSecureContext === true && this.supported();
  }
  async connect(options?: { signal?: AbortSignal }) {
    if (this.transport) return;
    const candidate = await this.transportFactory();
    try {
      await abortable(candidate.connect(), options?.signal);
      this.transport = candidate;
    } catch (error) {
      try {
        await candidate.disconnect();
      } catch {
        /* connection never became usable */
      }
      throw error;
    }
  }
  async disconnect() {
    const transport = this.transport;
    this.transport = undefined;
    if (transport) await transport.disconnect();
  }
  async print(request: PrintRequest): Promise<PrintResult> {
    assertDocumentReadyForOutput(request.document);
    validateContinuousPrintOptions(request.document, request.printer, request.continuous);
    if (this.retryProhibited)
      return {
        outcome: 'failed',
        bytesSent: 0,
        lastCompletedAction: -1,
        error:
          'Automatic retry is prohibited after an ambiguous direct-print outcome. Inspect the printer and start a new explicit job.',
      };
    const persisted = await this.journal?.begin(request.document, this.id, undefined, {
      kind: 'direct-print',
      request: {
        document: toSdkDocument(request.document),
        printerId: request.printer.id,
        copies: request.copies,
        density: request.density,
        continuous: request.continuous,
      },
    });
    let transport: DirectTransport | undefined;
    let transient = false;
    let bytesSent = 0;
    let lastCompletedAction = -1;
    let potentiallyAccepted = false;
    const finish = async (result: PrintResult) => {
      if (persisted) await this.journal?.finish(persisted, result);
      if (result.outcome === 'outcome-unknown' || result.outcome === 'cancelled-partial') this.retryProhibited = true;
      return result;
    };
    try {
      // Only GATT needs reference pacing; a serial port or a bulk endpoint
      // streams the job the way the vendor drivers do.
      const plan = await this.sdk.plan(request.document, request.printer, {
        copies: request.copies,
        density: request.density,
        record: request.record,
        streaming: this.kind !== 'bluetooth',
        lzo: request.compressRaster,
        continuous: request.continuous,
      });
      if (!this.sdk.executePlan) throw new Error('The installed printer SDK cannot execute browser print plans.');
      transport = this.transport;
      if (!transport) {
        transport = await this.transportFactory();
        transient = true;
      }
      preflightPlan(plan, transport);
      if (request.signal?.aborted)
        return await finish({ outcome: 'cancelled-before-send', bytesSent, lastCompletedAction });
      if (transient) await abortable(transport.connect(), request.signal);
      const executionTransport = adaptTransport(transport, plan);
      const report = (state: ProtocolExecutionProgress) => {
        bytesSent = state.bytesWritten;
        lastCompletedAction = state.lastCompletedAction;
        potentiallyAccepted = state.potentiallyAcceptedWrite;
        const action = plan.actions[state.lastCompletedAction];
        const progress = {
          action: state.lastCompletedAction + 1,
          actions: plan.actions.length,
          bytesSent,
          totalBytes: plan.totalBytes,
          phase: action?.type ?? 'unknown',
        };
        request.onProgress?.(progress);
        if (persisted) void this.journal?.progress(persisted, progress);
      };
      const execution = await this.sdk.executePlan(plan, executionTransport, report, request.signal);
      bytesSent = execution.bytesWritten;
      lastCompletedAction = execution.lastCompletedAction;
      potentiallyAccepted = execution.potentiallyAcceptedWrite;
      const outcome =
        execution.status === 'outcome-unknown' && request.signal?.aborted
          ? 'cancelled-partial'
          : execution.status === 'cancelled-before-send' && execution.error && !request.signal?.aborted
            ? 'failed'
            : execution.status;
      return await finish({
        outcome,
        bytesSent,
        lastCompletedAction,
        ...(execution.error ? { error: execution.error } : {}),
      });
    } catch (error) {
      const aborted = request.signal?.aborted;
      const result: PrintResult = {
        outcome: potentiallyAccepted
          ? aborted
            ? 'cancelled-partial'
            : 'outcome-unknown'
          : aborted
            ? 'cancelled-before-send'
            : 'failed',
        bytesSent,
        lastCompletedAction,
        error: error instanceof Error ? error.message : String(error),
      };
      return await finish(result);
    } finally {
      if (transient)
        try {
          await transport?.disconnect();
        } catch {
          /* connection may already be gone */
        }
    }
  }
  async printBatch(request: Parameters<NonNullable<PrintRoute['printBatch']>>[0]): Promise<PrintResult> {
    if (!request.documents.length)
      return {
        outcome: 'failed',
        bytesSent: 0,
        lastCompletedAction: -1,
        error: 'Batch printing requires at least one document.',
      };
    request.documents.forEach((document) => {
      assertDocumentReadyForOutput(document);
      validateContinuousPrintOptions(document, request.printer, request.continuous);
    });
    if (!this.sdk.planBatch)
      return {
        outcome: 'failed',
        bytesSent: 0,
        lastCompletedAction: -1,
        error: 'The installed printer SDK does not support native batch jobs.',
      };
    if (this.retryProhibited)
      return {
        outcome: 'failed',
        bytesSent: 0,
        lastCompletedAction: -1,
        error:
          'Automatic retry is prohibited after an ambiguous direct-print outcome. Inspect the printer and start a new explicit job.',
      };
    const persisted = await this.journal?.begin(request.documents[0], this.id, undefined, {
      kind: 'direct-print-batch',
      request: {
        documents: request.documents.map(toSdkDocument),
        printerId: request.printer.id,
        copies: request.copies,
        continuous: request.continuous,
      },
    });
    let transport: DirectTransport | undefined;
    let transient = false;
    let bytesSent = 0;
    let lastCompletedAction = -1;
    let potentiallyAccepted = false;
    const finish = async (result: PrintResult) => {
      if (persisted) await this.journal?.finish(persisted, result);
      if (result.outcome === 'outcome-unknown' || result.outcome === 'cancelled-partial') this.retryProhibited = true;
      return result;
    };
    try {
      const plan = await this.sdk.planBatch(request.documents, request.printer, {
        copies: request.copies,
        streaming: this.kind !== 'bluetooth',
        continuous: request.continuous,
      });
      if (!this.sdk.executePlan) throw new Error('The installed printer SDK cannot execute browser print plans.');
      transport = this.transport;
      if (!transport) {
        transport = await this.transportFactory();
        transient = true;
      }
      preflightPlan(plan, transport);
      if (request.signal?.aborted)
        return await finish({ outcome: 'cancelled-before-send', bytesSent, lastCompletedAction });
      if (transient) await abortable(transport.connect(), request.signal);
      const report = (state: ProtocolExecutionProgress) => {
        bytesSent = state.bytesWritten;
        lastCompletedAction = state.lastCompletedAction;
        potentiallyAccepted = state.potentiallyAcceptedWrite;
        const action = plan.actions[state.lastCompletedAction];
        const current = {
          action: state.lastCompletedAction + 1,
          actions: plan.actions.length,
          bytesSent,
          totalBytes: plan.totalBytes,
          phase: action?.type ?? 'unknown',
        };
        const startedPages = (plan.sdkActions ?? [])
          .slice(0, state.lastCompletedAction + 1)
          .filter((item) => item.action === 'command-write' && item.name === 'ESC i z print information').length;
        const page = Math.max(0, startedPages - 1);
        const copies = Math.max(1, request.copies);
        const item = Math.min(request.documents.length - 1, Math.floor(page / copies));
        const copy = page % copies;
        request.onProgress?.({ item, items: request.documents.length, copy, copies: request.copies, current });
        if (persisted) void this.journal?.progress(persisted, current);
      };
      const execution = await this.sdk.executePlan(plan, adaptTransport(transport, plan), report, request.signal);
      bytesSent = execution.bytesWritten;
      lastCompletedAction = execution.lastCompletedAction;
      potentiallyAccepted = execution.potentiallyAcceptedWrite;
      const outcome =
        execution.status === 'outcome-unknown' && request.signal?.aborted
          ? 'cancelled-partial'
          : execution.status === 'cancelled-before-send' && execution.error && !request.signal?.aborted
            ? 'failed'
            : execution.status;
      return await finish({
        outcome,
        bytesSent,
        lastCompletedAction,
        ...(execution.error ? { error: execution.error } : {}),
      });
    } catch (error) {
      const aborted = request.signal?.aborted;
      return await finish({
        outcome: potentiallyAccepted
          ? aborted
            ? 'cancelled-partial'
            : 'outcome-unknown'
          : aborted
            ? 'cancelled-before-send'
            : 'failed',
        bytesSent,
        lastCompletedAction,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (transient)
        try {
          await transport?.disconnect();
        } catch {
          /* connection may already be gone */
        }
    }
  }
  /** Runs the SDK's status-only plan and decodes the reply. Brother printers report media width, type, and errors. */
  async queryStatus(printer: PrinterDefinition, options?: { signal?: AbortSignal }): Promise<PrinterStatus> {
    if (!this.sdk.statusPlan || !this.sdk.parseStatus)
      throw new Error('The installed printer SDK cannot query printer status.');
    if (!this.sdk.executePlan) throw new Error('The installed printer SDK cannot execute browser status plans.');
    const plan = await this.sdk.statusPlan(printer);
    const transport = this.transport ?? (await this.transportFactory());
    const transient = transport !== this.transport;
    try {
      preflightPlan(plan, transport);
      if (transient) await abortable(transport.connect(), options?.signal);
      const captured: Uint8Array[] = [];
      const result = await this.sdk.executePlan(
        plan,
        adaptTransport(transport, plan, captured),
        undefined,
        options?.signal,
      );
      if (result.status !== 'completed') throw new Error(result.error ?? `Printer status query ${result.status}.`);
      if (!captured.length) throw new Error('The printer did not return a status reply.');
      return await this.sdk.parseStatus(printer, captured);
    } finally {
      if (transient)
        try {
          await transport.disconnect();
        } catch {
          /* connection may already be gone */
        }
    }
  }
}

export function preflightPlan(plan: ProtocolPlan, transport: DirectTransport) {
  const mtuPayload = transport.negotiatedAttMtu === undefined ? Infinity : transport.negotiatedAttMtu - 3;
  const cap = Math.min(transport.physicalWriteLimit ?? Infinity, mtuPayload);
  const commandCap = transport.commandWriteLimit ?? cap;
  if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('The transport has no safe, finite physical write cap.');
  if (!Number.isSafeInteger(commandCap) || commandCap <= 0)
    throw new Error('The transport has no safe, finite command write cap.');
  for (const [index, action] of plan.actions.entries()) {
    if (action.type !== 'write') continue;
    if (!Number.isSafeInteger(action.logicalChunkSize) || action.logicalChunkSize <= 0)
      throw new Error(`Action ${index} has an unsafe logical chunk size.`);
    if ((action.atomic || !action.chunkable) && action.data.length > Math.min(commandCap, action.logicalChunkSize))
      throw new Error(
        `Atomic command ${index} (${action.data.length} bytes) exceeds the safe transport cap before connection.`,
      );
  }
}
const isNotificationUnavailable = (error: unknown) =>
  error instanceof Error &&
  ('code' in error
    ? (error as Error & { code?: string }).code === 'notification-unavailable'
    : /notification.*unavailable/i.test(error.message));
const isResponseTimeout = (error: unknown) =>
  error instanceof Error &&
  ('code' in error
    ? (error as Error & { code?: string }).code === 'response-timeout'
    : /response.*timed out|no (status|notification)/i.test(error.message));
function adaptTransport(
  transport: DirectTransport,
  plan: ProtocolPlan,
  captured?: Uint8Array[],
): ProtocolExecutionTransport {
  const payloadLimit = Math.min(
    transport.physicalWriteLimit ?? Infinity,
    transport.negotiatedAttMtu === undefined ? Infinity : transport.negotiatedAttMtu - 3,
  );
  const validations = plan.actions.flatMap((action) => (action.type === 'wait-response' ? [action.validate] : []));
  return {
    payloadLimit,
    commandPayloadLimit: transport.commandWriteLimit ?? payloadLimit,
    async subscribeNotifications(signal) {
      try {
        await transport.subscribe('printer', signal);
        return true;
      } catch (error) {
        if (isNotificationUnavailable(error)) return false;
        throw error;
      }
    },
    write: (bytes, signal) => transport.write(bytes, signal),
    async waitForResponse(timeoutMs, signal) {
      try {
        const bytes = await transport.waitResponse('printer', timeoutMs, validations.shift(), signal);
        captured?.push(bytes);
        return { kind: 'response', bytes };
      } catch (error) {
        if (isNotificationUnavailable(error)) return { kind: 'unavailable' };
        if (isResponseTimeout(error)) return { kind: 'timeout' };
        throw error;
      }
    },
  };
}
const abortError = () => new DOMException('Print cancelled.', 'AbortError');
async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true })),
  ]);
}
