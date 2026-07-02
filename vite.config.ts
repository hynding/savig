/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  '@savig/engine/color': r('./packages/engine/src/color.ts'),
  '@savig/engine/gradientAnim': r('./packages/engine/src/gradientAnim.ts'),
  '@savig/engine': r('./packages/engine/src/index.ts'),
  '@savig/core/node': r('./packages/core/src/node.ts'),
  '@savig/core': r('./packages/core/src/index.ts'),
  '@savig/services/export/renderDocument': r('./packages/services/src/export/renderDocument.ts'),
  '@savig/services': r('./packages/services/src/index.ts'),
  '@savig/runtime/runtimeSource.generated': r('./packages/runtime/src/runtimeSource.generated.ts'),
  '@savig/runtime/frame': r('./packages/runtime/src/frame.ts'),
  '@savig/runtime': r('./packages/runtime/src/index.ts'),
  '@savig/mcp': r('./src/mcp/server.ts'),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    exclude: ['e2e/**', '**/node_modules/**'],
    environmentMatchGlobs: [
      ['src/ui/**', 'jsdom'],
      ['packages/services/src/**', 'jsdom'],
      ['packages/runtime/src/**', 'jsdom'],
      ['packages/engine/src/geom/svg/**', 'jsdom'], // SVG flatten/operand tests use DOMParser
    ],
    setupFiles: ['./src/test-setup.ts'],
    alias,
  },
});
