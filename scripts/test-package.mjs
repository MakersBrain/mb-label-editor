// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(root, '.package-consumer-'));

try {
  const modules = join(temporary, 'node_modules');
  const scope = join(modules, '@makersbrain');
  await mkdir(scope, { recursive: true });
  let archive = process.env.PACKAGE_TARBALL;
  if (!archive) {
    const { stdout } = await exec('npm', ['pack', '--json', '--pack-destination', temporary], {
      cwd: join(root, 'packages/label-editor'),
      env: { ...process.env, npm_config_cache: join(temporary, 'cache') },
    });
    archive = join(temporary, JSON.parse(stdout)[0].filename);
  }

  const output = join(scope, 'label-editor');
  await mkdir(output);
  await exec('tar', ['-xzf', archive, '-C', output, '--strip-components=1']);
  await symlink(join(root, 'node_modules', 'svelte'), join(modules, 'svelte'), 'dir');

  const manifest = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'));
  if (
    manifest.types !== './dist/index.d.ts' ||
    manifest.exports?.['.']?.svelte !== './dist/index.js' ||
    manifest.publishConfig?.registry !== 'https://registry.npmjs.org/'
  )
    throw new Error('packed package entrypoints or registry are incomplete');
  if (manifest.dependencies?.['@makersbrain/ui'] || manifest.peerDependencies?.['@makersbrain/ui']) {
    throw new Error('standalone editor package must not depend on @makersbrain/ui');
  }
  for (const entry of ['./core.css', './themes/standalone.css', './themes/mb-ui.css']) {
    if (!manifest.exports?.[entry]) throw new Error(`packed package is missing ${entry}`);
    await readFile(join(output, manifest.exports[entry].replace('./', '')), 'utf8');
  }
  const adapter = await readFile(join(output, 'dist/themes/mb-ui.css'), 'utf8');
  if (!adapter.includes('@makersbrain/ui/adapters/shadcn.css')) {
    throw new Error('MB UI adapter must consume the canonical Shadcn token bridge');
  }
  // Both themes must provide the pattern classes: mb-ui by importing patterns.css, standalone by its snapshot.
  const standalone = await readFile(join(output, 'dist/themes/standalone.css'), 'utf8');
  for (const className of [
    '.mb-panel',
    '.mb-tab',
    '.mb-notice',
    '.mb-badge',
    '.mb-empty',
    '.mb-table-wrap',
    '.mb-datalist',
  ]) {
    if (
      !standalone.includes(`${className} `) &&
      !standalone.includes(`${className}{`) &&
      !standalone.includes(`${className},`)
    )
      throw new Error(`standalone theme is missing the ${className} pattern snapshot`);
  }
  if (!adapter.includes('@makersbrain/ui/patterns.css'))
    throw new Error('MB UI theme must import the mb-ui pattern classes');
  for (const name of ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md']) {
    await readFile(join(output, name), 'utf8');
  }

  await writeFile(join(temporary, 'index.html'), '<div id="app"></div><script type="module" src="/main.js"></script>');
  await writeFile(
    join(temporary, 'main.js'),
    "import{mount}from'svelte';import{LabelEditor,createEditorStore,defaultDocument}from'@makersbrain/label-editor';import'@makersbrain/label-editor/core.css';import'@makersbrain/label-editor/themes/standalone.css';mount(LabelEditor,{target:document.querySelector('#app'),props:{editor:createEditorStore(defaultDocument())}});",
  );
  await build({
    root: temporary,
    logLevel: 'silent',
    plugins: [svelte()],
    build: { outDir: join(temporary, 'consumer-dist') },
  });
  await readFile(join(temporary, 'consumer-dist', 'index.html'), 'utf8');
  console.log('dependency-free standalone and optional MB UI package boundaries passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
