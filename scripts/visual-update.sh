#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Renders the visual baselines inside the Playwright image pinned to the
# installed Playwright version, so the PNGs come from the same Linux Chromium
# CI compares against. The workspace's sibling checkouts (mb-ui, the printer
# SDK) are linked relatively, so the parent directory is mounted at its own path.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('@playwright/test/package.json').version")
parent=$(dirname "$PWD")
exec docker run --rm --network host --ipc=host \
  -u "$(id -u):$(id -g)" -e HOME=/tmp -e VISUAL=1 -e PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-4173}" \
  -v "$parent:$parent" -w "$PWD" \
  "mcr.microsoft.com/playwright:v${version}-noble" \
  npx playwright test tests/browser/visual.spec.ts "$@"
