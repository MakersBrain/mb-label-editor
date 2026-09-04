<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ExternalResourceConnection } from '../external-resources/types.js';
  import type { ExternalResourceConnectionManager } from '../external-resources/manager.js';

  interface Props {
    manager: ExternalResourceConnectionManager;
    onChange?: (connections: ExternalResourceConnection[]) => void;
    onSelect?: (id: string) => void;
  }
  let { manager, onChange = () => {}, onSelect = () => {} }: Props = $props();

  // The form seeds itself from the manager once; refresh() re-reads it after every change.
  let connections = $state.raw(untrack(() => manager.connections()));
  let selectedId = $state(untrack(() => manager.selectedId()));
  let editingId = $state('');
  let name = $state('');
  let providerKind = $state(untrack(() => manager.providers()[0]?.kind ?? ''));
  let endpoint = $state('');
  let enabled = $state(true);
  let token = $state('');
  let busy = $state(false);
  let status = $state('');

  const providers = $derived(manager.providers());

  function refresh() {
    connections = manager.connections();
    selectedId = manager.selectedId();
    onChange(connections);
    onSelect(selectedId);
  }

  function edit(item?: ExternalResourceConnection) {
    editingId = item?.id ?? '';
    name = item?.name ?? '';
    providerKind = item?.providerKind ?? providers[0]?.kind ?? '';
    endpoint = item?.endpoint ?? '';
    enabled = item?.enabled ?? true;
    token = '';
    status = '';
  }

  async function save() {
    busy = true;
    try {
      const item = manager.upsert({ id: editingId || undefined, name, providerKind, endpoint, enabled });
      if (token) manager.setSessionToken(item.id, token);
      manager.select(item.enabled ? item.id : selectedId);
      edit(item);
      refresh();
      status = `Saved ${item.name}.`;
    } catch (error) {
      status = message(error);
    } finally {
      busy = false;
    }
  }

  function choose(id: string) {
    manager.select(id);
    selectedId = manager.selectedId();
    onSelect(selectedId);
    status = selectedId ? 'Active resource connection changed.' : 'No active resource connection.';
  }

  async function test(item: ExternalResourceConnection) {
    busy = true;
    try {
      if (editingId === item.id && token) manager.setSessionToken(item.id, token);
      await manager.test(item.id);
      status = `${item.name} is reachable.`;
      refresh();
    } catch (error) {
      status = message(error);
    } finally {
      busy = false;
    }
  }

  function remove(item: ExternalResourceConnection) {
    if (!confirm(`Remove external resource connection “${item.name}”?`)) return;
    manager.remove(item.id);
    if (editingId === item.id) edit();
    refresh();
    status = `Removed ${item.name}.`;
  }

  const providerName = (kind: string) => providers.find((item) => item.kind === kind)?.displayName ?? kind;
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
</script>

<section>
  <h2>External resource connections</h2>
  <p class="intro">Connect asset and font services. Credentials stay in memory for this page session.</p>

  {#if connections.length}
    <ul>
      {#each connections as item (item.id)}
        <li class:active={item.id === selectedId}>
          <label
            ><input
              type="radio"
              name="active-resource-connection"
              value={item.id}
              checked={item.id === selectedId}
              disabled={!item.enabled}
              onchange={() => choose(item.id)}
            /><span
              ><strong>{item.name}</strong><small
                >{providerName(item.providerKind)} · {item.endpoint} · {item.enabled ? 'Enabled' : 'Disabled'}</small
              ></span
            ></label
          >
          <div>
            <button onclick={() => edit(item)}>Edit</button><button
              onclick={() => test(item)}
              disabled={busy || !item.enabled}>Test</button
            ><button onclick={() => remove(item)}>Remove</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}<p>No external resource connections.</p>{/if}

  <form
    onsubmit={(event) => {
      event.preventDefault();
      save();
    }}
  >
    <h3>{editingId ? 'Edit connection' : 'Add connection'}</h3>
    <label>Name<input bind:value={name} required placeholder="Workshop assets" /></label>
    <label
      >Provider<select bind:value={providerKind} required
        >{#each providers as provider}<option value={provider.kind}>{provider.displayName}</option>{/each}</select
      ></label
    >
    <label>Endpoint<input type="url" bind:value={endpoint} required placeholder="https://assets.example.com" /></label>
    <label
      >Session token<input
        type="password"
        bind:value={token}
        autocomplete="off"
        placeholder={editingId && manager.hasSessionToken(editingId)
          ? 'Token is set for this session'
          : 'Optional bearer token'}
      /></label
    >
    <label class="enabled"><input type="checkbox" bind:checked={enabled} /> Enabled</label>
    <div class="form-actions">
      <button type="submit" disabled={busy || !providers.length}
        >{editingId ? 'Save connection' : 'Add connection'}</button
      >{#if editingId}<button type="button" onclick={() => edit()}>Add another</button>{/if}
    </div>
  </form>
  <p aria-live="polite">{status}</p>
</section>

<style>
  section {
    padding: 0.8rem;
  }
  h2,
  h3 {
    margin: 0 0 0.45rem;
  }
  h2 {
    font-size: var(--mble-text-h4);
  }
  h3 {
    font-size: var(--mble-text-body);
  }
  .intro,
  p,
  small {
    color: var(--mble-text-muted);
    font-size: var(--mble-text-small);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0.6rem 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 0.7rem;
    padding: 0.5rem;
    border: 1px solid var(--mble-border);
    border-radius: 0.35rem;
    margin: 0.35rem 0;
  }
  li.active {
    border-color: var(--mble-primary);
  }
  li label {
    display: flex;
    flex-direction: row;
    align-items: start;
    gap: 0.45rem;
    margin: 0;
    min-width: 0;
  }
  li span {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  li small {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  li div,
  .form-actions {
    display: flex;
    gap: 0.3rem;
    align-items: center;
  }
  form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    padding-top: 0.65rem;
    border-top: 1px solid var(--mble-border);
  }
  form h3,
  .form-actions {
    grid-column: 1/-1;
  }
  form label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: var(--mble-text-small);
  }
  .enabled {
    flex-direction: row;
    align-items: center;
  }
  input,
  select {
    box-sizing: border-box;
    min-width: 0;
    width: 100%;
  }
  .enabled input {
    width: auto;
  }
  @media (max-width: 40rem) {
    section {
      min-width: 0;
    }
    form {
      grid-template-columns: 1fr;
    }
    li {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
