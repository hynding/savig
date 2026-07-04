import { vi, beforeEach, it, expect } from 'vitest';
import { useEditor } from './store/store';

// Capture saveBytesToDisk calls; keep renderSvgDocument real (pure, browser-safe).
const { saveBytesToDisk } = vi.hoisted(() => ({ saveBytesToDisk: vi.fn(async () => {}) }));
vi.mock('@savig/services', async (orig) => ({
  ...(await orig<typeof import('@savig/services')>()),
  saveBytesToDisk,
}));

import { exportSvg } from './fileOps';

beforeEach(() => {
  saveBytesToDisk.mockClear();
  useEditor.getState().newProject();
});

it('exportSvg renders the project to SVG markup and saves it as a .svg file', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  await exportSvg();
  expect(saveBytesToDisk).toHaveBeenCalledOnce();
  const [bytes, name, mime] = saveBytesToDisk.mock.calls[0];
  expect(name).toMatch(/\.svg$/);
  expect(mime).toBe('image/svg+xml');
  const markup = new TextDecoder().decode(bytes as Uint8Array);
  expect(markup).toContain('<svg');
});
