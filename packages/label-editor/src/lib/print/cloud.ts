// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuid, type LabelDocument } from '../model.js';
import { toSdkDocument } from '../sdk-document.js';
import type { PersistedJob } from '../persistence/database.js';
import type { JobJournal } from '../jobs.js';
import {
  CloudPrintSubmissionError,
  type CloudPrintClient,
  type CloudPrintJob,
  type CloudPrinter,
  type CloudPrintSubmission,
} from '../cloud-print/client.js';
import {
  validateContinuousPrintOptions,
  type PrintProgress,
  type PrintRequest,
  type PrintResult,
  type PrintRoute,
} from './types.js';
import { assertDocumentReadyForOutput } from '../continuous-media.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled-before-send', 'cancelled-partial', 'outcome-unknown']);
const OUTCOMES = new Set<PrintResult['outcome']>([
  'completed',
  'failed',
  'cancelled-before-send',
  'cancelled-partial',
  'outcome-unknown',
]);

export interface CloudJobDetails {
  kind: 'cloud-print';
  remoteJobId?: string;
  idempotencyKey: string;
  printerId: string;
  model: string;
  copies: number;
  density?: number;
  submission?: string;
  lastJob?: CloudPrintJob;
}

export class CloudPrintJobController {
  #current?: CloudPrintJob;
  #listeners = new Set<(job: CloudPrintJob | undefined) => void>();
  constructor(
    readonly client: CloudPrintClient,
    readonly pollIntervalMs = 1000,
  ) {}
  get current() {
    return this.#current;
  }
  subscribe(listener: (job: CloudPrintJob | undefined) => void) {
    this.#listeners.add(listener);
    listener(this.#current);
    return () => this.#listeners.delete(listener);
  }
  publish(job: CloudPrintJob | undefined) {
    this.#current = job;
    for (const listener of this.#listeners) listener(job);
  }
  async cancel(jobId: string, signal?: AbortSignal) {
    const job = await this.client.cancelJob(jobId, signal);
    this.publish(job);
    return isTerminal(job) ? job : await this.poll(jobId, signal);
  }
  async resume(jobId: string, signal?: AbortSignal, onProgress?: (job: CloudPrintJob) => void) {
    return await this.poll(jobId, signal, onProgress);
  }
  async poll(jobId: string, signal?: AbortSignal, onProgress?: (job: CloudPrintJob) => void): Promise<CloudPrintJob> {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const job = await this.client.getJob(jobId, signal);
      this.publish(job);
      onProgress?.(job);
      if (isTerminal(job)) return job;
      await abortableDelay(this.pollIntervalMs, signal);
    }
  }
}

export interface CloudPrintRouteOptions {
  client: CloudPrintClient;
  printer: () => CloudPrinter | undefined;
  journal: JobJournal;
  controller?: CloudPrintJobController;
}

export class CloudPrintRoute implements PrintRoute {
  readonly id = 'cloud-api';
  readonly label = 'MakersBrain cloud printer service';
  readonly controller: CloudPrintJobController;
  #active = false;
  get supportsNativeBatch() {
    return this.options.client.supportsNativeBatch;
  }
  constructor(private options: CloudPrintRouteOptions) {
    this.controller = options.controller ?? new CloudPrintJobController(options.client);
  }
  isSupported() {
    return typeof fetch === 'function';
  }

  async print(request: PrintRequest): Promise<PrintResult> {
    if (this.#active) return failed('Another cloud print job is already active in this editor.');
    this.#active = true;
    try {
      return await this.printOnce(request);
    } finally {
      this.#active = false;
    }
  }

  async printBatch(request: Parameters<NonNullable<PrintRoute['printBatch']>>[0]): Promise<PrintResult> {
    if (!this.supportsNativeBatch)
      return failed('The cloud print service has not negotiated native batch support. Update it and reconnect.');
    if (this.#active) return failed('Another cloud print job is already active in this editor.');
    this.#active = true;
    try {
      return await this.printBatchOnce(request);
    } finally {
      this.#active = false;
    }
  }

  private async printBatchOnce(request: Parameters<NonNullable<PrintRoute['printBatch']>>[0]): Promise<PrintResult> {
    if (!request.documents.length) return failed('Batch printing requires at least one document.');
    request.documents.forEach((document) => {
      assertDocumentReadyForOutput(document);
      validateContinuousPrintOptions(document, request.printer, request.continuous);
    });
    const printer = this.options.printer();
    if (!printer?.enabled) return failed('Select an enabled cloud printer.');
    if (printer.model !== request.printer.id)
      return failed(`Cloud printer ${printer.displayName} requires model ${printer.model}.`);
    const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? uuid();
    const submission: CloudPrintSubmission = {
      printerId: printer.id,
      source: 'mb-label-editor',
      request: {
        documents: request.documents.map(toSdkDocument),
        model: printer.model,
        copies: request.copies,
        ...(request.continuous ? { continuous: request.continuous } : {}),
      },
    };
    const serialized = this.options.client.serializeSubmission(submission);
    let persisted = await this.begin(request.documents[0], {
      kind: 'cloud-print',
      idempotencyKey,
      printerId: printer.id,
      model: printer.model,
      copies: request.copies,
      submission: serialized,
    });
    try {
      const submitted = await this.options.client.submitSerialized(serialized, idempotencyKey, request.signal);
      this.controller.publish(submitted);
      persisted = await this.save(persisted, submitted.state, true, {
        ...detailsOf(persisted),
        remoteJobId: submitted.id,
        submission: undefined,
        lastJob: submitted,
      });
      const terminal = isTerminal(submitted)
        ? submitted
        : await this.controller.poll(submitted.id, request.signal, (job) =>
            request.onProgress?.({
              item: job.item,
              items: job.items,
              copy: job.copy,
              copies: job.copies,
              current: progressOf(job),
            }),
          );
      await this.save(persisted, terminal.state, ambiguous(terminal), { ...detailsOf(persisted), lastJob: terminal });
      return resultOf(terminal);
    } catch (error) {
      const details = detailsOf(persisted);
      const uncertain = !!details.remoteJobId || (error instanceof CloudPrintSubmissionError && error.uncertain);
      await this.save(
        persisted,
        uncertain ? 'status-unknown' : 'failed',
        uncertain,
        uncertain ? details : { ...details, submission: undefined },
      );
      return uncertain
        ? {
            outcome: 'outcome-unknown',
            lastCompletedAction: details.lastJob?.lastCompletedAction ?? -1,
            bytesSent: details.lastJob?.bytesSent ?? 0,
            error: 'The cloud batch may still be queued or printing. Resume its status before printing again.',
          }
        : failed(error instanceof Error ? error.message : String(error));
    }
  }

  private async printOnce(request: PrintRequest): Promise<PrintResult> {
    if (request.continuous?.cutMode === 'after-job' && !this.supportsNativeBatch)
      return failed('Cut after job requires negotiated native batch support from the cloud print service.');
    assertDocumentReadyForOutput(request.document);
    validateContinuousPrintOptions(request.document, request.printer, request.continuous);
    const printer = this.options.printer();
    if (!printer?.enabled) return failed('Select an enabled cloud printer.');
    if (printer.model !== request.printer.id)
      return failed(`Cloud printer ${printer.displayName} requires model ${printer.model}.`);
    const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? uuid();
    const submission: CloudPrintSubmission = {
      printerId: printer.id,
      source: 'mb-label-editor',
      request: {
        document: toSdkDocument(request.document),
        model: printer.model,
        copies: request.copies,
        ...(request.density === undefined ? {} : { density: request.density }),
        ...(request.continuous ? { continuous: request.continuous } : {}),
      },
    };
    const serialized = this.options.client.serializeSubmission(submission);
    let persisted = await this.begin(request.document, {
      kind: 'cloud-print',
      idempotencyKey,
      printerId: printer.id,
      model: printer.model,
      copies: request.copies,
      density: request.density,
      submission: serialized,
    });
    try {
      const submitted = await this.options.client.submitSerialized(serialized, idempotencyKey, request.signal);
      this.controller.publish(submitted);
      persisted = await this.save(persisted, submitted.state, true, {
        ...detailsOf(persisted),
        remoteJobId: submitted.id,
        submission: undefined,
        lastJob: submitted,
      });
      const terminal = isTerminal(submitted)
        ? submitted
        : await this.controller.poll(submitted.id, request.signal, (job) => {
            request.onProgress?.(progressOf(job));
          });
      await this.save(persisted, terminal.state, ambiguous(terminal), { ...detailsOf(persisted), lastJob: terminal });
      return resultOf(terminal);
    } catch (error) {
      const details = detailsOf(persisted);
      const uncertain = !!details.remoteJobId || (error instanceof CloudPrintSubmissionError && error.uncertain);
      await this.save(
        persisted,
        uncertain ? 'status-unknown' : 'failed',
        uncertain,
        uncertain ? details : { ...details, submission: undefined },
      );
      return uncertain
        ? {
            outcome: 'outcome-unknown',
            lastCompletedAction: details.lastJob?.lastCompletedAction ?? -1,
            bytesSent: details.lastJob?.bytesSent ?? 0,
            error: 'The cloud job may still be queued or printing. Resume its status before printing again.',
          }
        : failed(error instanceof Error ? error.message : String(error));
    }
  }

  async recover(job: PersistedJob, signal?: AbortSignal): Promise<PrintResult> {
    let details = detailsOf(job);
    try {
      let remote: CloudPrintJob;
      if (details.remoteJobId) remote = await this.controller.resume(details.remoteJobId, signal);
      else if (details.submission) {
        remote = await this.options.client.submitSerialized(details.submission, details.idempotencyKey, signal);
        details = { ...details, remoteJobId: remote.id, submission: undefined, lastJob: remote };
        job = await this.save(job, remote.state, true, details);
        if (!isTerminal(remote)) remote = await this.controller.resume(remote.id, signal);
      } else throw new Error('The exact cloud submission snapshot is unavailable.');
      await this.save(job, remote.state, ambiguous(remote), { ...details, lastJob: remote });
      return resultOf(remote);
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
  }

  private async begin(document: LabelDocument, details: CloudJobDetails) {
    return await this.options.journal.save({
      id: uuid(),
      documentId: document.id,
      createdAt: new Date().toISOString(),
      state: 'submitting',
      route: this.id,
      resumable: true,
      details,
    });
  }
  private async save(job: PersistedJob, state: string, resumable: boolean, details: CloudJobDetails) {
    return await this.options.journal.save({ ...job, state, resumable, details });
  }
}

export function isCloudJobDetails(value: unknown): value is CloudJobDetails {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'cloud-print';
}
const detailsOf = (job: PersistedJob): CloudJobDetails => {
  if (!isCloudJobDetails(job.details)) throw new Error('Invalid cloud job recovery details.');
  return job.details;
};
const isTerminal = (job: CloudPrintJob) => TERMINAL.has(job.terminalOutcome ?? job.state);
const ambiguous = (job: CloudPrintJob) =>
  ['cancelled-partial', 'outcome-unknown'].includes(job.terminalOutcome ?? job.state);
const progressOf = (job: CloudPrintJob): PrintProgress => ({
  action: Math.max(0, job.lastCompletedAction + 1),
  actions: job.actionCount,
  bytesSent: job.bytesSent,
  totalBytes: job.totalBytes,
  phase: job.action ?? job.state,
});
const resultOf = (job: CloudPrintJob): PrintResult => {
  const value = job.terminalOutcome ?? job.state;
  const outcome = OUTCOMES.has(value as PrintResult['outcome']) ? (value as PrintResult['outcome']) : 'failed';
  return {
    outcome,
    lastCompletedAction: job.lastCompletedAction,
    bytesSent: job.bytesSent,
    ...(job.errorCode ? { error: job.errorCode } : {}),
  };
};
const failed = (error: string): PrintResult => ({ outcome: 'failed', lastCompletedAction: -1, bytesSent: 0, error });
const abortableDelay = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', aborted, { once: true });
  });
