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
