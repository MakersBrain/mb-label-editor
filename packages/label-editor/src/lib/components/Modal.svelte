<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
export let open=false;export let title='';export let onClose:()=>void=()=>{};
function key(event:KeyboardEvent){if(event.key==='Escape'&&open){event.stopPropagation();onClose()}}
</script>
<svelte:window on:keydown={key}/>
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="scrim" on:click={onClose}></div>
  <div class="dialog mb-label-editor" role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2><button on:click={onClose} aria-label={`Close ${title}`}>✕</button></header>
    <div class="body"><slot/></div>
  </div>
{/if}
<style>
  .scrim{position:fixed;z-index:80;inset:0;background:#17231c66}
  /* The class carries the editor's typography and controls to a dialog the host mounts elsewhere. */
  .dialog{position:fixed;z-index:81;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;width:min(30rem,calc(100vw - 1.5rem));max-height:min(38rem,calc(100dvh - 3rem));background:var(--mble-surface,#fff);border:1px solid var(--mble-border,#d8d0c3);border-radius:var(--mble-radius-md,6px);box-shadow:var(--mble-shadow,0 8px 24px #17231c22)}
  .dialog>header{display:flex;gap:.5rem;align-items:center;justify-content:space-between;padding:.6rem .5rem .6rem .85rem;border-bottom:1px solid var(--mble-border,#e5dfd5)}
  .dialog h2{margin:0;color:var(--mble-text,#17231c);font-size:.85rem;font-weight:600}
  .body{min-height:0;overflow:auto;overscroll-behavior:contain}
  .body :global(section){border-top:0}
  .body :global(section>h2){display:none}
</style>
