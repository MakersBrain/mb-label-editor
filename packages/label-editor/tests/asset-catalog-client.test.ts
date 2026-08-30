// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { AssetCatalogClient } from '../src/index.js';

const assetPage = {
  items: [{ id: 'asset-1', provider: 'brother', category: 'icon', kinds: ['glyph'], title: 'Rabbit', description: '', tags: ['rabbit'], aliases: [], objects: [], visibleText: '', style: '', confidence: 1, sourceIds: [], groups: [], codes: [], contentUrl: '/v1/assets/asset-1/content', previewUrl: '/v1/assets/asset-1/preview' }],
  total: 1, page: 1, pageSize: 12, pages: 1, revision: 'r1'
};

describe('asset catalog OpenAPI client', () => {
  it('serializes repeated filters and attaches the current bearer token', async () => {
    let token = 'first';
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(assetPage), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new AssetCatalogClient({ baseUrl: 'http://127.0.0.1:8766/', token: () => token, fetch: fetcher });
    const page = await client.searchAssets({ query: 'rabbit', providers: ['brother', 'printmaster'], categories: ['icon'], pageSize: 12 });
    expect(page.items[0].title).toBe('Rabbit');
    const first = new Request(fetcher.mock.calls[0][0], fetcher.mock.calls[0][1]);
    expect(first.headers.get('authorization')).toBe('Bearer first');
    expect(new URL(first.url).searchParams.getAll('provider')).toEqual(['brother', 'printmaster']);
    token = 'second';
    await client.searchAssets();
    expect(new Request(fetcher.mock.calls[1][0], fetcher.mock.calls[1][1]).headers.get('authorization')).toBe('Bearer second');
  });

  it('resolves and downloads relative content URLs with authentication', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
    const client = new AssetCatalogClient({ baseUrl: 'https://catalog.example.test', token: 'secret', fetch: fetcher });
    const blob = await client.fetchBlob('/v1/assets/asset-1/content');
    expect(blob.type).toBe('image/svg+xml');
    const [input, init] = fetcher.mock.calls[0];
    const request = input instanceof Request ? input : new Request(input, init);
    expect(request.url).toBe('https://catalog.example.test/v1/assets/asset-1/content');
    expect(request.headers.get('authorization')).toBe('Bearer secret');
  });

  it('turns API failures into actionable errors', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ detail: 'missing or invalid bearer token' }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const client = new AssetCatalogClient({ baseUrl: 'https://catalog.example.test', fetch: fetcher });
    await expect(client.searchFonts()).rejects.toThrow('401');
  });
});
