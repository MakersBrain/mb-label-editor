// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import {
  ExternalResourceConnectionManager,
  type ExternalResourceProvider,
  type ExternalResourceProviderFactory,
} from '../src/index.js';

function factory(kind = 'future-provider') {
  const tokens: string[] = [];
  const created: ExternalResourceProvider[] = [];
  const value: ExternalResourceProviderFactory = {
    kind,
    displayName: 'Future provider',
    create(connection, options) {
      const provider: ExternalResourceProvider = {
        connectionId: connection.id,
        kind,
        displayName: connection.name,
        searchAssets: vi.fn(async () => {
          tokens.push(options.getAccessToken() ?? '');
          return { items: [], page: 1, pages: 1, total: 0 };
        }),
        searchFonts: vi.fn(async () => ({ items: [], page: 1, pages: 1, total: 0 })),
        fetchBlob: vi.fn(async () => new Blob()),
      };
      created.push(provider);
      return provider;
    },
  };
  return { value, tokens, created };
}

describe('external resource connection manager', () => {
  it('persists provider-neutral metadata but keeps credentials in memory', async () => {
    const adapter = factory();
    const manager = new ExternalResourceConnectionManager([adapter.value]);
    const connection = manager.upsert({
      name: 'Workshop library',
      providerKind: adapter.value.kind,
      endpoint: 'https://assets.example.test/',
    });
    manager.setSessionToken(connection.id, 'session-secret');
    manager.select(connection.id);
    await manager.test(connection.id);

    expect(manager.selected()?.displayName).toBe('Workshop library');
    expect(adapter.tokens).toEqual(['session-secret']);
    expect(JSON.stringify(manager.connections())).not.toContain('session-secret');
    expect(manager.connections()[0]).toEqual({
      version: 1,
      id: connection.id,
      name: 'Workshop library',
      providerKind: 'future-provider',
      endpoint: 'https://assets.example.test',
      enabled: true,
    });
  });

  it('supports later provider factories without changing the manager', () => {
    const first = factory('first');
    const later = factory('later');
    const manager = new ExternalResourceConnectionManager([first.value]);
    manager.register(later.value);
    const connection = manager.upsert({
      name: 'Later service',
      providerKind: 'later',
      endpoint: 'https://later.example.test/api',
    });
    expect(manager.provider(connection.id)?.kind).toBe('later');
    expect(manager.providers()).toEqual([
      { kind: 'first', displayName: 'Future provider' },
      { kind: 'later', displayName: 'Future provider' },
    ]);
  });

  it('drops malformed stored connections and rejects unsafe endpoints', () => {
    const adapter = factory();
    const manager = new ExternalResourceConnectionManager(
      [adapter.value],
      [
        {
          version: 1,
          id: 'bad',
          name: 'Bad',
          providerKind: adapter.value.kind,
          endpoint: 'javascript:alert(1)',
          enabled: true,
        },
      ],
    );
    expect(manager.connections()).toEqual([]);
    expect(() =>
      manager.upsert({ name: 'Bad', providerKind: adapter.value.kind, endpoint: 'file:///tmp/assets' }),
    ).toThrow(/HTTP or HTTPS/);
  });
});
