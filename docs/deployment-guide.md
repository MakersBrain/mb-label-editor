<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Deployment guide

Run `npm ci`, `npm run check`, `npm test`, `npm run check:licenses`,
`npm run build`, and the Chromium acceptance suite. Deploy every file under
`apps/pwa/dist` at one HTTPS origin. Serve `.wasm` as `application/wasm`, keep
`sw.js` on a short cache lifetime, and route navigation requests to
`index.html`. Do not publish source private `.mb-assets`, credentials, APK
extractions, paid assets, or browser IndexedDB data.

Configure the local service allowlist with the exact deployed origin. Keep its
listener on loopback, preserve Host/origin/CORS/Private-Network-Access checks,
and do not place an unauthenticated proxy in front of it. Revoke grants when an
origin is retired.

The PWA creates an `mbprint-asset-catalog` connection for
`http://127.0.0.1:8766` by default. Set `VITE_ASSET_CATALOG_URL` during the build
to choose another initial endpoint. Users manage named external-resource
connections in the File menu; provider kind, endpoint, enabled state, and the
active connection are stored locally, while bearer tokens remain session-only.
Configure every service with the exact PWA origin through its CORS settings.
Previews and font/asset downloads pass through the selected provider so a token
never needs to appear in a URL.

The MakersBrain development Docker stack instead builds
`VITE_ASSET_CATALOG_URL` as the complete editor origin and proxies `/v1/` from
nginx to the private asset-catalogue container. Keep that proxy non-cacheable,
require the asset bearer key for tunneled use, and exclude `/v1/` from the
service worker. The service worker must also bypass all cross-origin requests
so loopback printer traffic is initiated by the active document's Local
Network Access permission rather than by a worker.

When Cloudflare Access protects the PWA, it gates online navigation,
installation, updates, and API traffic. It cannot revoke an application shell
that an authorized browser has already installed for offline use. Treat that
cache and browser IndexedDB as device-local data and rely on device/profile
security when access is withdrawn.

For standalone cloud printing, publish `mb-print-cloud` behind HTTPS and add
the PWA's exact origin to its `cors_origins` config list. The user enters the
service URL, tenant ID, and a `print`-only token in the Cloud printers dialog.
The PWA stores the URL, tenant, and selected printer but keeps the token only in
memory, so a reload requires reauthentication. Do not inject a static cloud
token at build time. Products with an existing authenticated backend may use a
same-origin proxy or the client's access-token callback instead.

Release tags must match package versions. Preserve the AGPL license, notices,
source archive, dependency inventory, checksums, and provenance artifacts next
to the npm package and PWA build. Roll back by redeploying the prior immutable
artifact; clients pick it up when the service worker refreshes.

The canonical registry for `@makersbrain/label-editor` is public npmjs, not
GitHub Packages. Before tagging, run `npm run release:candidate` with
`CHROMIUM_PATH` set when the Playwright-managed browser is unavailable. The
command verifies a clean Svelte consumer and an offline installation below
`/mb-label-editor/`, then creates deterministic source/PWA archives, package
tarball, CycloneDX SBOMs, notices, and `SHA256SUMS` in `release-artifacts/`.
