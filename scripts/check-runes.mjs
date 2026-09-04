// SPDX-License-Identifier: AGPL-3.0-or-later
// Runes policy: every Svelte component is written in Svelte 5 runes mode.
// The compiler only errors on some legacy syntax (export let, $:) and merely
// warns on the rest (on: directives, <slot>), so this check covers the whole
// contract and keeps the transition allow-list in svelte.legacy.mjs honest.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const sourceRoots = ['packages/label-editor/src', 'apps/pwa/src'];
const configs = ['packages/label-editor/svelte.config.js', 'apps/pwa/svelte.config.js'];
const allowListPath = join(root, 'svelte.legacy.mjs');

/** @typedef {{ line: number; rule: string }} Finding */

const scriptRules = [
  { rule: 'export let', pattern: /^\s*export\s+let\s/m },
  { rule: '$: reactive statement', pattern: /^\s*\$:/m },
  { rule: '$$props / $$restProps / $$slots', pattern: /\$\$(props|restProps|slots)\b/ },
  { rule: 'createEventDispatcher', pattern: /\bcreateEventDispatcher\s*\(/ },
  { rule: 'svelte/store import', pattern: /from\s+['"]svelte\/store['"]/ },
  { rule: 'svelte/legacy import', pattern: /from\s+['"]svelte\/legacy['"]/ },
];
const markupRules = [
  { rule: 'on: directive', pattern: /\son:[a-zA-Z]+(?:\|[a-zA-Z]+)*\s*=/ },
  { rule: '<slot>', pattern: /<slot(\s|>|\/)/ },
];
const optOutRule = {
  rule: '<svelte:options runes={false}>',
  pattern: /<svelte:options\b[^>]*\brunes\s*=\s*\{\s*false\s*\}/,
};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.name.endsWith('.svelte')) files.push(path);
  }
  return files;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/** Splits a component into instance script blocks and markup (scripts and styles blanked out). */
function sections(source) {
  const scripts = [];
  let markup = source;
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  for (const match of source.matchAll(scriptPattern)) {
    const attributes = match[1];
    const isModule = /\b(context\s*=\s*["']module["']|module)\b/.test(attributes);
    if (!isModule) scripts.push({ body: match[2], offset: match.index + match[0].indexOf(match[2]) });
    markup = markup.replace(match[0], ' '.repeat(match[0].length));
  }
  markup = markup.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, (block) => ' '.repeat(block.length));
  return { scripts, markup };
}

/** @returns {{ findings: Finding[]; optOut: Finding | undefined }} */
function inspect(source) {
  const { scripts, markup } = sections(source);
  const findings = [];
  for (const script of scripts) {
    for (const { rule, pattern } of scriptRules) {
      const match = pattern.exec(script.body);
      if (match) findings.push({ line: lineOf(source, script.offset + match.index), rule });
    }
  }
  for (const { rule, pattern } of markupRules) {
    const match = pattern.exec(markup);
    if (match) findings.push({ line: lineOf(source, match.index), rule });
  }
  const optOutMatch = optOutRule.pattern.exec(markup);
  const optOut = optOutMatch ? { line: lineOf(source, optOutMatch.index), rule: optOutRule.rule } : undefined;
  return { findings, optOut };
}

async function loadAllowList() {
  try {
    await stat(allowListPath);
  } catch {
    return undefined;
  }
  const module = await import(allowListPath);
  return new Set(module.legacyComponents);
}

const errors = [];
const allowList = await loadAllowList();
const files = (await Promise.all(sourceRoots.map((directory) => walk(join(root, directory))))).flat().sort();
const seen = new Set();
let legacyCount = 0;

for (const file of files) {
  const name = basename(file);
  const display = relative(root, file);
  seen.add(name);
  const { findings, optOut } = inspect(await readFile(file, 'utf8'));
  if (optOut)
    errors.push(`${display}:${optOut.line}: ${optOut.rule} is not allowed; every component compiles in runes mode`);
  const listed = allowList?.has(name) ?? false;
  if (findings.length && !listed) {
    errors.push(
      `${display} uses legacy syntax but is not in svelte.legacy.mjs:\n${findings.map((item) => `  line ${item.line}: ${item.rule}`).join('\n')}`,
    );
  } else if (!findings.length && listed) {
    errors.push(`${display} is listed in svelte.legacy.mjs but has no legacy syntax; remove the stale entry`);
  } else if (findings.length) {
    legacyCount++;
  }
}

if (allowList) {
  for (const name of allowList) {
    if (!seen.has(name))
      errors.push(`svelte.legacy.mjs lists ${name}, which does not exist under ${sourceRoots.join(' or ')}`);
  }
} else {
  for (const config of configs) {
    const source = await readFile(join(root, config), 'utf8');
    if (!/compilerOptions:\s*\{\s*runes:\s*true\s*\}/.test(source)) {
      errors.push(`${config} must set compilerOptions: { runes: true } once svelte.legacy.mjs is gone`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n\n'));
  process.exitCode = 1;
} else {
  console.log(`${files.length} components checked, ${legacyCount} still legacy`);
}
