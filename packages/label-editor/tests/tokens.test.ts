// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `new URL(import.meta.url)` is rewritten in web transform mode, so find the repository from the working directory.
function repositoryRoot(): string {
  let directory = process.cwd();
  while (!existsSync(join(directory, 'packages/label-editor/package.json'))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error('repository root not found');
    directory = parent;
  }
  return directory + '/';
}
const root = repositoryRoot();
const standalonePath = join(root, 'packages/label-editor/src/themes/standalone.css');
const adapterPath = join(root, 'packages/label-editor/src/themes/mb-ui.css');

function walk(directory: string, out: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(svelte|css)$/.test(name) && !path.includes('/themes/')) out.push(path);
  }
  return out;
}
const sources = [...walk(join(root, 'packages/label-editor/src')), ...walk(join(root, 'apps/pwa/src'))];
const standalone = readFileSync(standalonePath, 'utf8');
const adapter = readFileSync(adapterPath, 'utf8');

/** Token names declared in one CSS block. */
const declared = (css: string) => new Set([...css.matchAll(/(--mble-[a-z0-9-]+):/g)].map((match) => match[1]));
const [lightBlock, systemDarkBlock, chosenDarkBlock] = standalone.split(
  /@media \(prefers-color-scheme: dark\)|:root\[data-theme='dark'\]/,
);
const light = declared(lightBlock);
const dark = declared(systemDarkBlock);
/** Declarations of one block as `name: value` lines, for comparing the two dark blocks. */
const declarations = (css: string) =>
  [...css.matchAll(/(--mble-[a-z0-9-]+):\s*([^;]+);/g)].map((match) => `${match[1]}: ${match[2].trim()}`).sort();
const mapped = declared(adapter);
/** Theme-independent scales (type, z-index) are declared in core.css and need no dark or adapter values. */
const scales = declared(readFileSync(join(root, 'packages/label-editor/src/core.css'), 'utf8'));
const referenced = new Map<string, string[]>();
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/var\((--mble-[a-z0-9-]+)/g)) {
    const list = referenced.get(match[1]) ?? [];
    list.push(file.slice(root.length));
    referenced.set(match[1], list);
  }
}
/** Theme-independent scales live only in the light block; dark redefines colours and shadows. */
const themeIndependent = /^--mble-(radius|font)-/;

describe('design tokens', () => {
  it('declares every referenced token in the standalone light theme and maps it in the mb-ui adapter', () => {
    const missingLight = [...referenced.keys()].filter((token) => !light.has(token) && !scales.has(token));
    const missingAdapter = [...referenced.keys()].filter((token) => !mapped.has(token) && !scales.has(token));
    expect(missingLight).toEqual([]);
    expect(missingAdapter).toEqual([]);
  });
  it('repeats the same dark values for the system preference and the explicit choice', () => {
    expect(systemDarkBlock).toContain(":root:not([data-theme='light']) .mb-label-editor");
    expect(declarations(chosenDarkBlock)).toEqual(declarations(systemDarkBlock));
    expect(declarations(chosenDarkBlock).length).toBeGreaterThan(20);
  });
  it('redefines every colour token for dark mode', () => {
    const missingDark = [...light].filter((token) => !themeIndependent.test(token) && !dark.has(token));
    expect(missingDark).toEqual([]);
    const extraDark = [...dark].filter((token) => !light.has(token));
    expect(extraDark).toEqual([]);
  });
  it('declares no token nothing references', () => {
    // Declared ahead of the pattern adoption (type scale, tinted notices and badges); emptied as those land.
    const adoptedLater = new Set([
      '--mble-text-subtle',
      '--mble-primary-hover',
      '--mble-primary-tint',
      '--mble-primary-border',
      '--mble-danger-tint',
      '--mble-guide-tint',
      '--mble-radius-full',
      '--mble-font-display',
    ]);
    const unused = [...light, ...scales].filter((token) => !referenced.has(token) && !adoptedLater.has(token));
    expect(unused).toEqual([]);
  });
  it('uses tokens without fallbacks', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/var\(--mble-[a-z0-9-]+,/g))
        offenders.push(`${file.slice(root.length)}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });
  it('keeps colour literals out of components', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (
          /#[0-9a-fA-F]{3,8}\b(?![^"'`]*["'`]\s*[),;])/.test(line) &&
          /(color|background|border|shadow|fill|stroke|gradient)/i.test(line)
        )
          offenders.push(`${file.slice(root.length)}:${index + 1}: ${line.trim()}`);
        if (/\b(rgba?|hsla?)\(/.test(line)) offenders.push(`${file.slice(root.length)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
