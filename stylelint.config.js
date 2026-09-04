// SPDX-License-Identifier: AGPL-3.0-or-later
// Design-system guardrails: colours only through tokens (hex lives in the
// standalone theme alone), tokens without fallbacks, the z-index and type
// scales inside the editor package, and no !important outside the
// reduced-motion block.
export default {
  ignoreFiles: [
    '**/dist/**',
    '**/node_modules/**',
    '**/.svelte-kit/**',
    '**/.package-consumer-*/**',
    'apps/pwa/public/**',
    'test-results/**',
  ],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
    'declaration-property-value-disallowed-list': { '/.*/': ['/var\\(--mble-[a-z0-9-]+\\s*,/'] },
    'declaration-no-important': true,
  },
  overrides: [
    { files: ['**/*.svelte'], customSyntax: 'postcss-html' },
    {
      files: ['packages/label-editor/src/**/*.{css,svelte}'],
      rules: {
        'declaration-property-value-allowed-list': {
          'z-index': ['/^[012]$/', '/^(calc\\()?var\\(--mble-z-[a-z-]+\\)/'],
          'font-size': ['/^var\\(--mble-text-[a-z0-9-]+\\)$/', 'inherit'],
        },
      },
    },
    {
      files: ['packages/label-editor/src/themes/standalone.css'],
      rules: { 'color-no-hex': null, 'function-disallowed-list': null },
    },
  ],
};
