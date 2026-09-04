<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { EditorStore } from '../store.svelte.js';
  import { shortcutLabel } from '../shortcuts.js';
  import Icon from './Icon.svelte';
  let { editor }: { editor: EditorStore } = $props();
</script>

<div class="history" role="group" aria-label="History">
  <button
    type="button"
    onclick={() => editor.undo()}
    disabled={!editor.canUndo}
    aria-label="Undo"
    title={`Undo (${shortcutLabel('Mod+Z')})`}><Icon name="undo" /></button
  >
  <button
    type="button"
    onclick={() => editor.redo()}
    disabled={!editor.canRedo}
    aria-label="Redo"
    title={`Redo (${shortcutLabel('Mod+Shift+Z')})`}><Icon name="redo" /></button
  >
</div>

<style>
  .history {
    display: flex;
    gap: 0.1rem;
    align-items: center;
    margin-left: 0.35rem;
    padding-left: 0.45rem;
    border-left: 1px solid var(--mble-border, #d8d0c3);
  }
  button {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    padding: 0;
  }
</style>
