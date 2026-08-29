<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Install and deploy

Run `npm ci`, `npm run check`, `npm test`, `npm run check:licenses`, then
`npm run build`. Deploy all of `apps/pwa/dist` at one HTTPS origin with an HTML
navigation fallback and short caching for `sw.js`. HTTPS or localhost is
required for device APIs, service workers, and Local Network Access.

Include the `@makersbrain/printer-sdk` WASM package. The local route expects
`mb-printer api` at `127.0.0.1:9847` with the deployed origin allowlisted.
Public deployments may contain only publication-policy output; private
collections stay in browser IndexedDB.
