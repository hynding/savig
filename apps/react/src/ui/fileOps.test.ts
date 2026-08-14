import { afterEach, vi, beforeEach, describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { createProject, promoteToMultiScene } from '@savig/engine';
import { saveSavig } from '@savig/services';
import { renderAnimatedSvgDocument } from '@savig/services/export/animatedSvg';
import { useEditor } from './store/store';

// Capture saveBytesToDisk calls; keep renderSvgDocument real (pure, browser-safe).
const { saveBytesToDisk } = vi.hoisted(() => ({
  saveBytesToDisk: vi.fn(async (_bytes: Uint8Array, _name: string, _mime?: string) => {}),
}));
vi.mock('@savig/services', async (orig) => ({
  ...(await orig<typeof import('@savig/services')>()),
  saveBytesToDisk,
}));

import { exportAnimatedSvg, exportSvg, openProject } from './fileOps';

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

it('exports a MULTI-SCENE project without blanking (routes via renderProjectDocument)', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  // Promote to multi-scene: shapes now live in scenes[].objects, root objects is empty.
  useEditor.getState().commit(promoteToMultiScene(useEditor.getState().history.present));
  expect(useEditor.getState().history.present.objects).toEqual([]);
  await exportSvg();
  const markup = new TextDecoder().decode(saveBytesToDisk.mock.calls[0][0] as Uint8Array);
  // The scene's shape must be rendered — renderSvgDocument alone would emit an empty body here.
  expect(markup).toContain('data-savig-object');
});

it('exportAnimatedSvg saves a .svg containing SMIL animation for an animated project', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const objId = useEditor.getState().selectedObjectId!;
  useEditor.getState().seek(0);
  useEditor.getState().setProperty('x', 0);
  useEditor.getState().seek(1);
  useEditor.getState().setProperty('x', 100);
  expect(useEditor.getState().history.present.objects.find((o) => o.id === objId)?.tracks.x).toHaveLength(2);
  await exportAnimatedSvg();
  expect(saveBytesToDisk).toHaveBeenCalledOnce();
  const [bytes, name, mime] = saveBytesToDisk.mock.calls[0];
  expect(name).toMatch(/\.svg$/);
  expect(mime).toBe('image/svg+xml');
  const markup = new TextDecoder().decode(bytes as Uint8Array);
  expect(markup).toContain('animateTransform');
});

// Drives openProject through a stubbed window.showOpenFilePicker — openBytesFromDisk
// prefers the picker over the <input> fallback, so this is deterministic under jsdom.
// File-like stub (name + arrayBuffer only, no real File): jsdom's File.arrayBuffer hangs
// under this runner (see fileAccess.test.ts), and that's all the production code reads.
function stubPicker(name: string, bytes: Uint8Array): void {
  const file = { name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const handle = { getFile: async () => file };
  (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = vi.fn(async () => [handle]);
}

afterEach(() => {
  delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
});

describe('openProject', () => {
  it('opens an exported animated SVG as the full project (round-trip)', async () => {
    const project = createProject({ name: 'RoundTrip' });
    stubPicker('roundtrip.svg', strToU8(renderAnimatedSvgDocument(project)));
    await openProject();
    expect(useEditor.getState().history.present.meta.name).toBe('RoundTrip');
  });

  it('still opens .savig zips', async () => {
    const project = createProject({ name: 'ZipOpen' });
    stubPicker('p.savig', saveSavig({ project, binaries: {} }));
    await openProject();
    expect(useEditor.getState().history.present.meta.name).toBe('ZipOpen');
  });

  it('wraps a plain SVG as a new project with one svg-asset object', async () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="10" height="10"/></svg>';
    stubPicker('drawing.svg', strToU8(src));
    await openProject();
    const p = useEditor.getState().history.present;
    expect(p.meta.name).toBe('drawing');
    expect(p.meta.width).toBe(320);
    expect(p.meta.height).toBe(200);
    expect(p.assets).toHaveLength(1);
    expect(p.assets[0].kind).toBe('svg');
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0].assetId).toBe(p.assets[0].id);
  });

  it('surfaces unreadable files as an error toast, project untouched', async () => {
    const before = useEditor.getState().history.present;
    stubPicker('junk.bin', strToU8('not an svg'));
    await openProject();
    expect(useEditor.getState().history.present).toBe(before);
    const toasts = useEditor.getState().toasts;
    expect(toasts.some((t) => t.kind === 'error')).toBe(true);
  });
});
