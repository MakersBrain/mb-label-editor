// SPDX-License-Identifier: AGPL-3.0-or-later
import { svelte } from '@sveltejs/vite-plugin-svelte'; import { defineConfig,searchForWorkspaceRoot } from 'vite'; import { execSync } from 'node:child_process';
/** Short commit identifier shown in the editor footer; MB_BUILD_TAG overrides git for builds without a repository. */
function buildTag():string{const explicit=process.env.MB_BUILD_TAG?.trim();if(explicit)return explicit;return gitShortHash(process.cwd())??'dev'}
const siblingDepth=import.meta.url.includes('/.worktrees/')?'../../../../../':'../../../';
const gitShortHash=(cwd:string):string|undefined=>{try{return execSync('git rev-parse --short=8 HEAD',{cwd,stdio:['ignore','pipe','ignore']}).toString().trim()||undefined}catch{return undefined}};
export default defineConfig({ base:'./',define:{__MB_BUILD_TAG__:JSON.stringify(buildTag())},plugins:[svelte()], server:{host:'127.0.0.1',fs:{allow:[searchForWorkspaceRoot('.'),new URL(`${siblingDepth}mb-printer-sdk`,import.meta.url).pathname,new URL(`${siblingDepth}mb-ui`,import.meta.url).pathname]}}, build:{target:'es2022'} });
