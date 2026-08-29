// SPDX-License-Identifier: AGPL-3.0-or-later
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  build: { lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index', cssFileName: 'style' }, rollupOptions: { external: (id) => id === 'svelte' || id.startsWith('svelte/') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
});
