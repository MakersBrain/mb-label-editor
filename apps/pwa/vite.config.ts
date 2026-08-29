// SPDX-License-Identifier: AGPL-3.0-or-later
import { svelte } from '@sveltejs/vite-plugin-svelte'; import { defineConfig } from 'vite';
export default defineConfig({ base:'./',plugins:[svelte()], server:{host:'127.0.0.1'}, build:{target:'es2022'} });
