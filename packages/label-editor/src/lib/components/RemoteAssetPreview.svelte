<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { AssetCatalogClient } from '../asset-catalog/client.js';
  export let client: AssetCatalogClient;
  export let path: string;
  export let alt = '';
  let source = '';
  let failed = false;
  onMount(() => {
    let active = true;
    let objectUrl = '';
    void client.fetchBlob(path).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      source = objectUrl;
    }).catch(() => { if (active) failed = true; });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  });
</script>
{#if source}<img src={source} {alt}>{:else}<span class="preview" aria-label={failed ? 'Preview unavailable' : 'Loading preview'}>▧</span>{/if}
<style>.preview{display:grid;width:2.5rem;height:2.5rem;place-items:center;color:var(--mble-text-muted,#666);background:var(--mble-surface-muted,#eee)}</style>
