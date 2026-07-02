import { test, expect } from '@playwright/test';

// A framework-neutral fixture (plain JSON matching the engine's Project shape): a rect whose x
// animates 0 -> 100 over 1s. Loaded into whichever app is under test via window.savigLoadProject.
const FIXTURE = {
  meta: { name: 'portable', width: 1280, height: 720, fps: 30, duration: 0, durationMode: 'auto', loop: false, version: 5 },
  assets: [{ id: 'rect', kind: 'vector', name: 'Rectangle', shapeType: 'rect', style: { fill: '#cccccc', stroke: 'none', strokeWidth: 0 } }],
  objects: [
    {
      id: 'oa',
      name: 'Object',
      assetId: 'rect',
      zOrder: 0,
      anchorX: 0,
      anchorY: 0,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 100, easing: 'linear' }] },
      shapeBase: { width: 40, height: 30 },
    },
  ],
  audioClips: [],
};

// THE swappability proof. This one spec runs against BOTH the React app (project "react", :5173)
// and the Svelte PoC (project "svelte", :5174). Both expose the same window.savigLoadProject /
// window.savigSeek contract and both paint through the identical computeFrame + applyFrameToNodes,
// so the seeked `transform` on the shared `[data-savig-object]` wrapper is byte-identical by
// construction — the UI framework is irrelevant to the rendered result.
test('renders + seeks a keyframed object identically across apps @portable', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as unknown as { savigLoadProject?: unknown }).savigLoadProject === 'function',
  );
  await page.evaluate((p) => (window as unknown as { savigLoadProject: (x: unknown) => void }).savigLoadProject(p), FIXTURE);
  await page.waitForSelector('[data-savig-object="oa"]');

  // Seek + read in ONE evaluate (single JS task) so no RAF/React-commit can repaint between them.
  const transformAt = (t: number): Promise<string | null> =>
    page.evaluate((tt) => {
      (window as unknown as { savigSeek: (x: number) => void }).savigSeek(tt);
      return document.querySelector('[data-savig-object="oa"]')!.getAttribute('transform');
    }, t);

  // The wrapper transform's first translate is the object's position; x follows the linear track.
  expect(await transformAt(0)).toBe('translate(0, 0) rotate(0, 0, 0) translate(0, 0) scale(1, 1) translate(0, 0)');
  expect(await transformAt(0.5)).toContain('translate(50, 0)');
  expect(await transformAt(1)).toContain('translate(100, 0)');
});
