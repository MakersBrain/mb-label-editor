<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { EditorStore } from '../store.svelte.js';
  let { editor }: { editor: EditorStore } = $props();
  let axis: 'x' | 'y' = $state('x');
  let guideValue = $state(10);
  function addGuide() {
    if (Number.isFinite(guideValue))
      editor.setView({ manualGuides: [...editor.view.manualGuides, { axis, value: guideValue }] });
  }
  function editGuide(index: number, value: number) {
    editor.setView({
      manualGuides: editor.view.manualGuides.map((guide, i) => (i === index ? { ...guide, value } : guide)),
    });
  }
  function removeGuide(index: number) {
    editor.setView({ manualGuides: editor.view.manualGuides.filter((_, i) => i !== index) });
  }
</script>

<section>
  <h2>Guides</h2>
  <div class="row">
    <label>Axis<select bind:value={axis}><option value="x">X</option><option value="y">Y</option></select></label><label
      >Position (mm)<input type="number" step=".1" bind:value={guideValue} /></label
    ><button onclick={addGuide}>Add guide</button>
  </div>
  {#if editor.view.manualGuides.length}<ul>
      {#each editor.view.manualGuides as guide, index}<li>
          <label
            >{guide.axis.toUpperCase()} guide<input
              aria-label={`${guide.axis.toUpperCase()} guide ${index + 1}`}
              type="number"
              step=".1"
              value={guide.value}
              onchange={(e) => editGuide(index, +e.currentTarget.value)}
            /></label
          ><button aria-label={`Remove guide ${index + 1}`} onclick={() => removeGuide(index)}>Remove</button>
        </li>{/each}
    </ul>{:else}<p class="hint">No manual guides yet. Snapping still uses element edges and the grid.</p>{/if}
  <p class="hint">
    <strong>Drag modifiers:</strong> Shift snaps only to the grid, Ctrl/Cmd snaps only to other elements, and Alt temporarily
    disables snapping. On any resize handle, Shift toggles the selection's aspect-ratio lock.
  </p>
</section>

<style>
  section {
    padding: 0.7rem 0.75rem;
  }
  h2 {
    margin: 0 0 0.5rem;
    color: var(--mble-text-muted);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .row {
    display: flex;
    gap: 0.4rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.75rem;
  }
  input[type='number'] {
    width: 6rem;
  }
  ul {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }
  li {
    display: flex;
    gap: 0.4rem;
    align-items: flex-end;
  }
  .hint {
    margin: 0.6rem 0 0;
    color: var(--mble-text-muted);
    font-size: 0.75rem;
  }
</style>
