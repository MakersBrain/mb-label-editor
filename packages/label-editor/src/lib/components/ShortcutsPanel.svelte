<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { editorShortcuts, primaryModifier, shortcutLabel } from '../shortcuts.js';
  const modifier = primaryModifier();
</script>

<section class="shortcuts">
  <h2>Keyboard shortcuts</h2>
  {#each editorShortcuts as group}
    <h3>{group.title}</h3>
    <dl>
      {#each group.entries as entry}
        <dt>
          {#each entry.keys as keys, index}{#if index}<span class="or">or</span>{/if}<kbd
              >{shortcutLabel(keys, modifier)}</kbd
            >{/each}
        </dt>
        <dd>{entry.action}</dd>
      {/each}
    </dl>
  {/each}
</section>

<style>
  .shortcuts {
    padding: 0.25rem 0.85rem 0.85rem;
  }
  h3 {
    margin: 0.85rem 0 0.35rem;
    color: var(--mble-text-muted);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.3rem 0.9rem;
    align-items: baseline;
    margin: 0;
  }
  dt {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: baseline;
  }
  dd {
    margin: 0;
    font-size: 0.8rem;
  }
  kbd {
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--mble-border);
    border-bottom-width: 2px;
    border-radius: var(--mble-radius-sm);
    background: var(--mble-background);
    font-family: var(--mble-font-mono);
    font-size: 0.72rem;
    white-space: nowrap;
  }
  .or {
    color: var(--mble-text-muted);
    font-size: 0.7rem;
  }
</style>
