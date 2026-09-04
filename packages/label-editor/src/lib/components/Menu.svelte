<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, align = 'start', children }: { label: string; align?: 'start' | 'end'; children?: Snippet } = $props();
  function dismiss(event: FocusEvent) {
    const menu = event.currentTarget as HTMLDetailsElement;
    const next = event.relatedTarget as Node | null;
    if (!next || !menu.contains(next)) menu.open = false;
  }
  function keys(event: KeyboardEvent) {
    const menu = event.currentTarget as HTMLDetailsElement;
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      menu.open = false;
      menu.querySelector<HTMLElement>('summary')?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...menu.querySelectorAll<HTMLElement>('.sheet button:not([disabled]), .sheet input, .sheet select')];
    if (!items.length) return;
    event.preventDefault();
    if (!menu.open) menu.open = true;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }
  function pick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('button'))
      (event.currentTarget as HTMLElement).closest('details')!.removeAttribute('open');
  }
</script>

<details class="menu" onfocusout={dismiss}>
  <summary onkeydown={keys}>{label}</summary>
  <!-- The sheet only observes clicks that bubble from its own buttons, which stay keyboard-operable themselves. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sheet" class:end={align === 'end'} onclick={pick} onkeydown={keys}>{@render children?.()}</div>
</details>

<style>
  .menu {
    position: relative;
  }
  .sheet :global(kbd) {
    margin-left: auto;
    padding-left: 1rem;
    color: var(--mble-text-muted);
    font-family: var(--mble-font-mono);
    font-size: var(--mble-text-micro);
  }
  .menu > summary {
    padding: 0.25rem 0.5rem;
    border-radius: var(--mble-radius-sm);
    list-style: none;
    color: var(--mble-text-muted);
    white-space: nowrap;
  }
  .menu > summary::-webkit-details-marker {
    display: none;
  }
  .menu > summary:hover,
  .menu[open] > summary {
    background: var(--mble-surface-sunken);
    color: var(--mble-text);
  }
  .sheet {
    position: absolute;
    z-index: var(--mble-z-menu);
    left: 0;
    top: calc(100% + 0.3rem);
    display: grid;
    gap: 0.1rem;
    min-width: 12rem;
    max-width: calc(100vw - 1rem);
    padding: 0.35rem;
    background: var(--mble-surface);
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-md);
    box-shadow: var(--mble-shadow);
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
    font-size: var(--mble-text-small);
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
    background: var(--mble-border);
  }
  .sheet :global(p.group-label) {
    margin: 0.3rem 0 0.1rem 0.45rem;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-micro);
  }
</style>
