// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintProgress, PrintRequest, PrintResult, PrintRoute } from './types.js';
import { toSdkDocument } from '../sdk-document.js';
import type { JobJournal } from '../jobs.js';

export type LocalApiTransport = { kind: 'file'; path: string } | { kind: 'tcp'; address: string } | { kind: 'serial' | 'rfcomm'; path: string; baud?: number };
export interface LocalApiConnection { id: string; model: string; transport: LocalApiTransport; status: string; media?: unknown }
export interface LocalApiOptions { baseUrl?: string; token: () => string | undefined; origin?: string; connection?: () => LocalApiConnection | undefined; journal?: JobJournal }
export interface LocalApiJob {
  id: string; state: string; terminal: boolean; outcome?: PrintResult['outcome'] | null;
  lastCompletedAction: number; bytesSent: number; action: number; actions: number;
  totalBytes: number; phase: string; error?: string | null;
}

export class LocalApiPrintRoute implements PrintRoute {
  readonly id = 'local-api';
  readonly label = 'MakersBrain local printer service';
  private baseUrl: string;

  constructor(private options: LocalApiOptions) { this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:9847/v1'; }
  isSupported() { return typeof fetch === 'function'; }

  async pair(secret: string) {
    const response = await fetch(`${this.baseUrl}/pair`, { method: 'POST', headers: this.headers(true), body: JSON.stringify({ secret }) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as { grantId: string; token: string; expiresAt: string };
  }

  async validate(document: PrintRequest['document']) {
    const response = await fetch(`${this.baseUrl}/documents/validate`, { method: 'POST', headers: this.headers(true, true), body: JSON.stringify(toSdkDocument(document)) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as { valid: boolean; errors: string[] };
  }

  async connections(): Promise<LocalApiConnection[]> {
    const response = await fetch(`${this.baseUrl}/status`, { headers: this.headers(false, true) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    const body = await response.json() as { connections?: LocalApiConnection[] };
    return body.connections ?? [];
  }

  async configureConnection(connection: Pick<LocalApiConnection, 'id' | 'model' | 'transport'>): Promise<LocalApiConnection> {
    const response = await fetch(`${this.baseUrl}/connection`, { method: 'POST', headers: this.headers(true, true), body: JSON.stringify(connection) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiConnection;
  }

  async submit(request: PrintRequest): Promise<LocalApiJob> {
    const connection = this.options.connection?.();
    if (!connection) throw new Error('Select a persisted, probed local-service printer connection before printing. Capture is never a printing destination.');
    if (connection.status !== 'ready' || !['file', 'tcp', 'serial', 'rfcomm'].includes(connection.transport.kind)) throw new Error('The selected local-service connection is not a ready physical transport.');
    const response = await fetch(`${this.baseUrl}/jobs`, {
      method: 'POST', signal: request.signal, headers: this.headers(true, true),
      body: JSON.stringify({ document: toSdkDocument(request.document), printerId: request.printer.id, connectionId: connection.id, copies: request.copies, ...(request.density === undefined ? {} : { density: request.density }) })
    });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiJob;
  }

  async job(id: string): Promise<LocalApiJob> {
    const response = await fetch(`${this.baseUrl}/jobs/${encodeURIComponent(id)}`, { headers: this.headers(false, true) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiJob;
  }

  async cancel(id: string) {
    const response = await fetch(`${this.baseUrl}/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: this.headers(false, true) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return normalizeJob(await response.json() as LocalApiJob);
  }

  async events(id: string, onProgress: (progress: PrintProgress) => void, signal?: AbortSignal) {
    const response = await fetch(`${this.baseUrl}/jobs/${encodeURIComponent(id)}/events`, { signal, headers: { ...this.headers(false, true), accept: 'text/event-stream' } });
    if (!response.ok) throw new Error(await actionableResponse(response));
    if (!response.body) throw new Error('The local service returned no event stream.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = ''; let terminal: PrintResult | undefined;
    for (;;) {
      const { done, value } = await reader.read(); buffered += decoder.decode(value, { stream: !done }); const blocks = buffered.split(/\r?\n\r?\n/); buffered = blocks.pop() ?? '';
      for (const block of blocks) {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'); if (!data) continue;
        const job = JSON.parse(data) as LocalApiJob; onProgress(progressOf(job)); if (job.terminal) terminal = normalizeJob(job);
      }
      if (done) break; if (terminal) { await reader.cancel(); break; }
    }
    return terminal;
  }

  async print(request: PrintRequest): Promise<PrintResult> {
    if (!this.options.token()) return { outcome: 'failed', bytesSent: 0, lastCompletedAction: -1, error: 'Pair with the local printer service first.' };
    try {
      const submitted = await this.submit(request);
      const persisted = await this.options.journal?.begin(request.document, this.id, submitted.id);
      for (;;) {
        const job = await this.job(submitted.id); const progress = progressOf(job); request.onProgress?.(progress); if (persisted) await this.options.journal?.progress(persisted, progress); if (job.terminal) { const result = normalizeJob(job); if (persisted) await this.options.journal?.finish(persisted, result); return result; }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (error) {
      return { outcome: request.signal?.aborted ? 'outcome-unknown' : 'failed', bytesSent: 0, lastCompletedAction: -1, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private headers(json: boolean, authenticated = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers['content-type'] = 'application/json';
    if (this.options.origin) headers.origin = this.options.origin;
    if (authenticated) headers.authorization = `Bearer ${this.requireToken()}`;
    return headers;
  }
  private requireToken() { const token = this.options.token(); if (!token) throw new Error('Pair with the local printer service first.'); return token; }
}

const progressOf = (job: LocalApiJob): PrintProgress => ({ action: job.action, actions: job.actions, bytesSent: job.bytesSent, totalBytes: job.totalBytes, phase: job.phase });
const normalizeJob = (job: LocalApiJob): PrintResult => ({ outcome: job.outcome ?? (job.terminal ? 'failed' : 'outcome-unknown'), lastCompletedAction: job.lastCompletedAction, bytesSent: job.bytesSent, error: job.error ?? undefined });
async function actionableResponse(response: Response) { if (response.status === 401) return 'Pairing expired or was revoked. Pair with the local service again.'; if (response.status === 403) return 'The local service denied this origin.'; if (response.status === 413) return 'The document or job is too large for the local service.'; return `${response.status} ${response.statusText}: ${await response.text()}`; }
