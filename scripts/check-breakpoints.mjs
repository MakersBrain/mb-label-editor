// SPDX-License-Identifier: AGPL-3.0-or-later
// Every width media query, in CSS or in a `MediaQuery(...)` call, must use the
// breakpoint scale documented at the top of packages/label-editor/src/core.css.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const scale = new Set(['40rem', '48rem', '64rem', '90rem']);
const sources = ['packages/label-editor/src', 'apps/pwa/src'];
const errors = [];

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(svelte|css|ts|html)$/.test(entry.name)) yield path;
  }
}

for (const source of sources) {
  for await (const file of walk(join(root, source))) {
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      const query = line.match(/@media\s*([^{]+)\{|MediaQuery\(\s*['"`]([^'"`]+)['"`]/);
      if (!query) return;
      const expression = query[1] ?? query[2];
      for (const match of expression.matchAll(/(min|max)-width:\s*([0-9.]+[a-z]+)/g)) {
        if (!scale.has(match[2]))
          errors.push(
            `${file.slice(root.length)}:${index + 1}: ${match[0]} is not on the breakpoint scale (${[...scale].join(', ')})`,
          );
      }
    });
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Every width media query uses the breakpoint scale.');
