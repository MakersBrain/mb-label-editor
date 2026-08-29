# MakersBrain label editor

`@makersbrain/label-editor` is the reusable Svelte 5 editor for strict v4
MakersBrain label documents. `apps/pwa` is the installable, offline-capable MB
UI application. Documents and print jobs remain local unless the user selects
the authenticated loopback printing route.

```sh
npm install
npm test
npm run check
npm run build
npm run test:browser
npm run release:candidate
```

The browser suite uses Chromium for open/save, touch/rulers, autosave recovery,
and offline reload. It also starts the real sibling `mb-printer api serve` on
an ephemeral loopback port and tests pair, validate, submit, SSE, poll, cancel,
restart, revocation, CORS, and Private Network Access preflight. If the CLI
binary is not already built, Cargo and access to the sibling
`../mb-printer-cli` workspace are required.

The printer SDK is connected through `PrinterSdk`, a narrow injectable
interface. The production app loads `@makersbrain/printer-sdk`; tests may use a
deterministic in-memory implementation.

The reusable package remains independent of `@makersbrain/ui`: consumers select
`core.css` plus the dependency-free `themes/standalone.css`. The first-party PWA
installs MB UI and selects `themes/mb-ui.css`, which maps the same editor token
contract through MB UI's Shadcn-compatible semantic variables and adds the
canonical `BrandLockup` in the application shell.

The production browser-WASM and Node-WASM artifacts are built from the sibling
SDK and smoke-tested against its shared exact packed-raster, PNG, PDF, and La
Poste fixtures. Web Bluetooth/WebUSB still require explicit browser permission
and physical hardware for the device acceptance matrix.

Operational documentation is in [docs/user-guide.md](docs/user-guide.md),
[docs/device-guide.md](docs/device-guide.md), and
[docs/deployment-guide.md](docs/deployment-guide.md).

Licensed under AGPL-3.0-or-later. See [LICENSE](LICENSE).

The reusable package is released publicly through npmjs. `release:candidate`
performs the local, non-publishing release build and writes reproducible npm,
PWA, source, SBOM, notice, and checksum evidence to `release-artifacts/`.
