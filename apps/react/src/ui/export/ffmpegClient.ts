// Per-run ffmpeg.wasm instance (spec §3): ONE FFmpeg per export run — clean cancel/FS
// lifecycle; the wasm bytes themselves stay in the browser HTTP cache across runs. Core assets
// resolve via Vite `?url` from the npm package (spec §2 — no CDN, nothing committed).
// Single-threaded core only: no COOP/COEP, no SharedArrayBuffer.
import coreJsUrl from '@ffmpeg/core?url';
import coreWasmUrl from '@ffmpeg/core/wasm?url';

export interface FfmpegClient {
  writeFile(name: string, data: Uint8Array): Promise<void>;
  /** onProgress receives ffmpeg's 0..1 ratio for THIS exec. */
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
 *  (the established savigSeek test-contract idiom) and exercised by video-ffmpeg-smoke.spec.
 *
 *  DEVIATION FROM BRIEF (verified via manual reproduction, see task-1-report.md): the
 *  brief's original single-shared-FFmpeg-instance sketch crashes ("RuntimeError: memory
 *  access out of bounds") when the vp9/webm path runs a 2nd `exec()` on the same instance —
 *  this @ffmpeg/core@0.12.10 single-threaded build doesn't fully reset libvpx-vp9's internal
 *  encoder state between invocations. A fresh FFmpeg instance per segment-encode (and per
 *  concat), plus pinning vp9 off its row/tile multithreading paths, avoids the corruption.
 *  Frame size is bumped 32x32 -> 64x64: vp9 in this build also crashes on the FIRST exec at
 *  32x32 even with a fresh instance (likely a superblock-size edge case at that resolution). */
export async function probeFfmpeg(): Promise<{ codecs: string; concatOk: { mp4: boolean; webm: boolean } }> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');

  async function newFfmpeg(onLog?: (message: string) => void) {
    const ff = new FFmpeg();
    if (onLog) ff.on('log', ({ message }) => onLog(message));
    await ff.load({ coreURL: coreJsUrl, wasmURL: coreWasmUrl });
    return ff;
  }
  async function readBinary(ff: Awaited<ReturnType<typeof newFfmpeg>>, name: string): Promise<Uint8Array> {
    const out = await ff.readFile(name);
    if (typeof out === 'string') throw new Error('ffmpeg: expected binary file');
    return out;
  }

  const logs: string[] = [];
  const codecsFf = await newFfmpeg((m) => logs.push(m));
  await codecsFf.exec(['-codecs']);
  codecsFf.terminate();
  const codecs = logs.join('\n');

  const jpeg = await tinyJpeg();
  const concatOk = { mp4: false, webm: false };
  for (const format of ['mp4', 'webm'] as const) {
    const codecArgs = format === 'mp4'
      ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']
      // -row-mt/-tile-columns/-threads pin vp9 off its multithreaded code paths — required
      // for this single-threaded core build to avoid the state-corruption crash (see above).
      : ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '0', '-tile-columns', '0', '-threads', '1', '-pix_fmt', 'yuv420p'];
    try {
      const segBytes: Uint8Array[] = [];
      for (let seg = 0; seg < 2; seg++) {
        // A fresh instance per segment: reusing one FFmpeg instance across multiple vp9
        // exec() calls corrupts encoder state in this core version (see file-level doc).
        const ff = await newFfmpeg();
        // ffmpeg.writeFile transfers the Uint8Array's underlying ArrayBuffer to the worker
        // (detaching it here), so each write needs its own buffer — .slice() copies it.
        for (let i = 0; i < 4; i++) await ff.writeFile(`frame${String(i).padStart(5, '0')}.jpg`, jpeg.slice());
        await ff.exec(['-framerate', '4', '-i', 'frame%05d.jpg', '-frames:v', '4', ...codecArgs, `seg_${seg}.${format}`]);
        segBytes.push(await readBinary(ff, `seg_${seg}.${format}`));
        ff.terminate();
      }
      const concatFf = await newFfmpeg();
      await concatFf.writeFile(`seg_0.${format}`, segBytes[0]);
      await concatFf.writeFile(`seg_1.${format}`, segBytes[1]);
      await concatFf.writeFile('list.txt', new TextEncoder().encode(`file 'seg_0.${format}'\nfile 'seg_1.${format}'\n`));
      await concatFf.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c:v', 'copy', `out.${format}`]);
      const out = await readBinary(concatFf, `out.${format}`);
      concatFf.terminate();
      concatOk[format] = out.length > 500;
    } catch {
      concatOk[format] = false;
    }
  }
  return { codecs, concatOk };
}

async function tinyJpeg(): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  // 64x64, not 32x32 (see probeFfmpeg's file-level doc): the vp9 encoder in this core
  // build crashes on frames smaller than this, even on a fresh instance.
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a90d9';
  ctx.fillRect(0, 0, 64, 64);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.92),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
