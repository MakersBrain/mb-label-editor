<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
let { name }: { name: 'text'|'rectangle'|'ellipse'|'triangle'|'line'|'barcode'|'qr'|'undo'|'redo'|'delete'|'group'|'ungroup' } = $props();
const paths:Record<string,string>={
  text:'M3 3.75h10M8 3.75v8.5M5.75 12.25h4.5',
  rectangle:'M2.75 4.25h10.5v7.5H2.75z',
  ellipse:'M13.25 8a5.25 3.75 0 11-10.5 0 5.25 3.75 0 0110.5 0z',
  triangle:'M8 3.25l5.25 9.5H2.75z',
  line:'M2.75 12.75l10.5-9.5',
  barcode:'M3 3.5v9M5.25 3.5v9M7 3.5v9M9.25 3.5v9M11 3.5v9M13 3.5v9',
  qr:'M2.75 2.75h4v4h-4zM9.25 2.75h4v4h-4zM2.75 9.25h4v4h-4zM9.25 9.25h1.5v1.5h-1.5zM11.75 11.75h1.5v1.5h-1.5z',
  undo:'M6 4.25L2.75 7.5 6 10.75M2.75 7.5h6.75a3.75 3.75 0 010 7.5',
  redo:'M10 4.25l3.25 3.25L10 10.75M13.25 7.5H6.5a3.75 3.75 0 000 7.5',
  delete:'M3.25 4.75h9.5M6.5 4.75V3.25h3v1.5M5 4.75l.6 8.5h4.8l.6-8.5',
  group:'M2.75 2.75h4v4h-4zM9.25 9.25h4v4h-4zM6.75 4.75h3.5v6.5',
  ungroup:'M2.75 2.75h4v4h-4zM9.25 9.25h4v4h-4z'
};
</script>
<svg class="icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><path d={paths[name]} fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
<style>.icon{flex:none;display:block;opacity:.85}</style>
