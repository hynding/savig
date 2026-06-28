/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    exclude: ['e2e/**', 'node_modules/**'],
    environmentMatchGlobs: [
      ['src/ui/**', 'jsdom'],
      ['src/services/**', 'jsdom'],
      ['src/runtime/**', 'jsdom'],
      ['src/engine/geom/svg/**', 'jsdom'], // SVG flatten/operand tests use DOMParser
    ],
    setupFiles: ['./src/test-setup.ts'],
  },
});
