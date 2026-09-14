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
  // -row-mt/-tile-columns/-threads pin vp9 off its multithreaded code paths — Task 1's slice-1
  // smoke probe (ffmpegClient.ts) proved this single-threaded @ffmpeg/core@0.12.10 build needs
  // it to avoid a "RuntimeError: memory access out of bounds" wasm trap across repeated vp9
  // execs; harmless defense-in-depth here too (one exec per run, spec §6 amendment).
  webm: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p', '-row-mt', '0', '-tile-columns', '0', '-threads', '1'],
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

/** WebM single-pass VIDEO-ONLY encode (spec §6 amendment). Splits the audio out of the vp9
 *  exec's argv so the audio-finish step (below) can be pure stream-copy — the SAME pattern
 *  `concatMuxArgs` already proves safe for MP4. This is a real, verified fix for one distinct
 *  bug (an ffmpeg CLI parse error when `-frames:v` preceded a second `-i`) but does NOT fully
 *  resolve a separate, still-unresolved defect: real (non-solid, rasterized) frame content
 *  reliably wasm-traps this vendored @ffmpeg/core@0.12.10 libvpx-vp9 build
 *  ("RuntimeError: memory access out of bounds"), confirmed via the real ffmpeg 'log' event
 *  stream (not guessed) — with NO audio at all, it reproduces at every tested width from 40px
 *  up (succeeds only at width=16, the dialog's own hard minimum); WITH audio present in the
 *  project it reproduces even AT width=16. See the WIDTH DEVIATION note in
 *  e2e/video-export.spec.ts for the full picture — flagged for the controller/next task, not
 *  resolved here. Produces `mid.webm` when the project has audio (finished by
 *  `singlePassMuxArgs` below), or `out.webm` directly when it doesn't (no second exec needed).
 */
export function singlePassArgs(spec: VideoArgsSpec): string[] {
  return [
    '-framerate', String(spec.fps), '-i', 'frame%05d.jpg', '-frames:v', String(spec.frameCount),
    ...VIDEO_CODEC[spec.format],
    spec.hasAudio ? `mid.${spec.format}` : `out.${spec.format}`,
  ];
}

/** Second exec for a webm project WITH audio (see `singlePassArgs` doc): pure stream-copy of the
 *  vp9 video already encoded to `mid.webm`, muxed with `mix.wav` — no video re-encode, so this
 *  step never runs vp9 at all (the same `-c:v copy` pattern `concatMuxArgs` proves safe for
 *  MP4). */
export function singlePassMuxArgs(spec: VideoArgsSpec): string[] {
  return [
    '-i', `mid.${spec.format}`, '-i', 'mix.wav',
    '-c:v', 'copy', '-c:a', 'libopus', '-b:a', '128k', '-shortest',
    `out.${spec.format}`,
  ];
}

export function videoMime(format: VideoFormat): string {
  return format === 'mp4' ? 'video/mp4' : 'video/webm';
}
