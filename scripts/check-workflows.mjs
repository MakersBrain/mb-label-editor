// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const directory = new URL('.github/workflows/', root);
const files = (await readdir(directory)).filter((name) => /\.ya?ml$/.test(name));
const errors = [];

for (const name of files) {
  const workflow = await readFile(new URL(name, directory), 'utf8');
  for (const match of workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
    const value = match[1];
    if (value.startsWith('./')) continue;
    if (!/@[0-9a-f]{40}$/.test(value)) {
      errors.push(`${name}: action is not pinned to a full commit: ${value}`);
    }
  }
  if (!workflow.startsWith('# SPDX-License-Identifier: AGPL-3.0-or-later')) {
    errors.push(`${name}: missing SPDX header`);
  }
}

const pin = (await readFile(new URL('.github/sdk-ref', root), 'utf8')).trim();
if (!/^[0-9a-f]{40}$/.test(pin)) errors.push('.github/sdk-ref must be a full commit SHA of an mb-printer-sdk commit on main');

for (const name of files) {
  const workflow = await readFile(new URL(name, directory), 'utf8');
  if (!workflow.includes('MakersBrain/mb-printer-sdk')) continue;
  // Building against the SDK's moving main makes an editor run fail whenever a
  // change spans both repositories and the SDK half has not landed yet.
  if (!workflow.includes("ref: '${{ steps.sdk.outputs.ref }}'")) {
    errors.push(`${name}: the mb-printer-sdk checkout must use the commit pinned in .github/sdk-ref`);
  }
  if (!workflow.includes('compare/main...')) {
    errors.push(`${name}: the pinned SDK commit must be checked against the SDK's main`);
  }
}

const release = await readFile(new URL('release.yml', directory), 'utf8');
for (const required of [
  'contents: write',
  'id-token: write',
  'attestations: write',
  'https://registry.npmjs.org',
  'release:candidate',
  'attest-build-provenance',
]) {
  if (!release.includes(required)) errors.push(`release.yml: missing ${required}`);
}

const deploy = await readFile(new URL('deploy-pages.yml', directory), 'utf8');
for (const required of [
  'pages: write',
  'id-token: write',
  'artifact.tar',
  'name: github-pages',
  'deploy-pages',
]) {
  if (!deploy.includes(required)) errors.push(`deploy-pages.yml: missing ${required}`);
}

if (errors.length) throw new Error(errors.join('\n'));
console.log(
  `${files.length} workflow files satisfy SPDX, pinned-action, registry, provenance, and Pages policy`,
);
