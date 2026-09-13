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
