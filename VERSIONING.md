<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Versioning and releases

The package uses Semantic Versioning. Schema compatibility and public API
removals require a major release. Compatible features are minor releases and
fixes are patches. A `v*` tag runs all gates and publishes the package. Releases
must pass the licence policy and never contain private or vendor material.

`@makersbrain/label-editor` is published as a public package to the canonical
npm registry (`https://registry.npmjs.org/`) with npm trusted-publishing
provenance. GitHub Releases retain the exact npm tarball, deterministic hosted
PWA and source archives, CycloneDX SBOMs, SHA-256 checksums, notices, and GitHub
build-provenance attestations. GitHub Packages is not a release registry for
this project.
