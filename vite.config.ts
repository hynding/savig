/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  '@savig/engine/color': r('./src/engine/color.ts'),
  '@savig/engine/gradientAnim': r('./src/engine/gradientAnim.ts'),
  '@savig/engine': r('./src/engine/index.ts'),
  '@savig/core/node': r('./src/core/render.ts'),
  '@savig/core': r('./src/core/index.ts'),
  '@savig/services/export/renderDocument': r('./src/services/export/renderDocument.ts'),
  '@savig/services': r('./src/services/index.ts'),
  '@savig/runtime/runtimeSource.generated': r('./src/runtime/runtimeSource.generated.ts'),
  '@savig/runtime/frame': r('./src/runtime/frame.ts'),
  '@savig/runtime': r('./src/runtime/index.ts'),
  '@savig/mcp': r('./src/mcp/server.ts'),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
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
    alias,
  },
});
