// SPDX-License-Identifier: AGPL-3.0-or-later
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteConfig from './packages/label-editor/svelte.config.js';

export default ts.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.package-consumer-*/**',
      '**/.worktrees/**',
      '**/.svelte-kit/**',
      'apps/pwa/public/**',
      'packages/label-editor/assets/**',
      'release-artifacts/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ['**/*.ts', '**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { projectService: true, extraFileExtensions: ['.svelte'] } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      'svelte/no-reactive-reassign': 'error',
      'svelte/no-unused-svelte-ignore': 'error',
      'svelte/no-useless-mustaches': 'off',
      // Ratchet: these are warnings while the runes migration is in flight and
      // `npm run lint` caps the count with --max-warnings. Each converted
      // component lowers the cap; they become errors once svelte.legacy.mjs is gone.
      '@typescript-eslint/no-floating-promises': ['warn', { ignoreVoid: false }],
      '@typescript-eslint/no-unused-expressions': 'warn',
      'svelte/require-each-key': 'warn',
      'svelte/prefer-svelte-reactivity': 'warn',
      'svelte/infinite-reactive-loop': 'warn',
    },
  },
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser, svelteConfig } },
    // `let { x } = $props()` and `let y = $derived()` are reassignable by design; the Svelte variant knows that.
    rules: { 'prefer-const': 'off', 'svelte/prefer-const': ['error', { ignoreReadBeforeAssign: true }] },
  },
);
