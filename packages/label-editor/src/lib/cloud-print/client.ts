// SPDX-License-Identifier: AGPL-3.0-or-later
import createClient from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type CloudPrinter = components['schemas']['PrinterView'];
export type CloudPrintJob = components['schemas']['JobView'];
export type CloudPrintRequest = Omit<components['schemas']['ValidatedPrintRequest'], 'document' | 'documents'> & ({ document: unknown; documents?: never } | { document?: never; documents: unknown[] });
export type CloudPrintSubmission = Omit<components['schemas']['SubmitJob'], 'request'> & { request: CloudPrintRequest };
export type CloudTokenSource = () => string | undefined | Promise<string | undefined>;

export interface CloudPrintClientOptions {
  baseUrl: string;
  tenantId: string;
  getAccessToken?: CloudTokenSource;
  fetch?: typeof globalThis.fetch;
}

export class CloudPrintHttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export class CloudPrintSubmissionError extends Error {
  constructor(message: string, public readonly uncertain: boolean) { super(message); }
}

export class CloudPrintClient {
  readonly baseUrl: string;
  readonly tenantId: string;
  readonly #token?: CloudTokenSource;
  readonly #fetch: typeof globalThis.fetch;
  readonly #client: ReturnType<typeof createClient<paths>>;
  supportsNativeBatch=false;

  constructor(options: CloudPrintClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    this.tenantId = options.tenantId.trim();
    if (!this.baseUrl) throw new Error('Cloud print service URL is required.');
    if (!this.tenantId) throw new Error('Cloud print tenant ID is required.');
    this.#token = options.getAccessToken;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#client = createClient<paths>({ baseUrl: this.baseUrl, fetch: request => this.#fetch(request) });
    this.#client.use({ onRequest: async ({ request }) => {
      const token = await this.token();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    } });
  }

  async listPrinters(signal?: AbortSignal): Promise<CloudPrinter[]> {
    const { data, error, response } = await this.#client.GET('/v1/tenants/{tenant}/printers', {
      params: { path: { tenant: this.tenantId } }, signal
    });
    if (!data) throw cloudResponseError(response, error);
    return data;
  }

  async negotiateCapabilities(signal?:AbortSignal):Promise<{nativeBatch:boolean;continuousOptions:boolean}>{
    const headers=new Headers();const token=await this.token();if(token)headers.set('authorization',`Bearer ${token}`);
    const response=await this.#fetch(`${this.baseUrl}/openapi.json`,{headers,signal,cache:'no-store'});if(!response.ok)throw cloudResponseError(response,await safeJson(response));
    const document=await response.json() as {components?:{schemas?:Record<string,{properties?:Record<string,unknown>}>}};
    const properties=document.components?.schemas?.ValidatedPrintRequest?.properties??{};const nativeBatch='documents'in properties;const continuousOptions='continuous'in properties;
    this.supportsNativeBatch=nativeBatch&&continuousOptions;return{nativeBatch,continuousOptions};
  }

  serializeSubmission(submission: CloudPrintSubmission): string {
    return JSON.stringify(submission);
  }

  async submitJob(submission: CloudPrintSubmission, idempotencyKey: string, signal?: AbortSignal): Promise<CloudPrintJob> {
    return await this.submitSerialized(this.serializeSubmission(submission), idempotencyKey, signal);
  }

  async submitSerialized(serialized: string, idempotencyKey: string, signal?: AbortSignal): Promise<CloudPrintJob> {
    const headers = new Headers({ 'content-type': 'application/json', 'idempotency-key': idempotencyKey });
    const token = await this.token();
    if (token) headers.set('authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await this.#fetch(`${this.baseUrl}/v1/tenants/${encodeURIComponent(this.tenantId)}/print-jobs`, {
        method: 'POST', headers, body: serialized, signal
      });
    } catch (error) {
      throw new CloudPrintSubmissionError(error instanceof Error ? error.message : String(error), true);
    }
    const value = await safeJson(response);
    if (!response.ok) {
      const error = cloudResponseError(response, value);
      throw new CloudPrintSubmissionError(error.message, false);
    }
    return value as CloudPrintJob;
  }

  async getJob(jobId: string, signal?: AbortSignal): Promise<CloudPrintJob> {
    const { data, error, response } = await this.#client.GET('/v1/tenants/{tenant}/print-jobs/{job}', {
      params: { path: { tenant: this.tenantId, job: jobId } }, signal
    });
    if (!data) throw cloudResponseError(response, error);
    return data;
  }

  async cancelJob(jobId: string, signal?: AbortSignal): Promise<CloudPrintJob> {
    const { data, error, response } = await this.#client.POST('/v1/tenants/{tenant}/print-jobs/{job}/cancel', {
      params: { path: { tenant: this.tenantId, job: jobId } }, signal
    });
    if (!data) throw cloudResponseError(response, error);
    return data;
  }

  private async token(): Promise<string | undefined> {
    const value = await this.#token?.();
    return value?.trim() || undefined;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try { return await response.clone().json(); } catch { return undefined; }
}

function cloudResponseError(response: Response, detail: unknown): CloudPrintHttpError {
  const body = detail && typeof detail === 'object' ? detail as { error?: unknown; message?: unknown } : {};
  const code = typeof body.error === 'string' ? body.error : 'request_failed';
  const serverMessage = typeof body.message === 'string' ? body.message : undefined;
  const actionable: Record<number, string> = {
    401: 'Cloud print authentication is missing or expired.',
    403: 'This credential cannot print for the selected tenant.',
    404: 'The cloud tenant, printer, or job is unavailable.',
    409: 'The cloud printer or job state conflicts with this request.',
    413: 'The label is too large for the cloud print service.'
  };
  return new CloudPrintHttpError(response.status, code, serverMessage ?? actionable[response.status] ?? `Cloud print request failed (${response.status}).`);
}
