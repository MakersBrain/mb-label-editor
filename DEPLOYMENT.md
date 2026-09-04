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

For the Access-protected development Docker deployment, serve the asset API at
same-origin `/v1/` with `Cache-Control: no-store`, keep the service worker away
from `/v1/` and all cross-origin requests, and preserve the printer service's
loopback bind. Give the editor container `ASSET_CATALOG_API_KEY` as well: its
nginx injects that bearer token into `/v1/` requests that carry Cloudflare's
`Cf-Access-Authenticated-User-Email` header and no token of their own, so an
Access-authenticated user needs no session token in the editor. Requests without
the Access header, or an image started without the key, still reach the
catalogue unauthenticated and receive its 401. Cloudflare Access protects network delivery but does not erase
an already installed offline shell or browser-local documents.
