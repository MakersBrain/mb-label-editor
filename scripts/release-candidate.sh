#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
test -z "$(git status --porcelain)" || { echo 'release candidate requires a clean Git tree' >&2; exit 1; }
version=$(node -p "require('./packages/label-editor/package.json').version")
test "$version" = "$(node -p "require('./apps/pwa/package.json').version")"
test -z "${RELEASE_TAG:-}" || test "$RELEASE_TAG" = "v$version"
npm run check
npm test
npm run check:licenses
npm run check:workflows
npm run build
npm run test:package
npm run test:pwa-release
artifacts="$root/release-artifacts"
rm -rf "$artifacts"
mkdir "$artifacts"
npm pack --workspace @makersbrain/label-editor --json --pack-destination "$artifacts" > "$artifacts/package-pack.json"
npm sbom --workspace @makersbrain/label-editor --sbom-format cyclonedx > "$artifacts/label-editor-$version.cdx.json"
npm sbom --workspace @makersbrain/label-editor-pwa --sbom-format cyclonedx > "$artifacts/label-editor-pwa-$version.cdx.json"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -C apps/pwa/dist -cf - . | gzip -n > "$artifacts/mb-label-editor-pwa-$version.tar.gz"
git archive --format=tar --prefix="mb-label-editor-$version/" HEAD | gzip -n > "$artifacts/mb-label-editor-source-$version.tar.gz"
cp LICENSE README.md CHANGELOG.md VERSIONING.md THIRD_PARTY_NOTICES.md "$artifacts/"
(cd "$artifacts" && find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%f\0' | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo "release candidate $version written to $artifacts"
