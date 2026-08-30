// SPDX-License-Identifier: AGPL-3.0-or-later
import { svelte } from '@sveltejs/vite-plugin-svelte'; import { defineConfig,searchForWorkspaceRoot } from 'vite';
const siblingDepth=import.meta.url.includes('/.worktrees/')?'../../../../../':'../../../';
export default defineConfig({ base:'./',plugins:[svelte()], server:{host:'127.0.0.1',fs:{allow:[searchForWorkspaceRoot('.'),new URL(`${siblingDepth}mb-printer-sdk`,import.meta.url).pathname,new URL(`${siblingDepth}mb-ui`,import.meta.url).pathname]}}, build:{target:'es2022'} });
