// SPDX-License-Identifier: AGPL-3.0-or-later
import { basename } from 'node:path';
import { legacyComponents } from '../../svelte.legacy.mjs';

/** Runes mode is mandatory; the allow-list only shrinks (see scripts/check-runes.mjs). */
export default { compilerOptions: { runes: ({ filename }) => !legacyComponents.has(basename(filename)) } };
