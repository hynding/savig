# Browser Video Export (ffmpeg.wasm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a project as MP4 (H.264+AAC) or WebM (VP9+Opus) entirely in the browser — deterministic frames from the shared frame pipeline, master-mix audio, encoded/muxed by single-threaded ffmpeg.wasm — from a new editor Export dialog.

**Architecture:** An orchestrator (`videoExport.ts`) drives three parity-reusing stages: frames via `renderProjectDocument` + `applyProjectFrame` on a detached DOM → canvas JPEG; audio via `createAudioEngine(OfflineAudioContext)` → WAV; encode via a per-run ffmpeg.wasm instance running segment encodes (bounded wasm-FS memory) then a concat+mux pass. Pure argv/WAV builders live in `@savig/services` so a future backend path (M10) reuses them.

**Tech Stack:** `@ffmpeg/ffmpeg` + `@ffmpeg/core` 0.12.x (single-thread), Vite `?url` asset resolution, OfflineAudioContext, React overlay dialog, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-12-browser-video-export-design.md`

## Global Constraints

- Single-threaded ffmpeg core ONLY — no COOP/COEP, no SharedArrayBuffer, no `@ffmpeg/core-mt`.
- No CDN fetches: core assets resolve via Vite `?url` imports from the npm package; the wasm is never committed to git.
- `@ffmpeg/ffmpeg` and `@ffmpeg/util` must be in `optimizeDeps.exclude` in `apps/react/vite.config.ts`.
- Codec args verbatim (spec §6): MP4 `-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p`; WebM `-c:v libvpx-vp9 -crf 32 -b:v 0 -deadline good -cpu-used 5 -pix_fmt yuv420p`; final mux uses **per-stream** flags `-c:v copy` + `-c:a aac -b:a 192k` (MP4, plus `-movflags +faststart`) / `-c:a libopus -b:a 128k` (WebM), `-shortest`; no-audio projects omit the wav input and all `-c:a` flags.
- `SEGMENT_SECONDS = 2`; per-segment frame numbering restarts at 0 (`frame%05d.jpg`, no `-start_number`); each segment's JPEGs are deleted after its encode.
- JPEG intermediate quality 0.92; background default `'white'`; canvas width AND height forced even.
- Clamps: fps 1–60 (default `meta.fps`), width 16–3840 even (default artboard width).
- Export reads a `project` + `binaries` SNAPSHOT captured at dialog-confirm.
- Every per-frame blob URL is revoked after its `<img>` decode.
- All commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run tests with `node_modules/.bin/vitest run <path>` and `node_modules/.bin/playwright test <path>` (pnpm script gate is unreliable for subagents).

## File Structure

| File | Role |
|---|---|
| `packages/services/src/audio/encodeWav.ts` (+`.test.ts`) | Pure Float32 channels → 16-bit PCM WAV bytes |
| `packages/services/src/export/videoArgs.ts` (+`.test.ts`) | Pure segment plan + ffmpeg argv builders (backend-reusable) |
| `apps/react/src/ui/export/ffmpegClient.ts` | Per-run ffmpeg.wasm instance + `probeFfmpeg()` smoke API |
| `apps/react/src/ui/export/frameSource.ts` (+`.test.ts`) | Parse-once frame source (`frameSvg(t)`) + browser rasterizer |
| `apps/react/src/ui/audio/renderMix.ts` (+`.test.ts`) | Offline master-mix render via `createAudioEngine` |
| `apps/react/src/ui/export/videoExport.ts` (+`.test.ts`) | Orchestrator: phases, progress, cancel, cleanup |
| `apps/react/src/ui/components/ExportVideoDialog/ExportVideoDialog.tsx` (+`.test.tsx`, `.module.css`) | Options + progress + cancel overlay |
| `packages/ui-core/src/commands/{types,registry}.ts` | `openExportVideo` host action + palette command |
| `apps/react/src/ui/App.tsx`, `apps/react/src/ui/commandHost.ts` | Overlay wiring + ffmpeg probe hook |
| `e2e/video-ffmpeg-smoke.spec.ts`, `e2e/video-export.spec.ts` | Slice-1 probe + full export journey |

---

### Task 1: ffmpeg client + slice-1 smoke verification

**Files:**
- Modify: `apps/react/package.json` (deps), `apps/react/vite.config.ts` (optimizeDeps)
- Create: `apps/react/src/ui/export/ffmpegClient.ts`
- Modify: `apps/react/src/ui/App.tsx` (probe window hook, next to the existing `savigSeek` test-contract effect)
- Test: `e2e/video-ffmpeg-smoke.spec.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces:
  ```ts
  export interface FfmpegClient {
    writeFile(name: string, data: Uint8Array): Promise<void>;
    /** onProgress receives ffmpeg's 0..1 ratio for THIS exec. */
    exec(args: string[], onProgress?: (p: number) => void): Promise<void>;
    readFile(name: string): Promise<Uint8Array>;
    deleteFile(name: string): Promise<void>;
    terminate(): void;
  }
  export function createFfmpegClient(): Promise<FfmpegClient>;
  export function probeFfmpeg(): Promise<{ codecs: string; concatOk: { mp4: boolean; webm: boolean } }>;
  ```

- [ ] **Step 1: Add dependencies**

```bash
cd apps/react && pnpm add @ffmpeg/ffmpeg@^0.12.15 @ffmpeg/core@^0.12.10 @ffmpeg/util@^0.12.2 && cd ../..
```

- [ ] **Step 2: Vite config — optimizeDeps.exclude**

In `apps/react/vite.config.ts`, add to the returned config object:

```ts
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
```

- [ ] **Step 3: Write the failing smoke e2e**

`e2e/video-ffmpeg-smoke.spec.ts`:

```ts
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
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node_modules/.bin/playwright test e2e/video-ffmpeg-smoke.spec.ts`
Expected: FAIL — `savigProbeFfmpeg is not a function`.

- [ ] **Step 5: Implement `ffmpegClient.ts`**

```ts
// Per-run ffmpeg.wasm instance (spec §3): ONE FFmpeg per export run — clean cancel/FS
// lifecycle; the wasm bytes themselves stay in the browser HTTP cache across runs. Core assets
// resolve via Vite `?url` from the npm package (spec §2 — no CDN, nothing committed).
// Single-threaded core only: no COOP/COEP, no SharedArrayBuffer.
import coreJsUrl from '@ffmpeg/core?url';
import coreWasmUrl from '@ffmpeg/core/wasm?url';

export interface FfmpegClient {
  writeFile(name: string, data: Uint8Array): Promise<void>;
  exec(args: string[], onProgress?: (p: number) => void): Promise<void>;
  readFile(name: string): Promise<Uint8Array>;
  deleteFile(name: string): Promise<void>;
  terminate(): void;
}

export async function createFfmpegClient(): Promise<FfmpegClient> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg'); // lazy: main bundle unaffected
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({ coreURL: coreJsUrl, wasmURL: coreWasmUrl });
  let progressCb: ((p: number) => void) | null = null;
  ffmpeg.on('progress', ({ progress }) => progressCb?.(Math.max(0, Math.min(1, progress))));
  return {
    async writeFile(name, data) {
      await ffmpeg.writeFile(name, data);
    },
    async exec(args, onProgress) {
      progressCb = onProgress ?? null;
      try {
        await ffmpeg.exec(args);
      } finally {
        progressCb = null;
      }
    },
    async readFile(name) {
      const out = await ffmpeg.readFile(name);
      if (typeof out === 'string') throw new Error('ffmpeg: expected binary file');
      return out;
    },
    async deleteFile(name) {
      await ffmpeg.deleteFile(name);
    },
    terminate() {
      ffmpeg.terminate();
    },
  };
}

/** Slice-1 smoke probe (spec §6): -codecs listing + a real 2-segment encode + `-c:v copy`
 *  concat per format, on tiny in-browser canvas frames. Wired to `window.savigProbeFfmpeg`
 *  (the established savigSeek test-contract idiom) and exercised by video-ffmpeg-smoke.spec. */
export async function probeFfmpeg(): Promise<{ codecs: string; concatOk: { mp4: boolean; webm: boolean } }> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  const logs: string[] = [];
  ffmpeg.on('log', ({ message }) => logs.push(message));
  await ffmpeg.load({ coreURL: coreJsUrl, wasmURL: coreWasmUrl });
  await ffmpeg.exec(['-codecs']);
  const codecs = logs.join('\n');

  const jpeg = await tinyJpeg();
  const concatOk = { mp4: false, webm: false };
  for (const format of ['mp4', 'webm'] as const) {
    const codec = format === 'mp4'
      ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']
      : ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p'];
    for (let seg = 0; seg < 2; seg++) {
      for (let i = 0; i < 4; i++) await ffmpeg.writeFile(`frame${String(i).padStart(5, '0')}.jpg`, jpeg);
      await ffmpeg.exec(['-framerate', '4', '-i', 'frame%05d.jpg', '-frames:v', '4', ...codec, `seg_${seg}.${format}`]);
      for (let i = 0; i < 4; i++) await ffmpeg.deleteFile(`frame${String(i).padStart(5, '0')}.jpg`);
    }
    await ffmpeg.writeFile('list.txt', new TextEncoder().encode(`file 'seg_0.${format}'\nfile 'seg_1.${format}'\n`));
    try {
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c:v', 'copy', `out.${format}`]);
      const out = await ffmpeg.readFile(`out.${format}`);
      concatOk[format] = typeof out !== 'string' && out.length > 500;
    } catch {
      concatOk[format] = false;
    }
  }
  ffmpeg.terminate();
  return { codecs, concatOk };
}

async function tinyJpeg(): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a90d9';
  ctx.fillRect(0, 0, 32, 32);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.92),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
```

NOTE: if `@ffmpeg/core?url` / `@ffmpeg/core/wasm?url` fail to resolve (exports-map variance
across 0.12.x), use the deep paths `@ffmpeg/core/dist/esm/ffmpeg-core.js?url` and
`@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url` instead — whichever resolves is fine; keep both
imports in this one file.

- [ ] **Step 6: Wire the probe hook in `App.tsx`**

Inside the existing test-contract `useEffect` (the one that sets `w.savigSeek` / `w.savigLoadProject`), add:

```ts
    (w as unknown as { savigProbeFfmpeg: () => Promise<unknown> }).savigProbeFfmpeg = () =>
      import('./export/ffmpegClient').then((m) => m.probeFfmpeg());
```

- [ ] **Step 7: Run the smoke e2e to verify it passes**

Run: `node_modules/.bin/playwright test e2e/video-ffmpeg-smoke.spec.ts`
Expected: PASS. **If `concatOk.webm` is false**: STOP, report — spec §6 names the fallback (single-pass WebM encode behind a frame cap) and the spec must be amended before Task 3.

- [ ] **Step 8: Full-suite sanity + commit**

Run: `node_modules/.bin/vitest run` and `node_modules/.bin/tsc --noEmit` and `node_modules/.bin/eslint .`
Expected: all green (no unit tests touched; type/lint must accept the new file).

```bash
git add -A && git commit -m "feat(video): ffmpeg.wasm client + slice-1 smoke probe (codecs, per-format concat, vite loading)"
```

---

### Task 2: encodeWav (pure, services)

**Files:**
- Create: `packages/services/src/audio/encodeWav.ts`
- Modify: `packages/services/src/index.ts` (add `export * from './audio/encodeWav';`)
- Test: `packages/services/src/audio/encodeWav.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array` — 16-bit PCM RIFF/WAVE, interleaved, little-endian, clamped to [-1, 1].

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { encodeWav } from './encodeWav';

describe('encodeWav', () => {
  it('emits a valid RIFF/WAVE header for 16-bit stereo PCM', () => {
    const bytes = encodeWav([new Float32Array([0, 0.5]), new Float32Array([0, -0.5])], 44100);
    const ascii = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(2); // channels
    expect(dv.getUint32(24, true)).toBe(44100); // sample rate
    expect(dv.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(36, 4)).toBe('data');
    expect(dv.getUint32(40, true)).toBe(2 * 2 * 2); // frames * channels * 2 bytes
    expect(bytes.length).toBe(44 + 8);
  });

  it('interleaves channels and quantizes with clamping', () => {
    const bytes = encodeWav([new Float32Array([1, 2]), new Float32Array([-1, -2])], 8000);
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(dv.getInt16(44, true)).toBe(32767); // L0: +1 -> max
    expect(dv.getInt16(46, true)).toBe(-32768); // R0: -1 -> min
    expect(dv.getInt16(48, true)).toBe(32767); // L1: +2 clamped
    expect(dv.getInt16(50, true)).toBe(-32768); // R1: -2 clamped
  });

  it('handles mono', () => {
    const bytes = encodeWav([new Float32Array([0.25])], 22050);
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(dv.getUint16(22, true)).toBe(1);
    expect(dv.getInt16(44, true)).toBe(Math.round(0.25 * 32767));
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `node_modules/.bin/vitest run packages/services/src/audio/encodeWav.test.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
/** Pure 16-bit PCM RIFF/WAVE encoder (spec §5): the offline master mix becomes `mix.wav` for
 *  ffmpeg to encode to AAC/Opus. Services-level so a future backend path reuses it (spec §11). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * numCh * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const dv = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * numCh * 2, true); // byte rate
  dv.setUint16(32, numCh * 2, true); // block align
  dv.setUint16(34, 16, true); // bits/sample
  ascii(36, 'data');
  dv.setUint32(40, dataBytes, true);
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][f]));
      dv.setInt16(o, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
      o += 2;
    }
  }
  return bytes;
}
```

- [ ] **Step 4: Run to verify PASS**, then `node_modules/.bin/vitest run packages/services/` (whole package still green).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(video): encodeWav — pure 16-bit PCM WAV encoder in services"`

---

### Task 3: videoArgs (pure, services)

**Files:**
- Create: `packages/services/src/export/videoArgs.ts`
- Modify: `packages/services/src/index.ts` (add `export * from './export/videoArgs';`)
- Test: `packages/services/src/export/videoArgs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact — Task 6 and the M10 backend path build on these):
  ```ts
  export const SEGMENT_SECONDS = 2;
  export type VideoFormat = 'mp4' | 'webm';
  export interface VideoArgsSpec { format: VideoFormat; fps: number; frameCount: number; hasAudio: boolean }
  export function evenDim(n: number): number;                       // floor to even, min 2
  export function segmentPlan(frameCount: number, fps: number): Array<{ index: number; frames: number }>;
  export function segmentName(format: VideoFormat, index: number): string;   // seg_000.mp4
  export function segmentEncodeArgs(spec: VideoArgsSpec, seg: { index: number; frames: number }): string[];
  export function concatListText(spec: VideoArgsSpec): string;      // concat demuxer list.txt body
  export function concatMuxArgs(spec: VideoArgsSpec): string[];     // final pass -> out.<format>
  export const WEBM_MAX_FRAMES: number;                              // 1800 (spec §6 amendment)
  export function singlePassArgs(spec: VideoArgsSpec): string[];     // webm: ONE exec, frames [+wav] -> out.webm
  export function videoMime(format: VideoFormat): string;
  ```
  RULING carried from Task 1 (spec §6 amendment): WebM encodes SINGLE-PASS (vp9 on this wasm
  core traps on a second exec per instance) behind `WEBM_MAX_FRAMES = 1800`; MP4 stays
  segmented. Keep the generic webm segment/concat builders AND their tests — the M10 native
  backend can use them; add `singlePassArgs` + `WEBM_MAX_FRAMES` alongside.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { SEGMENT_SECONDS, WEBM_MAX_FRAMES, concatListText, concatMuxArgs, evenDim, segmentEncodeArgs, segmentName, segmentPlan, singlePassArgs, videoMime } from './videoArgs';

describe('evenDim', () => {
  it('floors to even with a floor of 2', () => {
    expect(evenDim(1921)).toBe(1920);
    expect(evenDim(1920)).toBe(1920);
    expect(evenDim(1)).toBe(2);
  });
});

describe('segmentPlan', () => {
  it('splits frames into SEGMENT_SECONDS-sized segments with a short tail', () => {
    // 30fps, 5s -> 150 frames -> segments of 60,60,30
    expect(segmentPlan(150, 30)).toEqual([
      { index: 0, frames: 60 },
      { index: 1, frames: 60 },
      { index: 2, frames: 30 },
    ]);
    expect(SEGMENT_SECONDS).toBe(2);
  });
  it('a tiny project is one segment', () => {
    expect(segmentPlan(1, 30)).toEqual([{ index: 0, frames: 1 }]);
  });
});

describe('segmentEncodeArgs', () => {
  it('mp4: image2 in, x264 verbatim codec args, per-segment numbering from 0 (no -start_number)', () => {
    const args = segmentEncodeArgs({ format: 'mp4', fps: 30, frameCount: 150, hasAudio: true }, { index: 1, frames: 60 });
    expect(args).toEqual([
      '-framerate', '30', '-i', 'frame%05d.jpg', '-frames:v', '60',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      'seg_001.mp4',
    ]);
    expect(args).not.toContain('-start_number');
  });
  it('webm: vp9 verbatim codec args', () => {
    const args = segmentEncodeArgs({ format: 'webm', fps: 24, frameCount: 48, hasAudio: false }, { index: 0, frames: 48 });
    expect(args).toEqual([
      '-framerate', '24', '-i', 'frame%05d.jpg', '-frames:v', '48',
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p',
      'seg_000.webm',
    ]);
  });
});

describe('concat + mux', () => {
  it('list text names every segment in order', () => {
    expect(concatListText({ format: 'mp4', fps: 30, frameCount: 150, hasAudio: true })).toBe(
      "file 'seg_000.mp4'\nfile 'seg_001.mp4'\nfile 'seg_002.mp4'\n",
    );
  });
  it('mp4 with audio: PER-STREAM copy flags, aac 192k, +faststart, -shortest', () => {
    expect(concatMuxArgs({ format: 'mp4', fps: 30, frameCount: 150, hasAudio: true })).toEqual([
      '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'mix.wav',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest',
      'out.mp4',
    ]);
  });
  it('webm with audio: libopus 128k, no faststart', () => {
    expect(concatMuxArgs({ format: 'webm', fps: 30, frameCount: 150, hasAudio: true })).toEqual([
      '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'mix.wav',
      '-c:v', 'copy', '-c:a', 'libopus', '-b:a', '128k', '-shortest',
      'out.webm',
    ]);
  });
  it('no-audio: wav input and every -c:a flag omitted', () => {
    const args = concatMuxArgs({ format: 'mp4', fps: 30, frameCount: 150, hasAudio: false });
    expect(args).toEqual([
      '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-c:v', 'copy', '-movflags', '+faststart',
      'out.mp4',
    ]);
    expect(args).not.toContain('mix.wav');
    expect(args).not.toContain('-shortest');
  });
});

describe('singlePassArgs (webm single-pass ruling, spec §6 amendment)', () => {
  it('webm with audio: one exec — frames + wav in, vp9+opus out, -shortest', () => {
    expect(singlePassArgs({ format: 'webm', fps: 30, frameCount: 90, hasAudio: true })).toEqual([
      '-framerate', '30', '-i', 'frame%05d.jpg', '-frames:v', '90', '-i', 'mix.wav',
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p',
      '-c:a', 'libopus', '-b:a', '128k', '-shortest',
      'out.webm',
    ]);
  });
  it('webm without audio: no wav input, no -c:a, no -shortest', () => {
    const args = singlePassArgs({ format: 'webm', fps: 30, frameCount: 90, hasAudio: false });
    expect(args).toEqual([
      '-framerate', '30', '-i', 'frame%05d.jpg', '-frames:v', '90',
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p',
      'out.webm',
    ]);
  });
  it('exports the 1800-frame cap', () => {
    expect(WEBM_MAX_FRAMES).toBe(1800);
  });
});

describe('videoMime + segmentName', () => {
  it('maps formats', () => {
    expect(videoMime('mp4')).toBe('video/mp4');
    expect(videoMime('webm')).toBe('video/webm');
    expect(segmentName('webm', 12)).toBe('seg_012.webm');
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — module not found.

- [ ] **Step 3: Implement**

```ts
/** Pure ffmpeg argv builders for browser video export (spec §6). Deliberately in services so a
 *  future backend/native path (M10, spec §11) drives the SAME invocations. All codec strings
 *  are spec-verbatim — change the spec first, then this file. */
export const SEGMENT_SECONDS = 2;
export type VideoFormat = 'mp4' | 'webm';
export interface VideoArgsSpec {
  format: VideoFormat;
  fps: number;
  frameCount: number;
  hasAudio: boolean;
}

export function evenDim(n: number): number {
  return Math.max(2, 2 * Math.floor(n / 2));
}

export function segmentPlan(frameCount: number, fps: number): Array<{ index: number; frames: number }> {
  const per = Math.max(1, fps * SEGMENT_SECONDS);
  const plan: Array<{ index: number; frames: number }> = [];
  for (let start = 0, index = 0; start < frameCount; start += per, index++) {
    plan.push({ index, frames: Math.min(per, frameCount - start) });
  }
  return plan.length ? plan : [{ index: 0, frames: 1 }];
}

export function segmentName(format: VideoFormat, index: number): string {
  return `seg_${String(index).padStart(3, '0')}.${format}`;
}

const VIDEO_CODEC: Record<VideoFormat, string[]> = {
  mp4: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p'],
  webm: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p'],
};

export function segmentEncodeArgs(spec: VideoArgsSpec, seg: { index: number; frames: number }): string[] {
  // Per-segment numbering restarts at 0 (frames are deleted after each segment), so there is
  // no global frame%05d ceiling and no -start_number bookkeeping (spec §6).
  return [
    '-framerate', String(spec.fps), '-i', 'frame%05d.jpg', '-frames:v', String(seg.frames),
    ...VIDEO_CODEC[spec.format],
    segmentName(spec.format, seg.index),
  ];
}

export function concatListText(spec: VideoArgsSpec): string {
  return segmentPlan(spec.frameCount, spec.fps)
    .map((s) => `file '${segmentName(spec.format, s.index)}'\n`)
    .join('');
}

export function concatMuxArgs(spec: VideoArgsSpec): string[] {
  // PER-STREAM codec flags: a bare `-c copy` would claim the audio stream too (spec §6).
  const inputs = ['-f', 'concat', '-safe', '0', '-i', 'list.txt', ...(spec.hasAudio ? ['-i', 'mix.wav'] : [])];
  const audio = spec.hasAudio
    ? spec.format === 'mp4'
      ? ['-c:a', 'aac', '-b:a', '192k']
      : ['-c:a', 'libopus', '-b:a', '128k']
    : [];
  const faststart = spec.format === 'mp4' ? ['-movflags', '+faststart'] : [];
  const shortest = spec.hasAudio ? ['-shortest'] : [];
  return [...inputs, '-c:v', 'copy', ...audio, ...faststart, ...shortest, `out.${spec.format}`];
}

/** WebM single-pass ruling (spec §6 amendment): vp9 on the vendored wasm core traps on a
 *  second exec per instance, so webm encodes in ONE invocation behind this frame cap. The
 *  segment/concat builders above stay webm-capable for the M10 native backend. */
export const WEBM_MAX_FRAMES = 1800;

export function singlePassArgs(spec: VideoArgsSpec): string[] {
  const audioIn = spec.hasAudio ? ['-i', 'mix.wav'] : [];
  const audioOut = spec.hasAudio ? ['-c:a', 'libopus', '-b:a', '128k', '-shortest'] : [];
  return [
    '-framerate', String(spec.fps), '-i', 'frame%05d.jpg', '-frames:v', String(spec.frameCount),
    ...audioIn,
    ...VIDEO_CODEC[spec.format],
    ...audioOut,
    `out.${spec.format}`,
  ];
}

export function videoMime(format: VideoFormat): string {
  return format === 'mp4' ? 'video/mp4' : 'video/webm';
}
```

- [ ] **Step 4: Run to verify PASS**, then whole-package: `node_modules/.bin/vitest run packages/services/`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(video): videoArgs — pure segment plan + ffmpeg argv builders (backend-reusable)"`

---

### Task 4: frameSource (parse-once frame SVG + browser rasterizer)

**Files:**
- Create: `apps/react/src/ui/export/frameSource.ts`
- Test: `apps/react/src/ui/export/frameSource.test.ts`

**Interfaces:**
- Consumes: `renderProjectDocument` (`@savig/services/export/renderDocument`), `applyProjectFrame` (`@savig/runtime/frame`).
- Produces:
  ```ts
  export interface FrameSource { frameSvg(t: number): string }
  export function createFrameSource(project: Project): FrameSource;
  export function rasterizeSvgFrame(svg: string, width: number, height: number, background: string): Promise<Blob>;
  ```

- [ ] **Step 1: Write the failing tests** (jsdom exercises the parse/apply/serialize half; the canvas half is e2e-only)

```ts
import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject, createKeyframe } from '@savig/engine';
import { createFrameSource } from './frameSource';

const svgAsset = {
  id: 'a', kind: 'svg' as const, name: 'box', viewBox: '0 0 10 10', width: 10, height: 10,
  normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
};

describe('createFrameSource', () => {
  it('bakes the sampled transform for the requested master time into the serialized frame', () => {
    const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 100)] } });
    const project = { ...createProject(), assets: [svgAsset], objects: [obj] };
    const src = createFrameSource(project);
    const at0 = src.frameSvg(0);
    const at1 = src.frameSvg(1);
    expect(at0).toContain('<svg'); // a real document
    expect(at0).not.toBe(at1); // animation visibly baked
    expect(at1).toContain('100'); // the keyframed x landed in the frame
  });

  it('parses ONCE: two frameSvg calls at the same t are byte-identical (stable serialization)', () => {
    const obj = createSceneObject('a', { id: 'o1' });
    const project = { ...createProject(), assets: [svgAsset], objects: [obj] };
    const src = createFrameSource(project);
    expect(src.frameSvg(0.5)).toBe(src.frameSvg(0.5));
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — module not found.

- [ ] **Step 3: Implement**

```ts
// Frame pipeline for browser video export (spec §3/§4). The export markup is parsed ONCE into
// a DETACHED document (never inserted into the live DOM); applyProjectFrame — the SAME
// frame-baker the node rasterizer, exported player, and editor use — bakes each master time
// onto it (multi-scene + crossfade/dip transitions correct by construction), then the
// serialized string round-trips through <img> onto a canvas.
// Documented caveat (spec §4): SVG loaded via <img> never fetches external subresources —
// identical to the node resvg raster; native SVG filters (tint) DO rasterize here.
import type { Project } from '@savig/engine';
import { renderProjectDocument } from '@savig/services/export/renderDocument';
import { applyProjectFrame } from '@savig/runtime/frame';

export interface FrameSource {
  frameSvg(t: number): string;
}

export function createFrameSource(project: Project): FrameSource {
  const markup = renderProjectDocument(project);
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement;
  // The node-raster recipe (core/node/render.ts): every [data-savig-object] element by id.
  const nodes = new Map<string, Element>();
  for (const el of Array.from(doc.querySelectorAll('[data-savig-object]'))) {
    const id = el.getAttribute('data-savig-object');
    if (id) nodes.set(id, el);
  }
  const serializer = new XMLSerializer();
  return {
    frameSvg(t: number): string {
      applyProjectFrame(svg, nodes, project, t);
      return serializer.serializeToString(svg);
    },
  };
}

/** Browser-only half (canvas + <img>; exercised by the e2e — jsdom has neither). The blob URL
 *  is ALWAYS revoked (spec §8 hygiene). Background is filled first: JPEG has no alpha. */
export function rasterizeSvgFrame(svg: string, width: number, height: number, background: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/jpeg', 0.92);
      } catch (err) {
        reject(err as Error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('frame SVG failed to decode'));
    };
    img.src = url;
  });
}
```

- [ ] **Step 4: Run to verify PASS** — `node_modules/.bin/vitest run apps/react/src/ui/export/frameSource.test.ts`.

NOTE: if `applyProjectFrame`'s actual exported signature differs from `(svg, nodes, project, t)`, read `packages/runtime/src/frame.ts` and `packages/core/src/node/render.ts:38-46` and match them exactly — the node raster call is the reference usage.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(video): frameSource — parse-once frame SVG via shared applyProjectFrame + browser rasterizer"`

---

### Task 5: renderMix (offline master mix)

**Files:**
- Create: `apps/react/src/ui/audio/renderMix.ts`
- Test: `apps/react/src/ui/audio/renderMix.test.ts`

**Interfaces:**
- Consumes: `createAudioEngine`, `computeProjectDuration`.
- Produces:
  ```ts
  export interface RenderedMix { channels: Float32Array[]; sampleRate: number }
  /** null = no audio to render (no clips, zero duration, or no OfflineAudioContext). */
  export function renderMasterMix(
    project: Project,
    binaries: Record<string, Uint8Array>,
    makeCtx?: (channels: number, length: number, sampleRate: number) => OfflineCtxLike,
  ): Promise<RenderedMix | null>;
  ```

- [ ] **Step 1: Write the failing tests** (jsdom has no OfflineAudioContext — inject a fake `makeCtx` built on the audioEngine test-harness idiom)

```ts
import { describe, expect, it, vi } from 'vitest';
import { createProject } from '@savig/engine';
import { renderMasterMix, type OfflineCtxLike } from './renderMix';

function fakeOfflineCtx(captured: { started: number; decoded: string[] }) {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const rendered = {
    numberOfChannels: 2,
    getChannelData: (c: number) => new Float32Array([c === 0 ? 0.5 : -0.5]),
  };
  const ctx: OfflineCtxLike = {
    currentTime: 0,
    destination: {},
    sampleRate: 44100,
    decodeAudioData: vi.fn(async () => {
      captured.decoded.push('x');
      return { duration: 1 };
    }),
    createGain: () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => ({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(() => {
        captured.started += 1;
      }),
      stop: vi.fn(),
    }),
    createStereoPanner: () => ({ pan: param(), connect: vi.fn(), disconnect: vi.fn() }),
    startRendering: vi.fn(async () => rendered),
  };
  return ctx;
}

function projectWithClip() {
  const p = createProject();
  return {
    ...p,
    assets: [{ id: 'au', kind: 'audio' as const, name: 'a.wav', mimeType: 'audio/wav', duration: 1 }],
    audioClips: [{ id: 'c1', assetId: 'au', startTime: 0, inPoint: 0, outPoint: 1, volume: 1 }],
  };
}

describe('renderMasterMix', () => {
  it('decodes each audio asset, schedules clips from 0, and returns the rendered channels', async () => {
    const captured = { started: 0, decoded: [] as string[] };
    const mix = await renderMasterMix(projectWithClip(), { au: new Uint8Array([1, 2]) }, () => fakeOfflineCtx(captured));
    expect(captured.decoded).toHaveLength(1);
    expect(captured.started).toBe(1);
    expect(mix).not.toBeNull();
    expect(mix!.sampleRate).toBe(44100);
    expect(mix!.channels).toHaveLength(2);
    expect(mix!.channels[0][0]).toBeCloseTo(0.5, 6);
  });

  it('returns null when the project has no audio clips (spec §5: no silent track)', async () => {
    const mix = await renderMasterMix(createProject(), {}, () => {
      throw new Error('must not construct a context');
    });
    expect(mix).toBeNull();
  });

  it('skips clips whose bytes are missing from binaries (matches live playback) and still renders', async () => {
    const captured = { started: 0, decoded: [] as string[] };
    const mix = await renderMasterMix(projectWithClip(), {}, () => fakeOfflineCtx(captured));
    expect(captured.decoded).toHaveLength(0);
    expect(captured.started).toBe(0);
    expect(mix).not.toBeNull(); // rendered silence is fine; the orchestrator still muxes it
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — module not found.

- [ ] **Step 3: Implement**

```ts
// Offline master-mix render (spec §5): OfflineAudioContext satisfies the audio engine's
// AudioContextLike, so createAudioEngine builds the EXACT live mixer graph (gain/mute/solo/
// pan/filter/fades) against the offline context — zero new mix math. 44.1kHz stereo; ffmpeg
// resamples for Opus (48k) itself.
import { computeProjectDuration } from '@savig/engine';
import type { Project } from '@savig/engine';
import { createAudioEngine, type AudioContextLike } from '@savig/services';

export interface RenderedMix {
  channels: Float32Array[];
  sampleRate: number;
}

export interface OfflineCtxLike extends AudioContextLike {
  readonly sampleRate: number;
  startRendering(): Promise<{ numberOfChannels: number; getChannelData(c: number): Float32Array }>;
}

const SAMPLE_RATE = 44100;

const defaultMakeCtx = (channels: number, length: number, sampleRate: number): OfflineCtxLike =>
  new OfflineAudioContext(channels, length, sampleRate) as unknown as OfflineCtxLike;

export async function renderMasterMix(
  project: Project,
  binaries: Record<string, Uint8Array>,
  makeCtx: (channels: number, length: number, sampleRate: number) => OfflineCtxLike = defaultMakeCtx,
): Promise<RenderedMix | null> {
  const duration = computeProjectDuration(project);
  if (project.audioClips.length === 0 || duration <= 0) return null;

  const ctx = makeCtx(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const engine = createAudioEngine(ctx);
  for (const asset of project.assets) {
    if (asset.kind !== 'audio') continue;
    const bytes = binaries[asset.id];
    if (!bytes) continue; // matches live playback: undecodable/missing clips are skipped
    try {
      await engine.decode(asset.id, bytes);
    } catch {
      // undecodable asset — its clips are skipped by start(), same as the live transport
    }
  }
  engine.start(project.audioClips, project.audioTracks, 0);
  const rendered = await ctx.startRendering();
  const channels: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) channels.push(rendered.getChannelData(c));
  return { channels, sampleRate: ctx.sampleRate };
}
```

- [ ] **Step 4: Run to verify PASS**, then `node_modules/.bin/tsc --noEmit` (the `OfflineCtxLike` cast must typecheck).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(video): renderMix — offline master mix via createAudioEngine(OfflineAudioContext)"`

---

### Task 6: videoExport orchestrator

**Files:**
- Create: `apps/react/src/ui/export/videoExport.ts`
- Test: `apps/react/src/ui/export/videoExport.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5 (exact names above): `createFfmpegClient`/`FfmpegClient`, `encodeWav`, `SEGMENT_SECONDS`/`segmentPlan`/`segmentName`/`segmentEncodeArgs`/`concatListText`/`concatMuxArgs`/`singlePassArgs`/`WEBM_MAX_FRAMES`/`videoMime`/`evenDim`/`VideoFormat`, `createFrameSource`/`rasterizeSvgFrame`, `renderMasterMix`.
  RULING carried from Task 1 (spec §6 amendment): the orchestrator ROUTES BY FORMAT — mp4 =
  segmented pipeline (below), webm = SINGLE-PASS (rasterize all frames globally numbered 0..N-1,
  ONE `singlePassArgs` exec, read out.webm; throw a clear error when frameCount > WEBM_MAX_FRAMES:
  "WebM export is capped at 1800 frames (…): lower the fps, shorten the project, or export MP4.").
- Produces (Task 7 calls this):
  ```ts
  export interface VideoExportOptions { format: VideoFormat; fps: number; width: number }
  export type VideoPhase = 'frames' | 'audio' | 'encode' | 'finalize';
  export interface VideoExportResult { bytes: Uint8Array; filename: string; mime: string }
  export interface VideoExportDeps { /* every stage injectable; defaults = the real ones */ }
  /** Resolves null when cancelled via `signal`. Throws on failure (caller toasts). */
  export function exportVideo(
    project: Project,
    binaries: Record<string, Uint8Array>,
    opts: VideoExportOptions,
    onProgress: (phase: VideoPhase, fraction: number) => void,
    signal: AbortSignal,
    deps?: Partial<VideoExportDeps>,
  ): Promise<VideoExportResult | null>;
  ```

- [ ] **Step 1: Write the failing tests** (all stages faked; assertions on ORDER, argv, per-segment deletes, cancel, no-audio)

```ts
import { describe, expect, it, vi } from 'vitest';
import { createProject, createSceneObject, createKeyframe } from '@savig/engine';
import { segmentEncodeArgs, concatMuxArgs, concatListText, singlePassArgs } from '@savig/services';
import { exportVideo, type VideoExportDeps, type VideoPhase } from './videoExport';

const svgAsset = {
  id: 'a', kind: 'svg' as const, name: 'box', viewBox: '0 0 10 10', width: 10, height: 10,
  normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
};

/** 3s project at the test fps of 2 -> 6 frames -> segments of 4,2 (SEGMENT_SECONDS=2). */
function projectWith3s() {
  const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(3, 10)] } });
  return { ...createProject(), assets: [svgAsset], objects: [obj] };
}

function fakeDeps() {
  const calls: { execs: string[][]; writes: string[]; deletes: string[] } = { execs: [], writes: [], deletes: [] };
  const ffmpeg = {
    writeFile: vi.fn(async (name: string) => {
      calls.writes.push(name);
    }),
    exec: vi.fn(async (args: string[], onProgress?: (p: number) => void) => {
      calls.execs.push(args);
      onProgress?.(1);
    }),
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    deleteFile: vi.fn(async (name: string) => {
      calls.deletes.push(name);
    }),
    terminate: vi.fn(),
  };
  const deps: Partial<VideoExportDeps> = {
    makeFfmpeg: async () => ffmpeg,
    makeFrameSource: () => ({ frameSvg: (t: number) => `<svg data-t="${t}"/>` }),
    rasterize: vi.fn(async () => new Blob([new Uint8Array([9])], { type: 'image/jpeg' })),
    renderMix: vi.fn(async () => ({ channels: [new Float32Array([0])], sampleRate: 44100 })),
  };
  return { calls, ffmpeg, deps };
}

const opts = { format: 'mp4' as const, fps: 2, width: 100 };

describe('exportVideo', () => {
  it('runs frames -> audio -> per-segment encode (deleting each segment) -> concat mux -> result', async () => {
    const { calls, deps } = fakeDeps();
    const phases: VideoPhase[] = [];
    const result = await exportVideo(projectWith3s(), {}, opts, (phase) => {
      if (phases.at(-1) !== phase) phases.push(phase);
    }, new AbortController().signal, deps);

    // Wall-clock order: audio renders first (one offline pass), then frames/encode interleave
    // per segment, then finalize. Assert the truthful shape, not a fake linear sequence.
    expect(phases[0]).toBe('audio');
    expect(phases).toContain('frames');
    expect(phases).toContain('encode');
    expect(phases.at(-1)).toBe('finalize');
    const spec = { format: 'mp4' as const, fps: 2, frameCount: 6, hasAudio: true };
    // Two segments (4 + 2 frames) with the exact shared argv, then the exact mux argv.
    expect(calls.execs).toEqual([
      segmentEncodeArgs(spec, { index: 0, frames: 4 }),
      segmentEncodeArgs(spec, { index: 1, frames: 2 }),
      concatMuxArgs(spec),
    ]);
    // Every segment's frames were deleted before the next segment ran.
    expect(calls.deletes.filter((n) => n.startsWith('frame'))).toHaveLength(6);
    expect(calls.writes).toContain('mix.wav');
    expect(calls.writes).toContain('list.txt');
    expect(result).toEqual({ bytes: new Uint8Array([1, 2, 3, 4]), filename: `${createProject().meta.name}.mp4`, mime: 'video/mp4' });
  });

  it('writes the concat list with the shared concatListText', async () => {
    const { calls, deps, ffmpeg } = fakeDeps();
    const listBodies: string[] = [];
    (ffmpeg.writeFile as ReturnType<typeof vi.fn>).mockImplementation(async (name: string, data: Uint8Array) => {
      calls.writes.push(name);
      if (name === 'list.txt') listBodies.push(new TextDecoder().decode(data));
    });
    await exportVideo(projectWith3s(), {}, opts, () => {}, new AbortController().signal, deps);
    expect(listBodies).toEqual([concatListText({ format: 'mp4', fps: 2, frameCount: 6, hasAudio: true })]);
  });

  it('no-audio project: renderMix null -> hasAudio false argv, no mix.wav write', async () => {
    const { calls, deps } = fakeDeps();
    (deps.renderMix as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await exportVideo(projectWith3s(), {}, opts, () => {}, new AbortController().signal, deps);
    expect(calls.writes).not.toContain('mix.wav');
    expect(calls.execs.at(-1)).toEqual(concatMuxArgs({ format: 'mp4', fps: 2, frameCount: 6, hasAudio: false }));
  });

  it('cancel during the frame phase: resolves null, terminates ffmpeg, never saves', async () => {
    const { deps, ffmpeg } = fakeDeps();
    const abort = new AbortController();
    (deps.rasterize as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      abort.abort(); // cancel fires mid-frame-loop
      return new Blob([new Uint8Array([9])], { type: 'image/jpeg' });
    });
    const result = await exportVideo(projectWith3s(), {}, opts, () => {}, abort.signal, deps);
    expect(result).toBeNull();
    expect(ffmpeg.terminate).toHaveBeenCalled();
    expect(ffmpeg.exec).not.toHaveBeenCalled();
  });

  it('a 0-duration project throws "nothing to export"', async () => {
    const { deps } = fakeDeps();
    await expect(
      exportVideo(createProject(), {}, opts, () => {}, new AbortController().signal, deps),
    ).rejects.toThrow(/nothing to export/i);
  });

  it('webm routes SINGLE-PASS (ruling): all frames written, ONE exec with singlePassArgs, no concat', async () => {
    const { calls, deps } = fakeDeps();
    await exportVideo(projectWith3s(), {}, { ...opts, format: 'webm' }, () => {}, new AbortController().signal, deps);
    const spec = { format: 'webm' as const, fps: 2, frameCount: 6, hasAudio: true };
    expect(calls.execs).toEqual([singlePassArgs(spec)]);
    expect(calls.writes).not.toContain('list.txt');
    expect(calls.writes.filter((n) => n.startsWith('frame'))).toHaveLength(6); // global 0..5
  });

  it('webm beyond WEBM_MAX_FRAMES throws the capped-export error before any ffmpeg work', async () => {
    const { calls, deps } = fakeDeps();
    const longOpts = { format: 'webm' as const, fps: 60, width: 100 };
    const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(31, 10)] } }); // 31s x 60fps = 1860 > 1800
    const longProject = { ...createProject(), assets: [svgAsset], objects: [obj] };
    await expect(
      exportVideo(longProject, {}, longOpts, () => {}, new AbortController().signal, deps),
    ).rejects.toThrow(/capped at 1800 frames/i);
    expect(calls.execs).toHaveLength(0);
  });

  it('progress is monotonically non-decreasing across the whole run', async () => {
    const { deps } = fakeDeps();
    const fractions: number[] = [];
    await exportVideo(projectWith3s(), {}, opts, (_phase, f) => fractions.push(f), new AbortController().signal, deps);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    expect(fractions.at(-1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — module not found.

- [ ] **Step 3: Implement**

```ts
// Orchestrator (spec §3): frames -> audio -> segment encode -> concat+mux, over a SNAPSHOT of
// (project, binaries) captured by the caller at dialog-confirm (spec §8) — edits during a long
// export can never tear the output. Every stage is injectable for jsdom tests; the defaults
// are the real implementations. Cancel: AbortSignal checked between frames and segments;
// terminate() kills any in-flight exec; resolves null (no partial file ever saved).
import { computeProjectDuration } from '@savig/engine';
import type { Project } from '@savig/engine';
import {
  WEBM_MAX_FRAMES, concatListText, concatMuxArgs, encodeWav, evenDim, segmentEncodeArgs,
  segmentPlan, singlePassArgs, videoMime, type VideoFormat,
} from '@savig/services';
import { createFfmpegClient, type FfmpegClient } from './ffmpegClient';
import { createFrameSource, rasterizeSvgFrame, type FrameSource } from './frameSource';
import { renderMasterMix, type RenderedMix } from '../audio/renderMix';

export interface VideoExportOptions {
  format: VideoFormat;
  fps: number;
  width: number;
}
export type VideoPhase = 'frames' | 'audio' | 'encode' | 'finalize';
export interface VideoExportResult {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}
export interface VideoExportDeps {
  makeFfmpeg: () => Promise<FfmpegClient>;
  makeFrameSource: (project: Project) => FrameSource;
  rasterize: (svg: string, width: number, height: number, background: string) => Promise<Blob>;
  renderMix: (project: Project, binaries: Record<string, Uint8Array>) => Promise<RenderedMix | null>;
}

const DEFAULT_DEPS: VideoExportDeps = {
  makeFfmpeg: createFfmpegClient,
  makeFrameSource: createFrameSource,
  rasterize: rasterizeSvgFrame,
  renderMix: renderMasterMix,
};

const BACKGROUND = 'white';
// Progress model: frames and encode INTERLEAVE per segment (memory bound, spec §6), so the
// reported fraction is a WEIGHTED GLOBAL TOTAL over completed work — monotonic by construction
// — while the phase label names the current activity (spec §7 labels).
const WEIGHT = { audio: 0.05, frames: 0.5, encode: 0.43, finalize: 0.02 } as const;

export async function exportVideo(
  project: Project,
  binaries: Record<string, Uint8Array>,
  opts: VideoExportOptions,
  onProgress: (phase: VideoPhase, fraction: number) => void,
  signal: AbortSignal,
  deps: Partial<VideoExportDeps> = {},
): Promise<VideoExportResult | null> {
  const d = { ...DEFAULT_DEPS, ...deps };
  const duration = computeProjectDuration(project);
  if (duration <= 0) throw new Error('Nothing to export: the project has zero duration.');

  const fps = Math.max(1, Math.min(60, Math.round(opts.fps)));
  const width = evenDim(Math.max(16, Math.min(3840, opts.width)));
  const height = evenDim(Math.round((width * project.meta.height) / project.meta.width));
  const frameCount = Math.max(1, Math.round(duration * fps));

  // Weighted-total progress state: each term is "completed fraction of that stage".
  const done = { audio: 0, frames: 0, encode: 0, finalize: 0 };
  const report = (phase: VideoPhase, stageFraction: number) => {
    done[phase] = Math.max(done[phase], Math.min(1, stageFraction)); // never regresses
    const total = (Object.keys(WEIGHT) as VideoPhase[]).reduce((sum, k) => sum + WEIGHT[k] * done[k], 0);
    onProgress(phase, Math.min(1, total));
  };

  const ffmpeg = await d.makeFfmpeg();
  try {
    const src = d.makeFrameSource(project);
    const plan = segmentPlan(frameCount, fps);
    const spec = { format: opts.format, fps, frameCount, hasAudio: false };

    // Audio first (one quick offline pass) so `hasAudio` is settled before the mux argv.
    report('audio', 0);
    const mix = await d.renderMix(project, binaries);
    if (signal.aborted) throw new AbortedError();
    if (mix) await ffmpeg.writeFile('mix.wav', encodeWav(mix.channels, mix.sampleRate));
    report('audio', 1);
    spec.hasAudio = mix !== null;

    let bytes: Uint8Array;
    if (opts.format === 'webm') {
      // RULING (spec §6 amendment): vp9 on this wasm core traps on a 2nd exec per instance —
      // webm encodes SINGLE-PASS behind WEBM_MAX_FRAMES. Frames are numbered GLOBALLY here.
      if (frameCount > WEBM_MAX_FRAMES) {
        throw new Error(
          `WebM export is capped at ${WEBM_MAX_FRAMES} frames (${frameCount} requested): lower the fps, shorten the project, or export MP4.`,
        );
      }
      for (let i = 0; i < frameCount; i++) {
        if (signal.aborted) throw new AbortedError();
        const svg = src.frameSvg(i / fps);
        const blob = await d.rasterize(svg, width, height, BACKGROUND);
        await ffmpeg.writeFile(`frame${String(i).padStart(5, '0')}.jpg`, new Uint8Array(await blob.arrayBuffer()));
        report('frames', (i + 1) / frameCount);
      }
      if (signal.aborted) throw new AbortedError();
      await ffmpeg.exec(singlePassArgs(spec), (p) => report('encode', p));
      report('encode', 1);
    } else {
      // MP4: segmented pipeline — frames + encode interleave per segment (numbering restarts
      // at 0; JPEGs deleted after each encode, spec §6 memory bound), then concat + mux.
      let framesDone = 0;
      let globalFrame = 0;
      for (const seg of plan) {
        for (let i = 0; i < seg.frames; i++) {
          if (signal.aborted) throw new AbortedError();
          const svg = src.frameSvg(globalFrame / fps);
          globalFrame++;
          const blob = await d.rasterize(svg, width, height, BACKGROUND);
          await ffmpeg.writeFile(`frame${String(i).padStart(5, '0')}.jpg`, new Uint8Array(await blob.arrayBuffer()));
          framesDone++;
          report('frames', framesDone / frameCount);
        }
        if (signal.aborted) throw new AbortedError();
        await ffmpeg.exec(segmentEncodeArgs(spec, seg), (p) => report('encode', (seg.index + p) / plan.length));
        report('encode', (seg.index + 1) / plan.length);
        for (let i = 0; i < seg.frames; i++) await ffmpeg.deleteFile(`frame${String(i).padStart(5, '0')}.jpg`);
      }
      report('finalize', 0);
      await ffmpeg.writeFile('list.txt', new TextEncoder().encode(concatListText(spec)));
      if (signal.aborted) throw new AbortedError();
      await ffmpeg.exec(concatMuxArgs(spec));
    }
    bytes = await ffmpeg.readFile(`out.${opts.format}`);
    report('finalize', 1);
    return { bytes, filename: `${project.meta.name}.${opts.format}`, mime: videoMime(opts.format) };
  } catch (err) {
    if (err instanceof AbortedError) return null;
    throw err;
  } finally {
    ffmpeg.terminate();
  }
}

class AbortedError extends Error {
  constructor() {
    super('export cancelled');
  }
}
```

- [ ] **Step 4: Run to verify PASS** — `node_modules/.bin/vitest run apps/react/src/ui/export/videoExport.test.ts`.

- [ ] **Step 5: Run whole app suite + typecheck** — `node_modules/.bin/vitest run apps/react/` and `node_modules/.bin/tsc --noEmit`.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(video): exportVideo orchestrator — phased, cancellable, segment-bounded"`

---

### Task 7: ExportVideoDialog + palette command + App wiring

**Files:**
- Create: `apps/react/src/ui/components/ExportVideoDialog/ExportVideoDialog.tsx`, `.module.css`
- Modify: `packages/ui-core/src/commands/types.ts` (host member), `packages/ui-core/src/commands/registry.ts` (command), `apps/react/src/ui/App.tsx` (overlay), `apps/react/src/ui/commandHost.ts` (host impl)
- Test: `apps/react/src/ui/components/ExportVideoDialog/ExportVideoDialog.test.tsx`

**Interfaces:**
- Consumes: `exportVideo` (Task 6 signature), `saveBytesToDisk` (`@savig/services`), `useEditor`.
- Produces: `CommandHost.openExportVideo(): void`; App overlay kind `'exportVideo'`; palette command id `'file.exportVideo'`, title `'Export Video…'`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportVideoDialog } from './ExportVideoDialog';
import { useEditor } from '../../store/store';
import * as videoExportModule from '../../export/videoExport';

vi.mock('../../export/videoExport', () => ({ exportVideo: vi.fn() }));
const exportVideoMock = videoExportModule.exportVideo as ReturnType<typeof vi.fn>;

beforeEach(() => {
  useEditor.getState().newProject();
  exportVideoMock.mockReset();
});

describe('ExportVideoDialog', () => {
  it('defaults: MP4, fps = meta.fps, width = artboard width', () => {
    render(<ExportVideoDialog onClose={() => {}} />);
    expect(screen.getByLabelText('Format')).toHaveValue('mp4');
    expect(screen.getByLabelText('Frames per second')).toHaveValue(useEditor.getState().history.present.meta.fps);
    expect(screen.getByLabelText('Width')).toHaveValue(useEditor.getState().history.present.meta.width);
  });

  it('Export invokes exportVideo with the chosen options and a project/binaries snapshot', async () => {
    exportVideoMock.mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'x.webm', mime: 'video/webm' });
    render(<ExportVideoDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'webm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(exportVideoMock).toHaveBeenCalledTimes(1));
    const [project, , opts] = exportVideoMock.mock.calls[0];
    expect(project).toBe(useEditor.getState().history.present); // the snapshot
    expect(opts.format).toBe('webm');
  });

  it('shows phase progress while running and Cancel aborts', async () => {
    let capturedSignal: AbortSignal | null = null;
    exportVideoMock.mockImplementation(async (_p, _b, _o, onProgress, signal) => {
      capturedSignal = signal;
      onProgress('frames', 0.25);
      await new Promise((res) => setTimeout(res, 50));
      return null; // cancelled
    });
    render(<ExportVideoDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText(/rendering frames/i);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    await waitFor(() => expect(capturedSignal!.aborted).toBe(true));
  });

  it('an export failure surfaces a toast and re-enables the form', async () => {
    exportVideoMock.mockRejectedValue(new Error('encode exploded'));
    render(<ExportVideoDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() =>
      expect(useEditor.getState().toasts.some((t) => t.message.includes('encode exploded'))).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — component missing.

- [ ] **Step 3: Implement the dialog**

```tsx
// Options + progress + cancel for browser video export (spec §7). Overlay pattern mirrors
// TemplateGallery; the global keymap is already suppressed while any overlay is open (App.tsx
// passes overlay !== null to useKeyboard). Snapshot semantics (spec §8): project + binaries
// are captured ONCE at Export-click and handed to the orchestrator.
import { useRef, useState } from 'react';
import { computeProjectDuration } from '@savig/engine';
import { WEBM_MAX_FRAMES, saveBytesToDisk } from '@savig/services';
import { useEditor } from '../../store/store';
import { exportVideo, type VideoPhase } from '../../export/videoExport';
import styles from './ExportVideoDialog.module.css';

const PHASE_LABEL: Record<VideoPhase, string> = {
  frames: 'rendering frames…',
  audio: 'mixing audio…',
  encode: 'encoding…',
  finalize: 'finalizing…',
};

export function ExportVideoDialog({ onClose }: { onClose: () => void }) {
  const meta = useEditor((s) => s.history.present.meta);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [fps, setFps] = useState(meta.fps);
  const [width, setWidth] = useState(meta.width);
  const [running, setRunning] = useState<{ phase: VideoPhase; fraction: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = async () => {
    const s = useEditor.getState();
    const project = s.history.present; // snapshot (spec §8)
    const binaries = s.binaries;
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning({ phase: 'frames', fraction: 0 });
    try {
      const result = await exportVideo(
        project, binaries,
        { format, fps: Math.max(1, Math.min(60, fps)), width: Math.max(16, Math.min(3840, width)) },
        (phase, fraction) => setRunning({ phase, fraction }),
        abort.signal,
      );
      if (result) {
        await saveBytesToDisk(result.bytes, result.filename, result.mime);
        onClose();
        return;
      }
      setRunning(null); // cancelled: stay open, form re-enabled
    } catch (err) {
      useEditor.getState().pushToast('error', `Video export failed: ${(err as Error).message}`);
      setRunning(null);
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-label="Export video">
      <div className={styles.panel}>
        <h2>Export Video</h2>
        <label>
          Format
          <select aria-label="Format" value={format} disabled={!!running} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}>
            <option value="mp4">MP4 (H.264)</option>
            <option value="webm">WebM (VP9)</option>
          </select>
        </label>
        <label>
          Frames per second
          <input aria-label="Frames per second" type="number" min={1} max={60} value={fps} disabled={!!running}
            onChange={(e) => setFps(Number(e.target.value))} />
        </label>
        <label>
          Width
          <input aria-label="Width" type="number" min={16} max={3840} step={2} value={width} disabled={!!running}
            onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        {!running && computeProjectDuration(useEditor.getState().history.present) > 60 && (
          <p className={styles.warning}>Long project (&gt;60s): single-threaded encoding may take several minutes.</p>
        )}
        {!running && format === 'webm' &&
          Math.round(computeProjectDuration(useEditor.getState().history.present) * fps) > WEBM_MAX_FRAMES && (
          <p className={styles.warning}>
            WebM is capped at {WEBM_MAX_FRAMES} frames on the in-browser encoder — lower the fps, shorten the project, or export MP4.
          </p>
        )}
        {running ? (
          <div className={styles.progressRow}>
            <span>{PHASE_LABEL[running.phase]}</span>
            <progress max={1} value={running.fraction} />
            <button type="button" aria-label="Cancel export" onClick={() => abortRef.current?.abort()}>Cancel</button>
          </div>
        ) : (
          <div className={styles.actions}>
            <button type="button" onClick={() => void start()}>Export</button>
            <button type="button" aria-label="Close" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

`ExportVideoDialog.module.css` — mirror `TemplateGallery.module.css`'s backdrop/panel classes
(read that file and copy its backdrop/panel/actions rules, renaming only the class names above).

- [ ] **Step 4: Wire host + registry + App**

`packages/ui-core/src/commands/types.ts` — add to `CommandHost` next to `exportSvg()`:

```ts
  /** Open the Export Video dialog (browser ffmpeg.wasm export — spec 2026-09-12). */
  openExportVideo(): void;
```

`packages/ui-core/src/commands/registry.ts` — next to the `file.exportAnimatedSvg` entry:

```ts
  { id: 'file.exportVideo', title: 'Export Video…', category: 'File', keywords: ['export', 'video', 'mp4', 'webm', 'movie', 'ffmpeg'], run: (c) => c.host.openExportVideo() },
```

`apps/react/src/ui/App.tsx` — extend `type Overlay = 'palette' | 'shortcuts' | 'templates' | 'exportVideo' | null;`, pass `openExportVideo: () => setOverlay('exportVideo')` into `makeCommandHost`, and render next to the other overlays:

```tsx
      {overlay === 'exportVideo' && <ExportVideoDialog onClose={() => setOverlay(null)} />}
```

`apps/react/src/ui/commandHost.ts` — thread `openExportVideo` through `makeCommandHost` exactly the way `openTemplates` is threaded (same parameter object, same passthrough).

- [ ] **Step 5: Run the dialog tests + the ui-core + App suites**

Run: `node_modules/.bin/vitest run apps/react/src/ui/components/ExportVideoDialog/ packages/ui-core/ apps/react/src/ui/App.test.tsx`
Expected: PASS (registry/commandHost tests may pin the host member list — extend those fixtures if they fail on the new member).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(video): Export Video dialog + palette command + overlay wiring"`

---

### Task 8: e2e journey + INDEX

**Files:**
- Create: `e2e/video-export.spec.ts`
- Modify: `docs/superpowers/INDEX.md` (flip the IN FLIGHT entry to done with hashes)

**Interfaces:**
- Consumes: the full UI path (palette command → dialog → saved bytes); `e2e/util/wav.ts` `makeWav()`; the `__savedChunks` save-picker stub idiom from `e2e/multitrack-audio.spec.ts` test 6.

- [ ] **Step 1: Write the e2e**

```ts
import { test, expect } from '@playwright/test';
import { makeWav } from './util/wav';

/** Full browser video-export journey (spec §10): author a short 2-scene project with audio,
 *  export through the real dialog, assert container magic bytes. Real ffmpeg.wasm encode. */
test.describe('video export', () => {
  for (const { format, check } of [
    { format: 'MP4 (H.264)', check: (b: Buffer) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
    { format: 'WebM (VP9)', check: (b: Buffer) => b.readUInt32BE(0) === 0x1a45dfa3 },
  ]) {
    test(`exports ${format} with playable container magic`, async ({ page }) => {
      test.slow(); // wasm core fetch + real encode
      await page.addInitScript(() => {
        const w = window as unknown as { __savedChunks?: Uint8Array[]; showSaveFilePicker?: unknown };
        w.__savedChunks = [];
        w.showSaveFilePicker = async () => ({
          createWritable: async () => ({
            write: async (chunk: Uint8Array) => void w.__savedChunks!.push(chunk),
            close: async () => {},
          }),
        });
      });
      await page.goto('/');

      // ~2s project: scene 1 (1s, animated rect) + scene 2 (1s) + an audio clip.
      const stage = page.locator('section[aria-label="Stage"]');
      const rectTool = page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true });
      const box = (await stage.locator('svg').first().boundingBox())!;
      await rectTool.click();
      await page.mouse.move(box.x + 40, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + 100);
      await page.mouse.up();
      await page.getByRole('button', { name: 'Select' }).click();
      await page.getByRole('button', { name: 'Add scene' }).click();
      await page.getByLabel('Scene duration').nth(0).fill('1');
      await page.getByLabel('Scene duration').nth(1).fill('1');
      await page.getByLabel('Import Audio').setInputFiles({ name: 't.wav', mimeType: 'audio/wav', buffer: makeWav() });
      await page.locator('section[aria-label="Assets"]').locator('[data-testid^="asset-"]').first().click();

      // Palette -> Export Video -> pick format -> Export.
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      await page.getByPlaceholder(/command/i).fill('Export Video');
      await page.keyboard.press('Enter');
      await page.getByLabel('Format').selectOption(format.startsWith('MP4') ? 'mp4' : 'webm');
      await page.getByRole('button', { name: 'Export', exact: true }).click();

      await expect
        .poll(async () => (await page.evaluate(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.length)), { timeout: 120_000 })
        .toBeGreaterThan(0);
      const bytes = Buffer.concat(
        (await page.evaluate(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.map((c) => Array.from(c)))).map((a) => Buffer.from(a)),
      );
      expect(bytes.length).toBeGreaterThan(2000); // non-trivial encode
      expect(check(bytes)).toBe(true);
    });
  }
});
```

NOTE: the palette-open keystroke and input placeholder must match the real CommandPalette —
read `apps/react/src/ui/components/CommandPalette/CommandPalette.tsx` and `e2e/command-palette.spec.ts`
first and use exactly the gestures/selectors that spec uses.

- [ ] **Step 2: Run it** — `node_modules/.bin/playwright test e2e/video-export.spec.ts` (kill stale vite first: `pkill -f vite`).
Expected: PASS both formats. If WebM fails only at concat: re-check Task 1's smoke result before touching code.

- [ ] **Step 3: Full verification gauntlet**

Run: `node_modules/.bin/vitest run` then `node_modules/.bin/tsc --noEmit` then `node_modules/.bin/eslint .` then `node_modules/.bin/playwright test`
Expected: ALL green (report exact counts).

- [ ] **Step 4: INDEX update** — replace the "IN FLIGHT (2026-09-12)" paragraph in `docs/superpowers/INDEX.md` with a completed entry naming the merged commit hashes and the M10 backend note (keep the note verbatim — it stays live).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(video): e2e export journey (MP4 + WebM magic bytes) + INDEX"`
