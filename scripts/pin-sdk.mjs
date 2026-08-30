// SPDX-License-Identifier: AGPL-3.0-or-later
// Records the SDK commit this repository builds against.
//
//   npm run sdk:pin                     # whatever ../mb-printer-sdk has on main
//   npm run sdk:pin -- <commit>         # an explicit commit
//
// The commit has to be on the SDK's main, so a change spanning both
// repositories lands in the SDK first and the editor then follows it.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const sdk = new URL('../mb-printer-sdk/', root).pathname;
const git = (...args) => execFileSync('git', ['-C', sdk, ...args], { encoding: 'utf8' }).trim();

const requested = process.argv[2];
let commit;
try {
  commit = git('rev-parse', requested ?? 'main');
} catch {
  console.error(`Cannot read ${requested ?? 'main'} from ${sdk}. Clone mb-printer-sdk beside this repository.`);
  process.exit(1);
}
if (!/^[0-9a-f]{40}$/.test(commit)) { console.error(`Not a commit: ${commit}`); process.exit(1); }

try {
  git('merge-base', '--is-ancestor', commit, 'origin/main');
} catch {
  console.error(`${commit} is not on mb-printer-sdk origin/main. Merge the SDK change first.`);
  process.exit(1);
}

await writeFile(new URL('.github/sdk-ref', root), `${commit}\n`);
console.log(`Pinned mb-printer-sdk to ${commit}`);
