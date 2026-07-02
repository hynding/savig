import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  projects: [
    // React runs the FULL suite — the existing editor specs (which drive the React UI) plus the
    // cross-app @portable spec.
    { name: 'react', use: { baseURL: 'http://localhost:5173' } },
    // The Svelte PoC runs ONLY the @portable spec(s): the thin PoC doesn't reproduce the full
    // editor UI the other specs drive, but it satisfies the same neutral render/seek contract.
    { name: 'svelte', use: { baseURL: 'http://localhost:5174' }, testMatch: /portable-.*\.spec\.ts$/ },
  ],
  webServer: [
    { command: 'pnpm dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'pnpm --filter @savig/app-svelte dev', url: 'http://localhost:5174', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
