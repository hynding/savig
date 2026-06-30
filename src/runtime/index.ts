import {
  advance,
  computeProjectDuration,
  createClock,
  play,
  resolveActiveClips,
} from '../engine';
import type { AudioClip, Project } from '../engine';
import { applyProjectFrame } from './frame';

interface CreateOptions {
  svg: SVGSVGElement;
  project: Project;
  audio: Record<string, string>; // assetId -> base64
}

// Self-contained player bundled into savig-runtime.js. Drives the SVG
// imperatively from the shared engine core and schedules audio via Web Audio.
function create(options: CreateOptions): void {
  const { svg, project, audio } = options;
  const duration = computeProjectDuration(project);
  const nodes = new Map<string, Element>();
  svg.querySelectorAll('[data-savig-object]').forEach((node) => {
    const id = node.getAttribute('data-savig-object');
    if (id) nodes.set(id, node);
  });

  const apply = (time: number): void => {
    applyProjectFrame(svg, nodes, project, time);
  };

  let clock = createClock();
  const loop = (timestamp: number): void => {
    clock = advance(clock, timestamp / 1000, duration, project.meta.loop);
    apply(clock.time);
    if (clock.playing) requestAnimationFrame(loop);
  };

  const startAudio = createAudioStarter(project.audioClips, audio);
  apply(0);
  clock = play(clock, performance.now() / 1000);
  startAudio();
  requestAnimationFrame(loop);

  // Expose a seek hook so tests can apply a deterministic frame without timing dependence.
  // Calling savigSeek(t) applies the frame at master time `t` synchronously; a subsequent
  // RAF tick will resume normal playback. Tests that need a stable snapshot should call
  // savigSeek AND read the DOM in the same page.evaluate() call (single JS task = no RAF
  // can interject between the two).
  (globalThis as unknown as { savigSeek: (t: number) => void }).savigSeek = apply;
}

function createAudioStarter(clips: AudioClip[], audio: Record<string, string>): () => void {
  return () => {
    if (clips.length === 0) return;
    const Ctx = (window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)!;
    const ctx = new Ctx();
    const decoded = new Map<string, AudioBuffer>();
    const decodeAll = clips.map(async (clip) => {
      if (decoded.has(clip.assetId) || !audio[clip.assetId]) return;
      const bytes = Uint8Array.from(atob(audio[clip.assetId]), (c) => c.charCodeAt(0));
      decoded.set(clip.assetId, await ctx.decodeAudioData(bytes.buffer));
    });
    void Promise.all(decodeAll).then(() => {
      for (const { clip } of resolveActiveClips(clips, 0)) schedule(ctx, decoded, clip);
      for (const clip of clips) if (clip.startTime > 0) schedule(ctx, decoded, clip);
    });
  };
}

function schedule(ctx: AudioContext, decoded: Map<string, AudioBuffer>, clip: AudioClip): void {
  const buffer = decoded.get(clip.assetId);
  if (!buffer) return;
  const gain = ctx.createGain();
  gain.gain.value = clip.volume;
  gain.connect(ctx.destination);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start(ctx.currentTime + Math.max(0, clip.startTime), clip.inPoint, clip.outPoint - clip.inPoint);
}

(globalThis as unknown as { SavigRuntime: { create: typeof create } }).SavigRuntime = { create };
