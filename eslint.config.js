import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist',
      'packages/runtime/src/runtimeSource.generated.ts',
      '.remember',
      'test-results',
      'playwright-report',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Underscore-prefixed params mark intentionally unused args (mock signatures etc.).
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node build scripts run outside the browser/TS-checked source tree.
    files: ['scripts/**/*.mjs', 'packages/*/scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
);
