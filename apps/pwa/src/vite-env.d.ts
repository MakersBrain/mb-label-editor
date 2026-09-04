// SPDX-License-Identifier: AGPL-3.0-or-later
/// <reference types="vite/client" />
/** Injected at build time from MB_BUILD_TAG or the git short hash. */
declare const __MB_BUILD_TAG__: string;
/** Present only under `vite --mode test`; see apps/pwa/src/sdk.ts. */
interface Window {
  __mbPerf?: { render: number; measure: number; materialize: number; reset(): void };
}
