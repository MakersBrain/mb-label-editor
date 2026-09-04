<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import Panel from './Panel.svelte';
  import { onMount } from 'svelte';
  import { defaultDocument, type LabelDocument } from '../model.js';
  import type { EditorStore } from '../store.svelte.js';
  import { EditorDatabase, type RecentItem } from '../persistence/database.js';
  let { title = 'Document library', editor }: { title?: string; editor: EditorStore } = $props();
  const database = new EditorDatabase();
  let documents: LabelDocument[] = $state.raw([]);
  let recent: RecentItem[] = $state.raw([]);
  let status = $state('');
  onMount(refresh);
  async function refresh() {
    documents = await database.listDocuments();
    recent = await database.listRecent();
  }
  async function save() {
    await database.saveDocument(editor.document);
    await database.saveRecent({ id: editor.document.id, kind: 'document', openedAt: new Date().toISOString() });
    await refresh();
    status = `Saved ${editor.document.title} to this browser.`;
  }
  async function open(document: LabelDocument) {
    editor.replace(structuredClone(document));
    await database.saveRecent({ id: document.id, kind: 'document', openedAt: new Date().toISOString() });
    await refresh();
    status = `Opened ${document.title} from this browser.`;
  }
  function create() {
    editor.replace(defaultDocument());
    status = 'Created a new unsaved label.';
  }
  async function rename(document: LabelDocument, title: string) {
    const copy = structuredClone(document);
    copy.title = title.trim() || document.title;
    copy.modifiedAt = new Date().toISOString();
    await database.saveDocument(copy);
    await refresh();
    status = `Renamed label to ${copy.title}.`;
  }
  async function remove(document: LabelDocument) {
    await database.removeDocument(document.id);
    await refresh();
    status = `Removed ${document.title} from browser storage.`;
  }
</script>

<Panel {title}>
  <div class="actions">
    <button onclick={create}>New label</button><button onclick={save}>Save to browser</button><button onclick={refresh}
      >Refresh</button
    >
  </div>
  <p aria-live="polite">{status}</p>
  {#if documents.length}<ul>
      {#each documents as document}<li>
          <button onclick={() => open(document)}>{document.title}</button><input
            aria-label={`Rename ${document.title}`}
            value={document.title}
            onchange={(e) => rename(document, e.currentTarget.value)}
          /><button aria-label={`Delete ${document.title}`} onclick={() => remove(document)}>Delete</button><small
            >{document.media.width} × {document.media.height} mm · {new Date(
              document.modifiedAt,
            ).toLocaleString()}</small
          >{#if recent.some((item) => item.kind === 'document' && item.id === document.id)}<span>recent</span>{/if}
        </li>{/each}
    </ul>{:else}<p>No explicitly saved browser documents yet. Autosave recovery remains active.</p>{/if}
</Panel>

<style>
  .actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0;
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.15rem 0.4rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--mble-border);
  }
  li button {
    text-align: left;
  }
  small {
    grid-column: 1;
    color: var(--mble-text-muted);
  }
  li span {
    font-size: var(--mble-text-micro);
    color: var(--mble-accent);
  }
</style>
