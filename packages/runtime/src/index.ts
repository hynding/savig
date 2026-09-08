import {
  advance,
  computeProjectDuration,
  createClock,
  fadeEnvelopePoints,
  play,
  resolveActiveClips,
  resolveTrackState,
} from '@savig/engine';
import type { AudioClip, AudioTrack, Project } from '@savig/engine';
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

  const startAudio = createAudioStarter(project.audioClips, project.audioTracks, audio);
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

function createAudioStarter(
  clips: AudioClip[],
  tracks: AudioTrack[] | undefined,
  audio: Record<string, string>,
): () => void {
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
      const chains = new Map<string, GainNode>(); // trackId|'' -> chain INPUT node
      for (const { clip } of resolveActiveClips(clips, 0)) {
        schedule(ctx, decoded, clip, chainInput(ctx, chains, tracks, clip.trackId));
      }
      for (const clip of clips) {
        if (clip.startTime > 0) schedule(ctx, decoded, clip, chainInput(ctx, chains, tracks, clip.trackId));
      }
    });
  };
}

// Builds (and memoizes, per playback session) the mixer chain for one track: gain -> pan ->
// filter -> destination, mirroring the services audioEngine so exported playback matches the
// editor. Clips with no (or a dangling) trackId share the '' key = the implicit default track.
function chainInput(
  ctx: AudioContext,
  chains: Map<string, GainNode>,
  tracks: AudioTrack[] | undefined,
  trackId: string | undefined,
): GainNode {
  const key = trackId && tracks?.some((t) => t.id === trackId) ? trackId : '';
  const hit = chains.get(key);
  if (hit) return hit;
  const state = resolveTrackState(tracks, key || undefined);
  const input = ctx.createGain();
  input.gain.value = state.audible ? state.gain : 0;
  let tail: AudioNode = input;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = state.pan;
    tail.connect(p);
    tail = p;
  }
  if (state.filter) {
    const f = ctx.createBiquadFilter();
    f.type = state.filter.kind;
    f.frequency.value = state.filter.frequency;
    tail.connect(f);
    tail = f;
  }
  tail.connect(ctx.destination);
  chains.set(key, input);
  return input;
}

// The runtime always starts playback at time 0, so envelope timeline-times map directly onto
// ctx offsets from `base = ctx.currentTime` (unlike the editor engine's fromTime remap).
function schedule(ctx: AudioContext, decoded: Map<string, AudioBuffer>, clip: AudioClip, into: AudioNode): void {
  const buffer = decoded.get(clip.assetId);
  if (!buffer) return;
  const gain = ctx.createGain();
  const envelope = fadeEnvelopePoints(clip, 0);
  if (((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0) && envelope.length) {
    const base = ctx.currentTime;
    gain.gain.setValueAtTime(clip.volume * envelope[0].gain, base + envelope[0].t);
    for (const p of envelope.slice(1)) gain.gain.linearRampToValueAtTime(clip.volume * p.gain, base + p.t);
  } else {
    gain.gain.value = clip.volume;
  }
  gain.connect(into);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start(ctx.currentTime + Math.max(0, clip.startTime), clip.inPoint, clip.outPoint - clip.inPoint);
}

(globalThis as unknown as { SavigRuntime: { create: typeof create } }).SavigRuntime = { create };
