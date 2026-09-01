// SPDX-License-Identifier: AGPL-3.0-or-later
import { validateContinuousPrintOptions, type PrintProgress, type PrintRequest, type PrintResult, type PrintRoute } from './types.js';
import { toSdkDocument } from '../sdk-document.js';
import type { JobJournal } from '../jobs.js';
import type { PersistedJob } from '../persistence/database.js';
import { assertDocumentReadyForOutput } from '../continuous-media.js';

export type LocalApiTransport = { kind: 'file'; path: string } | { kind: 'tcp'; address: string } | { kind: 'serial' | 'rfcomm'; path: string; baud?: number } | { kind: 'ipp'; uri: string; certificatePem?: string };
export type LocalApiPrinterOperation = 'status' | 'system-report' | 'wifi-status' | 'wifi-scan' | 'wifi-configure' | 'ipp-status';
export interface LocalApiConnection { id: string; model: string; transport: LocalApiTransport; status: string; media?: unknown; operations?: LocalApiPrinterOperation[] }
export interface LocalApiConnectionStatus { connection: LocalApiConnection; connected: boolean; status: string; media?: unknown }
export interface LocalApiDiscoveryCandidate {
  transport: string;
  address: string;
  name?: string | null;
  vendor_id?: number;
  product_id?: number;
  serial_number?: string;
  ieee1284_device_id?: string;
  matchedModel?: string | null;
  operations?: LocalApiPrinterOperation[];
}
export interface LocalApiDiscoveryResponse { devices: LocalApiDiscoveryCandidate[]; supportedTransports: string[] }
export interface LocalApiCapabilities { service:string;version:string;api:string;features:string[] }
export interface BrotherWifiStatus {
  connected: boolean;
  ipAddress?: string | null;
  ssid?: string | null;
  encryption?: string | null;
  authentication?: string | null;
  infrastructure?: boolean | null;
  wirelessDirect?: boolean | null;
}
export interface LocalApiBrotherWifiStatus { connectionId: string; status: BrotherWifiStatus }
export interface BrotherWifiAccessPoint { ssid: string; channel?: number | null; power?: number | null; encrypted: boolean; enterprise: boolean }
export interface LocalApiBrotherWifiScan { connectionId: string; accessPoints: BrotherWifiAccessPoint[] }
export interface LocalApiBrotherReport { connectionId: string; redacted: true; sections: Record<string, Record<string, string>> }
/** Credentials are intentionally supplied by the caller and never retained by this route. */
export interface BrotherWifiConfigureRequest {
  ssid: string;
  password: string;
  encryption: string;
  authentication: string;
  infrastructure: boolean;
  wirelessDirect: boolean;
  reboot: boolean;
}
export interface BrotherWifiConfigureSummary {
  connection: string;
  device: string;
  ssid: string;
  encryption: string;
  authentication: string;
  infrastructure: boolean;
  wirelessDirect: boolean;
  reboot: boolean;
}
export interface LocalApiBrotherWifiConfigurePreparation {
  approvalId: string;
  /** Unix seconds, as returned by the loopback API. */
  expiresAt: number;
  recovery: string;
  summary: BrotherWifiConfigureSummary;
}
export interface LocalApiBrotherWifiConfigureResult {
  connection: string;
  device: string;
  applied: boolean;
  reboot: boolean;
}
/** A short-lived, in-memory-only grant for administrator operations. */
export interface LocalApiAdminGrant { token: string; expiresAt: string }
export interface LocalApiOptions { baseUrl?: string; token: () => string | undefined; origin?: string; connection?: () => LocalApiConnection | undefined; journal?: JobJournal }
export interface LocalApiJob {
  id: string; state: string; terminal: boolean; outcome?: PrintResult['outcome'] | null;
  lastCompletedAction: number; bytesSent: number; action: number; actions: number;
  totalBytes: number; phase: string; error?: string | null;
  item?:number;items?:number;copy?:number;copies?:number;
}
export interface LocalApiJobDetails {
  kind: 'local-api-print';
  idempotencyKey: string;
  requestBody?: string;
  remoteJobId?: string;
  lastJob?: LocalApiJob;
}

export class LocalApiPrintRoute implements PrintRoute {
  readonly id = 'local-api';
  readonly label = 'MakersBrain local printer service';
  supportsNativeBatch = false;
  private baseUrl: string;

  constructor(private options: LocalApiOptions) { this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:9847/v1'; }
  isSupported() { return typeof fetch === 'function'; }

  private request(path: string, init: RequestInit = {}) {
    return fetch(`${this.baseUrl}${path}`, { ...init, cache: 'no-store' });
  }

  async pair(secret: string) {
    const response = await this.request('/pair', { method: 'POST', headers: this.headers(true), body: JSON.stringify({ secret }) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as { grantId: string; token: string; expiresAt: string };
  }

  /**
   * Exchanges an administrator pairing secret.  The resulting token must stay
   * in component/session memory; it is intentionally not part of LocalApiOptions.
   */
  async pairAdmin(secret: string): Promise<LocalApiAdminGrant> {
    const response = await this.request('/admin/pair', { method: 'POST', headers: this.headers(true), body: JSON.stringify({ secret }) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiAdminGrant;
  }

  async negotiateCapabilities():Promise<LocalApiCapabilities>{
    const response=await this.request('/capabilities',{headers:this.headers(false,true)});if(!response.ok)throw new Error(await actionableResponse(response));
    const capabilities=await response.json() as LocalApiCapabilities;this.supportsNativeBatch=capabilities.features.includes('native-document-batch')&&capabilities.features.includes('continuous-options');return capabilities;
  }
  async validate(document: PrintRequest['document']) {
    const response = await this.request('/documents/validate', { method: 'POST', headers: this.headers(true, true), body: JSON.stringify(toSdkDocument(document)) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as { valid: boolean; errors: string[] };
  }

  async connections(): Promise<LocalApiConnection[]> {
    const response = await this.request('/status', { headers: this.headers(false, true) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    const body = await response.json() as { connections?: LocalApiConnection[] };
    return body.connections ?? [];
  }

  async configureConnection(connection: Pick<LocalApiConnection, 'id' | 'model' | 'transport'>): Promise<LocalApiConnection> {
    const response = await this.request('/connection', { method: 'POST', headers: this.headers(true, true), body: JSON.stringify(connection) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiConnection;
  }

  async connectionStatus(id: string): Promise<LocalApiConnectionStatus> {
    const response = await this.request(`/status?connection=${encodeURIComponent(id)}`, { headers: this.headers(false, true) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiConnectionStatus;
  }

  async discover(): Promise<LocalApiDiscoveryResponse> {
    const response = await this.request('/discovery', { method: 'POST', headers: this.headers(false, true) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiDiscoveryResponse;
  }

  async brotherWifiStatus(connectionId: string): Promise<LocalApiBrotherWifiStatus> {
    const id = encodeURIComponent(connectionId);
    const response = await this.request(`/printers/${id}/brother/wifi/status`, { headers: this.headers(false, true) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiBrotherWifiStatus;
  }

  async brotherWifiScan(connectionId: string): Promise<LocalApiBrotherWifiScan> {
    const id = encodeURIComponent(connectionId);
    const response = await this.request(`/printers/${id}/brother/wifi/scan`, { method: 'POST', headers: this.headers(false, true) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiBrotherWifiScan;
  }

  async brotherReport(connectionId: string): Promise<LocalApiBrotherReport> {
    const id = encodeURIComponent(connectionId);
    const response = await this.request(`/printers/${id}/brother/report`, { headers: this.headers(false, true) });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiBrotherReport;
  }

  /**
   * Creates a short-lived review record. `adminToken` is deliberately an
   * argument: callers must keep it in component/session memory, never in the
   * persisted print-route token or browser storage.
   */
  async prepareBrotherWifiConfigure(connectionId: string, request: BrotherWifiConfigureRequest, adminToken: string): Promise<LocalApiBrotherWifiConfigurePreparation> {
    const id = encodeURIComponent(connectionId);
    const response = await this.request(`/printers/${id}/brother/wifi/prepare`, {
      method: 'POST', headers: this.adminHeaders(adminToken), body: JSON.stringify(request)
    });
    if (!response.ok) throw new Error(await actionableResponse(response));
    const wire = await response.json() as Omit<LocalApiBrotherWifiConfigurePreparation, 'summary'> & BrotherWifiConfigureSummary;
    const { connection, device, ssid, encryption, authentication, infrastructure, wirelessDirect, reboot, ...preparation } = wire;
    return {
      ...preparation,
      summary: { connection, device, ssid, encryption, authentication, infrastructure, wirelessDirect, reboot }
    };
  }

  /** Applies exactly the settings which were reviewed by the administrator. */
  async configureBrotherWifi(connectionId: string, approvalId: string, request: BrotherWifiConfigureRequest, adminToken: string): Promise<LocalApiBrotherWifiConfigureResult> {
    const id = encodeURIComponent(connectionId);
    const response = await this.request(`/printers/${id}/brother/wifi/configure`, {
      method: 'POST', headers: this.adminHeaders(adminToken), body: JSON.stringify({ approvalId, ...request })
    });
    if (!response.ok) throw new Error(await actionableResponse(response));
    return await response.json() as LocalApiBrotherWifiConfigureResult;
  }

  private prepare(request: PrintRequest) {
    assertDocumentReadyForOutput(request.document);
    validateContinuousPrintOptions(request.document,request.printer,request.continuous);
    const connection = this.options.connection?.();
    if (!connection) throw new Error('Select a persisted, probed local-service printer connection before printing. Capture is never a printing destination.');
    if (['unavailable', 'error'].includes(connection.status) || !['file', 'tcp', 'serial', 'rfcomm', 'ipp'].includes(connection.transport.kind)) throw new Error('The selected local-service connection is not a ready physical transport.');
    const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? `mb-editor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const requestBody = JSON.stringify({ document: toSdkDocument(request.document), printerId: request.printer.id, connectionId: connection.id, copies: request.copies, ...(request.density === undefined ? {} : { density: request.density }), ...(request.continuous ? { continuous: request.continuous } : {}) });
    return { idempotencyKey, requestBody };
  }

  private prepareBatch(request: Parameters<NonNullable<PrintRoute['printBatch']>>[0]) {
    if(!request.documents.length)throw new Error('Batch printing requires at least one document.');
    request.documents.forEach(document=>{assertDocumentReadyForOutput(document);validateContinuousPrintOptions(document,request.printer,request.continuous)});
    const connection=this.options.connection?.();
    if(!connection)throw new Error('Select a persisted, probed local-service printer connection before printing. Capture is never a printing destination.');
    if(['unavailable','error'].includes(connection.status)||!['file','tcp','serial','rfcomm','ipp'].includes(connection.transport.kind))throw new Error('The selected local-service connection is not a ready physical transport.');
    const idempotencyKey=globalThis.crypto?.randomUUID?.()??`mb-editor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const requestBody=JSON.stringify({documents:request.documents.map(toSdkDocument),printerId:request.printer.id,connectionId:connection.id,copies:request.copies,...(request.continuous?{continuous:request.continuous}:{})});
    return{idempotencyKey,requestBody};
  }

  private async submitPrepared(idempotencyKey: string, requestBody: string, signal?: AbortSignal): Promise<LocalApiJob> {
    const response = await this.request('/jobs', {
      method: 'POST', signal, headers: { ...this.headers(true, true), 'idempotency-key': idempotencyKey }, body: requestBody
    });
    if (!response.ok) throw new LocalApiResponseError(await actionableResponse(response));
    return await response.json() as LocalApiJob;
  }

  async submit(request: PrintRequest): Promise<LocalApiJob> {
    const prepared = this.prepare(request);
    return await this.submitPrepared(prepared.idempotencyKey, prepared.requestBody, request.signal);
  }

  async job(id: string, signal?: AbortSignal): Promise<LocalApiJob> {
    const response = await this.request(`/jobs/${encodeURIComponent(id)}`, { signal, headers: this.headers(false, true) });
    if (!response.ok) throw new LocalApiResponseError(await actionableResponse(response));
    return await response.json() as LocalApiJob;
  }

  async cancel(id: string, signal?: AbortSignal) {
    const response = await this.request(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', signal, headers: this.headers(false, true) });
    if (!response.ok) throw new LocalApiResponseError(await actionableResponse(response));
    return normalizeJob(await response.json() as LocalApiJob);
  }

  async events(id: string, onProgress: (progress: PrintProgress) => void, signal?: AbortSignal) {
    const response = await this.request(`/jobs/${encodeURIComponent(id)}/events`, { signal, headers: { ...this.headers(false, true), accept: 'text/event-stream' } });
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
    if(request.continuous?.cutMode==='after-job'&&!this.supportsNativeBatch)return{outcome:'failed',bytesSent:0,lastCompletedAction:-1,error:'Cut after job requires negotiated native batch support from the local printer service.'};
    const prepared = this.prepare(request);
    return await this.printPrepared(request.document.id,prepared,request.signal,request.onProgress);
  }

  async printBatch(request: Parameters<NonNullable<PrintRoute['printBatch']>>[0]): Promise<PrintResult> {
    if(!this.options.token())return{outcome:'failed',bytesSent:0,lastCompletedAction:-1,error:'Pair with the local printer service first.'};
    if(!this.supportsNativeBatch)return{outcome:'failed',bytesSent:0,lastCompletedAction:-1,error:'The local printer service has not negotiated native batch support. Update it and reconnect.'};
    const prepared=this.prepareBatch(request);
    return await this.printPrepared(request.documents[0]?.id??'batch',prepared,request.signal,undefined,job=>request.onProgress?.({item:job.item??0,items:job.items??request.documents.length,copy:job.copy??0,copies:job.copies??request.copies,current:progressOf(job)}));
  }

  private async printPrepared(documentId:string,prepared:{idempotencyKey:string;requestBody:string},signal?:AbortSignal,onProgress?:(progress:PrintProgress)=>void,onJob?:(job:LocalApiJob)=>void):Promise<PrintResult>{
    let persisted = await this.options.journal?.save({
      id: `local:${prepared.idempotencyKey}`, documentId,
      createdAt: new Date().toISOString(), state: 'submitting', route: this.id, resumable: true,
      details: { kind: 'local-api-print', ...prepared } satisfies LocalApiJobDetails
    });
    try {
      const submitted = await this.submitPrepared(prepared.idempotencyKey, prepared.requestBody, signal);
      if (persisted) persisted = await this.save(persisted, submitted.state, true, { kind: 'local-api-print', idempotencyKey: prepared.idempotencyKey, remoteJobId: submitted.id, lastJob: submitted });
      const terminal = submitted.terminal ? submitted : await this.poll(submitted.id, signal, onProgress, async (job) => {
        onJob?.(job);
        if (persisted) persisted = await this.save(persisted, job.state, true, { ...localDetails(persisted), lastJob: job });
      });
      const result = normalizeJob(terminal);
      if (persisted) await this.save(persisted, terminal.state, isAmbiguous(result), { ...localDetails(persisted), lastJob: terminal });
      return result;
    } catch (error) {
      const uncertain = !(error instanceof LocalApiResponseError) || !!(persisted && localDetails(persisted).remoteJobId);
      const details: LocalApiJobDetails = persisted ? localDetails(persisted) : { kind: 'local-api-print', ...prepared };
      if (persisted) await this.save(persisted, uncertain ? 'status-unknown' : 'failed', uncertain, uncertain ? details : { ...details, requestBody: undefined });
      return uncertain
        ? { outcome: 'outcome-unknown', bytesSent: details.lastJob?.bytesSent ?? 0, lastCompletedAction: details.lastJob?.lastCompletedAction ?? -1, error: 'The local job may have been accepted. Resume its status before printing again.' }
        : { outcome: 'failed', bytesSent: 0, lastCompletedAction: -1, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async recover(job: PersistedJob, signal?: AbortSignal, onProgress?: (progress: PrintProgress) => void): Promise<PrintResult> {
    let details = localDetails(job);
    try {
      let remote: LocalApiJob;
      if (details.remoteJobId) remote = await this.job(details.remoteJobId, signal);
      else if (details.requestBody) {
        remote = await this.submitPrepared(details.idempotencyKey, details.requestBody, signal);
        details = { ...details, remoteJobId: remote.id, requestBody: undefined, lastJob: remote };
        job = await this.save(job, remote.state, true, details);
      } else throw new Error('The exact local submission snapshot is unavailable.');
      const terminal = remote.terminal ? remote : await this.poll(remote.id, signal, onProgress, async (current) => {
        job = await this.save(job, current.state, true, { ...localDetails(job), lastJob: current });
      });
      const result = normalizeJob(terminal);
      await this.save(job, terminal.state, isAmbiguous(result), { ...localDetails(job), lastJob: terminal });
      return result;
    } catch (error) {
      return { outcome: 'failed', lastCompletedAction: details.lastJob?.lastCompletedAction ?? -1, bytesSent: details.lastJob?.bytesSent ?? 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async poll(id: string, signal?: AbortSignal, onProgress?: (progress: PrintProgress) => void, onJob?: (job: LocalApiJob) => Promise<void>): Promise<LocalApiJob> {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Stopped watching local job.', 'AbortError');
      const current = await this.job(id, signal); onProgress?.(progressOf(current)); await onJob?.(current);
      if (current.terminal) return current;
      await abortableDelay(250, signal);
    }
  }

  private async save(job: PersistedJob, state: string, resumable: boolean, details: LocalApiJobDetails) {
    return await this.options.journal!.save({ ...job, state, resumable, details });
  }

  private headers(json: boolean, authenticated = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers['content-type'] = 'application/json';
    if (this.options.origin) headers.origin = this.options.origin;
    if (authenticated) headers.authorization = `Bearer ${this.requireToken()}`;
    return headers;
  }
  private adminHeaders(adminToken: string): Record<string, string> {
    if (!adminToken.trim()) throw new Error('Enter a fresh local administrator token to configure Wi-Fi.');
    const headers = this.headers(true, false);
    headers.authorization = `Bearer ${adminToken}`;
    return headers;
  }
  private requireToken() { const token = this.options.token(); if (!token) throw new Error('Pair with the local printer service first.'); return token; }
}

export function isLocalApiJobDetails(value: unknown): value is LocalApiJobDetails {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'local-api-print';
}

const progressOf = (job: LocalApiJob): PrintProgress => ({ action: job.action, actions: job.actions, bytesSent: job.bytesSent, totalBytes: job.totalBytes, phase: job.phase });
const normalizeJob = (job: LocalApiJob): PrintResult => ({ outcome: job.outcome ?? (job.terminal ? 'failed' : 'outcome-unknown'), lastCompletedAction: job.lastCompletedAction, bytesSent: job.bytesSent, error: job.error ?? undefined });
const localDetails = (job: PersistedJob | undefined): LocalApiJobDetails => { if (!job || !isLocalApiJobDetails(job.details)) throw new Error('Invalid local job recovery details.'); return job.details; };
const isAmbiguous = (result: PrintResult) => ['outcome-unknown', 'cancelled-partial'].includes(result.outcome);
class LocalApiResponseError extends Error {}
const abortableDelay = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const aborted = () => { clearTimeout(timeout); reject(signal?.reason ?? new DOMException('Stopped watching local job.', 'AbortError')); };
  const timeout = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, milliseconds);
  signal?.addEventListener('abort', aborted, { once: true });
});
async function actionableResponse(response: Response) { if (response.status === 401) return 'Pairing secret expired or the saved grant was revoked. Generate a fresh one-time secret and pair with the local service again.'; if (response.status === 403) return 'The local service denied this editor origin. Add the exact editor origin to LABEL_EDITOR_ORIGINS, restart mb-printer api, and pair again.'; if (response.status === 413) return 'The document or job is too large for the local service.'; return `${response.status} ${response.statusText}: ${await response.text()}`; }
