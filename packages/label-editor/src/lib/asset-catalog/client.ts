// SPDX-License-Identifier: AGPL-3.0-or-later
import createClient from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type RemoteAsset = components['schemas']['AssetResponse'];
export type RemoteAssetPage = components['schemas']['SearchResponse'];
export type RemoteFont = components['schemas']['FontFamilyResponse'];
export type RemoteFontFace = components['schemas']['FontFaceResponse'];
export type RemoteFontPage = components['schemas']['FontSearchResponse'];
export type AssetFacets = components['schemas']['FacetsResponse'];
export type FontFacets = components['schemas']['FontFacetsResponse'];

type TokenSource = string | (() => string | undefined);
export interface AssetCatalogClientOptions {
  baseUrl: string;
  token?: TokenSource;
  fetch?: typeof globalThis.fetch;
}
export interface AssetSearchOptions {
  query?: string;
  providers?: string[];
  categories?: string[];
  kinds?: string[];
  tags?: string[];
  styles?: string[];
  page?: number;
  pageSize?: number;
}
export interface FontSearchOptions {
  query?: string;
  providers?: string[];
  categories?: string[];
  availability?: string[];
  page?: number;
  pageSize?: number;
}

/** Typed browser client generated from the mbprint-asset-catalog OpenAPI contract. */
export class AssetCatalogClient {
  readonly baseUrl: string;
  readonly #token?: TokenSource;
  readonly #fetch: typeof globalThis.fetch;
  readonly #client: ReturnType<typeof createClient<paths>>;

  constructor(options: AssetCatalogClientOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Asset catalog URL is required.');
    this.baseUrl = baseUrl;
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#client = createClient<paths>({ baseUrl, fetch: request => this.#fetch(request) });
    this.#client.use({
      onRequest: ({ request }) => {
        const token = this.token();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        return request;
      }
    });
  }

  async searchAssets(options: AssetSearchOptions = {}): Promise<RemoteAssetPage> {
    const { data, error, response } = await this.#client.GET('/v1/assets', {
      params: { query: {
        q: options.query, provider: options.providers, category: options.categories,
        kind: options.kinds, tag: options.tags, style: options.styles,
        page: options.page, pageSize: options.pageSize
      } }
    });
    if (!data) throw responseError(response, error);
    return data;
  }

  async assetFacets(query = ''): Promise<AssetFacets> {
    const { data, error, response } = await this.#client.GET('/v1/facets', { params: { query: { q: query } } });
    if (!data) throw responseError(response, error);
    return data;
  }

  async searchFonts(options: FontSearchOptions = {}): Promise<RemoteFontPage> {
    const { data, error, response } = await this.#client.GET('/v1/fonts', {
      params: { query: {
        q: options.query, provider: options.providers, category: options.categories,
        availability: options.availability, page: options.page, pageSize: options.pageSize
      } }
    });
    if (!data) throw responseError(response, error);
    return data;
  }

  async fontFacets(query = ''): Promise<FontFacets> {
    const { data, error, response } = await this.#client.GET('/v1/font-facets', { params: { query: { q: query } } });
    if (!data) throw responseError(response, error);
    return data;
  }

  async cacheFont(id: string, variants: string[] = []): Promise<RemoteFont> {
    const { data, error, response } = await this.#client.POST('/v1/fonts/{family_id}/cache', {
      params: { path: { family_id: id } }, body: { variants }
    });
    if (!data) throw responseError(response, error);
    return data;
  }

  async fetchBlob(relativeUrl: string): Promise<Blob> {
    const headers = new Headers();
    const token = this.token();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await this.#fetch(this.resolveUrl(relativeUrl), { headers });
    if (!response.ok) throw responseError(response, await safeError(response));
    return await response.blob();
  }

  resolveUrl(relativeUrl: string): string {
    return new URL(relativeUrl, `${this.baseUrl}/`).href;
  }

  private token(): string | undefined {
    const value = typeof this.#token === 'function' ? this.#token() : this.#token;
    return value?.trim() || undefined;
  }
}

async function safeError(response: Response): Promise<unknown> {
  try { return await response.clone().json(); } catch { return undefined; }
}
function responseError(response: Response, detail: unknown): Error {
  const value = detail && typeof detail === 'object' && 'detail' in detail
    ? JSON.stringify((detail as { detail: unknown }).detail)
    : response.statusText;
  return new Error(`Asset catalog returned ${response.status}${value ? `: ${value}` : ''}`);
}
