<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { updateDocument } from '../commands.js';
  import type { EditorStore } from '../store.svelte.js';
  /** `saveState` is whatever the host knows about persistence, for example "Saved" or "Unsaved changes". */
  let { editor, saveState = '' }: { editor: EditorStore; saveState?: string } = $props();
  function rename(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const title = input.value.trim();
    if (title && title !== editor.document.title) editor.execute(updateDocument({ title }));
    else input.value = editor.document.title;
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === 'Escape') (event.currentTarget as HTMLInputElement).blur();
  }
</script>

<div class="title">
  <input
    aria-label="Document title"
    title="Document title"
    value={editor.document.title}
    onchange={rename}
    onkeydown={keys}
    spellcheck="false"
  />
  {#if saveState}<span class="save-state" aria-live="polite">{saveState}</span>{/if}
</div>

<style>
  .title {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }
  input {
    min-width: 6rem;
    width: 100%;
    padding: 0.15rem 0.35rem;
    border-color: transparent;
    background: transparent;
    color: var(--mble-text);
    font-weight: 600;
    text-overflow: ellipsis;
  }
  input:hover,
  input:focus {
    border-color: var(--mble-border);
    background: var(--mble-surface);
  }
  .save-state {
    padding-left: 0.4rem;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-micro);
  }
</style>
