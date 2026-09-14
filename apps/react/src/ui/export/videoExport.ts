// Orchestrator (spec §3): frames -> audio -> segment encode -> concat+mux, over a SNAPSHOT of
// (project, binaries) captured by the caller at dialog-confirm (spec §8) — edits during a long
// export can never tear the output. Every stage is injectable for jsdom tests; the defaults
// are the real implementations. Cancel: AbortSignal checked between frames and segments;
// terminate() kills any in-flight exec; resolves null (no partial file ever saved).
import { computeProjectDuration } from '@savig/engine';
import type { Project } from '@savig/engine';
import {
  WEBM_MAX_FRAMES, concatListText, concatMuxArgs, encodeWav, evenDim, segmentEncodeArgs,
  segmentPlan, singlePassArgs, singlePassMuxArgs, videoMime, type VideoFormat,
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

// jsdom (test env) does not implement Blob#arrayBuffer (see readFile.ts's established
// FileReader workaround) — FileReader works in both jsdom and real browsers.
function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read frame blob'));
    reader.readAsArrayBuffer(blob);
  });
}

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
  // RULING (spec §6 amendment): the webm cap fails BEFORE any ffmpeg work — no core load, no
  // audio render — the moment frameCount is known.
  if (opts.format === 'webm' && frameCount > WEBM_MAX_FRAMES) {
    throw new Error(
      `WebM export is capped at ${WEBM_MAX_FRAMES} frames (${frameCount} requested): lower the fps, shorten the project, or export MP4.`,
    );
  }

  // Weighted-total progress state: each term is "completed fraction of that stage".
  const done = { audio: 0, frames: 0, encode: 0, finalize: 0 };
  const report = (phase: VideoPhase, stageFraction: number) => {
    done[phase] = Math.max(done[phase], Math.min(1, stageFraction)); // never regresses
    const total = (Object.keys(WEIGHT) as VideoPhase[]).reduce((sum, k) => sum + WEIGHT[k] * done[k], 0);
    onProgress(phase, Math.min(1, total));
  };

  const ffmpeg = await d.makeFfmpeg();
  // spec §8: terminate() must kill a RUNNING exec, not just be polled between awaits — the
  // between-await `signal.aborted` checks below cover the gaps, this listener covers mid-exec.
  // @ffmpeg/ffmpeg's terminate() rejects the in-flight exec (ERROR_TERMINATED) rather than
  // resolving it; the catch below routes that rejection to the same cancelled/null path as
  // AbortedError by checking `signal.aborted` rather than matching the rejection's shape.
  const onAbort = () => ffmpeg.terminate();
  signal.addEventListener('abort', onAbort);
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

    if (opts.format === 'webm') {
      // RULING (spec §6 amendment): vp9 on this wasm core traps on a 2nd exec per instance —
      // webm encodes SINGLE-PASS (cap already checked above, before any ffmpeg work).
      for (let i = 0; i < frameCount; i++) {
        if (signal.aborted) throw new AbortedError();
        const svg = src.frameSvg(i / fps);
        const blob = await d.rasterize(svg, width, height, BACKGROUND);
        await ffmpeg.writeFile(`frame${String(i).padStart(5, '0')}.jpg`, await blobToBytes(blob));
        report('frames', (i + 1) / frameCount);
      }
      if (signal.aborted) throw new AbortedError();
      // singlePassArgs is VIDEO-ONLY (see its doc): keeping the vp9 exec's argv audio-free lets
      // the audio-finish step (below) be pure stream-copy, the SAME pattern `concatMuxArgs`
      // already proves safe for MP4 — one less variable while this core's real-content ceiling
      // for vp9 (see the doc) remains only partially understood.
      await ffmpeg.exec(singlePassArgs(spec), (p) => report('encode', p * (spec.hasAudio ? 0.9 : 1)));
      if (spec.hasAudio) {
        if (signal.aborted) throw new AbortedError();
        await ffmpeg.exec(singlePassMuxArgs(spec));
      }
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
          await ffmpeg.writeFile(`frame${String(i).padStart(5, '0')}.jpg`, await blobToBytes(blob));
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
    const bytes = await ffmpeg.readFile(`out.${opts.format}`);
    report('finalize', 1);
    return { bytes, filename: `${project.meta.name}.${opts.format}`, mime: videoMime(opts.format) };
  } catch (err) {
    if (err instanceof AbortedError) return null;
    // A running exec killed by onAbort's terminate() rejects with @ffmpeg/ffmpeg's own
    // ERROR_TERMINATED (a plain string, not an Error) — not our AbortedError — so match it by
    // signal state, not by inspecting the rejection's shape.
    if (signal.aborted) return null;
    throw err;
  } finally {
    signal.removeEventListener('abort', onAbort);
    ffmpeg.terminate();
  }
}

class AbortedError extends Error {
  constructor() {
    super('export cancelled');
  }
}
