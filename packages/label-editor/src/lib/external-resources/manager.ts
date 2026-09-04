// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuid } from '../model.js';
import type {
  ExternalResourceConnection,
  ExternalResourceProvider,
  ExternalResourceProviderFactory,
  ExternalResourceProviderSummary,
} from './types.js';

export interface ExternalResourceConnectionInput {
  id?: string;
  name: string;
  providerKind: string;
  endpoint: string;
  enabled?: boolean;
}

/** Owns serializable connection metadata while keeping credentials in memory. */
export class ExternalResourceConnectionManager {
  #factories = new Map<string, ExternalResourceProviderFactory>();
  #connections: ExternalResourceConnection[] = [];
  #tokens = new Map<string, string>();
  #providers = new Map<string, ExternalResourceProvider>();
  #selectedId = '';

  constructor(
    factories: ExternalResourceProviderFactory[] = [],
    connections: ExternalResourceConnection[] = [],
    selectedId = '',
  ) {
    for (const factory of factories) this.register(factory);
    this.replace(connections);
    this.select(selectedId);
  }

  register(factory: ExternalResourceProviderFactory) {
    if (!factory.kind.trim()) throw new Error('External resource provider kind is required.');
    this.#factories.set(factory.kind, factory);
    this.#providers.clear();
  }

  providers(): ExternalResourceProviderSummary[] {
    return [...this.#factories.values()].map((factory) => ({ kind: factory.kind, displayName: factory.displayName }));
  }

  connections(): ExternalResourceConnection[] {
    return structuredClone(this.#connections);
  }
  selectedId() {
    return this.#selectedId;
  }
  selected(): ExternalResourceProvider | undefined {
    return this.provider(this.#selectedId);
  }

  replace(value: unknown) {
    this.#connections = Array.isArray(value)
      ? value.map(connection).filter((item): item is ExternalResourceConnection => !!item)
      : [];
    this.#providers.clear();
    if (!this.#connections.some((item) => item.id === this.#selectedId && item.enabled))
      this.#selectedId = this.#connections.find((item) => item.enabled)?.id ?? '';
  }

  upsert(input: ExternalResourceConnectionInput): ExternalResourceConnection {
    if (!this.#factories.has(input.providerKind))
      throw new Error(`Unknown external resource provider: ${input.providerKind}`);
    const endpoint = normalizeEndpoint(input.endpoint);
    const name = input.name.trim();
    if (!name) throw new Error('Connection name is required.');
    const item: ExternalResourceConnection = {
      version: 1,
      id: input.id || uuid(),
      name,
      providerKind: input.providerKind,
      endpoint,
      enabled: input.enabled ?? true,
    };
    const index = this.#connections.findIndex((value) => value.id === item.id);
    if (index >= 0) this.#connections[index] = item;
    else this.#connections.push(item);
    this.#providers.delete(item.id);
    if (!this.#selectedId && item.enabled) this.#selectedId = item.id;
    return structuredClone(item);
  }

  remove(id: string) {
    this.#connections = this.#connections.filter((item) => item.id !== id);
    this.#tokens.delete(id);
    this.#providers.delete(id);
    if (this.#selectedId === id) this.#selectedId = this.#connections.find((item) => item.enabled)?.id ?? '';
  }

  select(id: string) {
    this.#selectedId = this.#connections.some((item) => item.id === id && item.enabled)
      ? id
      : (this.#connections.find((item) => item.enabled)?.id ?? '');
  }

  setSessionToken(id: string, token: string) {
    const value = token.trim();
    if (value) this.#tokens.set(id, value);
    else this.#tokens.delete(id);
    this.#providers.delete(id);
  }

  hasSessionToken(id: string) {
    return this.#tokens.has(id);
  }

  provider(id: string): ExternalResourceProvider | undefined {
    const existing = this.#providers.get(id);
    if (existing) return existing;
    const item = this.#connections.find((value) => value.id === id && value.enabled);
    if (!item) return undefined;
    const factory = this.#factories.get(item.providerKind);
    if (!factory) return undefined;
    const provider = factory.create(item, { getAccessToken: () => this.#tokens.get(id) });
    this.#providers.set(id, provider);
    return provider;
  }

  async test(id: string) {
    const provider = this.provider(id);
    if (!provider) throw new Error('Enable the connection and select a supported provider.');
    await provider.searchAssets({ page: 1, pageSize: 1 });
  }
}

function normalizeEndpoint(value: string) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Connection endpoint must use HTTP or HTTPS.');
  url.hash = '';
  url.search = '';
  return url.href.replace(/\/$/, '');
}

function connection(value: unknown): ExternalResourceConnection | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<ExternalResourceConnection>;
  if (
    item.version !== 1 ||
    typeof item.id !== 'string' ||
    !item.id ||
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    typeof item.providerKind !== 'string' ||
    typeof item.endpoint !== 'string' ||
    typeof item.enabled !== 'boolean'
  )
    return undefined;
  try {
    return {
      version: 1,
      id: item.id,
      name: item.name.trim(),
      providerKind: item.providerKind,
      endpoint: normalizeEndpoint(item.endpoint),
      enabled: item.enabled,
    };
  } catch {
    return undefined;
  }
}
