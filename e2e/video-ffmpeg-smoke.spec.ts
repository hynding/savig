import { test, expect } from '@playwright/test';

/** Slice-1 verification (spec §6): codec availability, per-format `-c:v copy` segment concat,
 *  and worker/core loading under the Vite dev server — all against the REAL vendored core.
 *  Permanent regression net: if a core upgrade drops a codec or breaks concat, this fails. */
test('ffmpeg.wasm probe: codecs present and segment concat works for both formats', async ({ page }) => {
  test.slow(); // first load fetches the ~31MB core
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const w = window as unknown as { savigProbeFfmpeg: () => Promise<{ codecs: string; concatOk: { mp4: boolean; webm: boolean } }> };
    return await w.savigProbeFfmpeg();
  });
  expect(result.codecs).toContain('libx264');
  expect(result.codecs).toContain('libvpx');
  expect(result.concatOk.mp4).toBe(true);
  expect(result.concatOk.webm).toBe(true);
});
