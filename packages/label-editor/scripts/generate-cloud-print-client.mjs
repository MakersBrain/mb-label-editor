// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? process.env.MB_PRINT_CLOUD_OPENAPI ?? resolve(root, 'openapi/mb-print-cloud.json');
const output = resolve(root, 'src/lib/cloud-print/schema.ts');
const command = resolve(root, '../../node_modules/.bin/openapi-typescript');
const result = spawnSync(command, [source, '--output', output], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
