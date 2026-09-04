// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const wasmRoot = resolve(import.meta.dirname, '../../../mb-printer-sdk/crates/mb-printer-wasm');

test('compiled sibling WASM validates and renders the shared exact PNG/PDF fixture', async () => {
  const generated = join(wasmRoot, 'pkg-node/mb_printer_wasm.js');
  test.skip(!existsSync(generated), 'The sibling SDK has not produced its Node WASM artifact.');
  const directory = await mkdtemp(join(tmpdir(), 'mb-editor-wasm-'));
  try {
    // wasm-pack's node target is CommonJS, while the sibling package is ESM. The
    // .cjs compatibility copy leaves generated code and bytes unchanged.
    const module = join(directory, 'mb_printer_wasm.cjs');
    await copyFile(generated, module);
    await copyFile(join(wasmRoot, 'pkg-node/mb_printer_wasm_bg.wasm'), join(directory, 'mb_printer_wasm_bg.wasm'));
    const smoke = resolve(import.meta.dirname, '../fixtures/wasm-smoke.cjs');
    const fixture = resolve(wasmRoot, '../../fixtures/wasm/equivalence.json');
    const output = execFileSync('node', [smoke, module, fixture], { encoding: 'utf8' });
    expect(output).toContain('Editor Node/WASM exact preview fixture passed');
    if (!existsSync(join(wasmRoot, 'pkg/mb_printer_wasm.js'))) {
      test.info().annotations.push({
        type: 'browser-wasm',
        description: 'Web-target pkg is not generated; browser loading is intentionally unexecuted.',
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
