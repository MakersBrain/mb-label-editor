<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  /** `size` picks the dialog width on desktop; below 40rem every dialog fills the screen. */
  let {
    open = false,
    title = '',
    size = 'md',
    onClose = () => {},
    children,
  }: {
    open?: boolean;
    title?: string;
    size?: 'sm' | 'md' | 'lg' | 'full';
    onClose?: () => void;
    children?: Snippet;
  } = $props();
  let dialog: HTMLElement | undefined = $state.raw();
  const focusable = () =>
    [
      ...(dialog?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ].filter((item) => item.offsetParent !== null || item === document.activeElement);
  function key(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      // Keep keyboard focus inside the dialog, wrapping at both ends.
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  // Move focus into the dialog when it opens and hand it back when it closes.
  $effect(() => {
    if (!open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const target = focusable().find((item) => !item.classList.contains('scrim')) ?? dialog;
    target.focus();
    return () => {
      if (previous && previous.isConnected) previous.focus();
    };
  });
</script>

<svelte:window onkeydown={key} />
{#if open}
  <button type="button" class="scrim" tabindex="-1" aria-label={`Dismiss ${title}`} onclick={onClose}></button>
  <div
    class={`dialog mb-label-editor ${size}`}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    bind:this={dialog}
  >
    <header>
      <h2>{title}</h2>
      <button onclick={onClose} aria-label={`Close ${title}`}>✕</button>
    </header>
    <div class="body">{@render children?.()}</div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    z-index: var(--mble-z-scrim);
    inset: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: var(--mble-scrim);
  }
  /* The class carries the editor's typography and controls to a dialog the host mounts elsewhere. */
  .dialog {
    position: fixed;
    z-index: var(--mble-z-dialog);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    width: min(30rem, calc(100vw - 1.5rem));
    max-height: min(38rem, calc(100dvh - 3rem));
    background: var(--mble-surface);
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-md);
    box-shadow: var(--mble-shadow);
  }
  .dialog.sm {
    width: min(22rem, calc(100vw - 1.5rem));
  }
  .dialog.lg {
    width: min(48rem, calc(100vw - 1.5rem));
    max-height: min(46rem, calc(100dvh - 3rem));
  }
  .dialog.full {
    width: calc(100vw - 1.5rem);
    max-height: calc(100dvh - 1.5rem);
  }
  @media (max-width: 40rem) {
    .dialog,
    .dialog.sm,
    .dialog.lg,
    .dialog.full {
      top: 0;
      left: 0;
      transform: none;
      width: 100vw;
      height: 100dvh;
      max-height: none;
      border: 0;
      border-radius: 0;
      padding-top: env(safe-area-inset-top, 0px);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }
  .dialog > header {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.5rem 0.6rem 0.85rem;
    border-bottom: 1px solid var(--mble-border);
  }
  .dialog h2 {
    margin: 0;
    color: var(--mble-text);
    font-size: var(--mble-text-body);
    font-weight: 600;
  }
  .body {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }
</style>
