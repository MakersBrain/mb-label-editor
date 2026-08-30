// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? process.env.ASSET_CATALOG_OPENAPI ?? resolve(root, 'openapi/asset-catalog.json');
const output = resolve(root, 'src/lib/asset-catalog/schema.ts');
const command = resolve(root, '../../node_modules/.bin/openapi-typescript');
const result = spawnSync(command, [source, '--output', output], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
