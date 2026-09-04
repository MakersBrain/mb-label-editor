<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, align = 'start', children }: { label: string; align?: 'start' | 'end'; children?: Snippet } = $props();
  function dismiss(event: FocusEvent) {
    const menu = event.currentTarget as HTMLDetailsElement;
    const next = event.relatedTarget as Node | null;
    if (!next || !menu.contains(next)) menu.open = false;
  }
  function pick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('button'))
      (event.currentTarget as HTMLElement).closest('details')!.removeAttribute('open');
  }
</script>

<details class="menu" onfocusout={dismiss}>
  <summary>{label}</summary>
  <!-- The sheet only observes clicks that bubble from its own buttons, which stay keyboard-operable themselves. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="sheet" class:end={align === 'end'} onclick={pick}>{@render children?.()}</div>
</details>

<style>
  .menu {
    position: relative;
  }
  .sheet :global(kbd) {
    margin-left: auto;
    padding-left: 1rem;
    color: var(--mble-text-muted, #59635e);
    font-family: var(--mble-font-mono, ui-monospace, monospace);
    font-size: 0.68rem;
  }
  .menu > summary {
    padding: 0.25rem 0.5rem;
    border-radius: var(--mble-radius-sm, 4px);
    list-style: none;
    color: var(--mble-text-muted, #59635e);
    white-space: nowrap;
  }
  .menu > summary::-webkit-details-marker {
    display: none;
  }
  .menu > summary:hover,
  .menu[open] > summary {
    background: var(--mble-surface-sunken, #f0e9e3);
    color: var(--mble-text, #17231c);
  }
  .sheet {
    position: absolute;
    z-index: 60;
    left: 0;
    top: calc(100% + 0.3rem);
    display: grid;
    gap: 0.1rem;
    min-width: 12rem;
    max-width: calc(100vw - 1rem);
    padding: 0.35rem;
    background: var(--mble-surface, #fff);
    border: 1px solid var(--mble-border, #d8d0c3);
    border-radius: var(--mble-radius-md, 6px);
    box-shadow: var(--mble-shadow, 0 8px 24px #17231c22);
  }
  .sheet.end {
    left: auto;
    right: 0;
  }
  .sheet :global(button) {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 0.3rem 0.45rem;
  }
  .sheet :global(label) {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0.45rem;
    font-size: 0.75rem;
  }
  .sheet :global(label.check) {
    justify-content: flex-start;
  }
  .sheet :global(input[type='number']),
  .sheet :global(select) {
    width: 6rem;
  }
  .sheet :global(hr) {
    width: 100%;
    height: 1px;
    margin: 0.2rem 0;
    border: 0;
    background: var(--mble-border, #e5dfd5);
  }
  .sheet :global(p.group-label) {
    margin: 0.3rem 0 0.1rem 0.45rem;
    color: var(--mble-text-muted, #59635e);
    font-size: 0.68rem;
  }
</style>
