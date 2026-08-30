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

The PWA uses `http://127.0.0.1:8766` as its default asset-catalogue URL. Set
`VITE_ASSET_CATALOG_URL` during the build to choose another default; users can
override or disable it in the File menu. Configure that service with the exact
PWA origin through repeatable `--cors-origin` flags. When bearer authentication
is enabled, previews and font/asset downloads are fetched through the client so
the token never needs to appear in a URL.

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
