<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  /**
   * A titled region using the mb-ui panel pattern. Pass `title={undefined}`
   * when the host already names the region (a dialog header, a tab), so the
   * heading is not repeated. Extra attributes reach the section.
   */
  let {
    title,
    subtitle,
    id,
    class: className = '',
    children,
    actions,
    ...rest
  }: {
    title?: string;
    subtitle?: string;
    id?: string;
    class?: string;
    children?: Snippet;
    actions?: Snippet;
    [key: `aria-${string}`]: string | boolean | undefined;
  } = $props();
</script>

<section class={`mb-panel panel ${className}`} {id} {...rest}>
  {#if title !== undefined || actions}
    <header class="mb-panel-head">
      <div>
        {#if title !== undefined}<h2 class="mb-panel-title">{title}</h2>{/if}
        {#if subtitle}<p class="mb-panel-subtitle">{subtitle}</p>{/if}
      </div>
      {@render actions?.()}
    </header>
  {/if}
  {@render children?.()}
</section>

<style>
  .panel {
    padding-inline: 0.75rem;
    padding-bottom: 0.7rem;
  }
  .panel:first-child {
    border-top: 0;
  }
</style>
