// Audio lip sync (roadmap 12): drive a mouth symbol from a voice clip, like Animate's Lip Sync.
// The symbol holds the mouth POSES on its own timeline: pose 0 is the rest (closed) mouth and
// later poses open wider. Each frame of the clip, its loudness picks a pose, and the instance's
// time-remap track (`symbolTimeTrack`) is keyed so the instance shows that pose. Loudness only
// (no phoneme recognition): quiet = rest, louder = wider. Pure and deterministic.
import { symbolEffectiveDuration } from './duration';
import type { Keyframe, SceneObject, SymbolAsset } from './types';

/** Per-frame RMS loudness (0..1) of `samples` from `from` to `to` seconds, one value per 1/fps. */
export function frameLoudness(samples: Float32Array, sampleRate: number, fps: number, from = 0, to?: number, gain = 1): number[] {
  if (!(sampleRate > 0) || !(fps > 0)) return [];
  const total = samples.length / sampleRate;
  const start = Math.max(0, from);
  const end = Math.min(total, to ?? total);
  if (end <= start) return [];
  const frames = Math.ceil((end - start) * fps - 1e-9);
  const out: number[] = [];
  for (let f = 0; f < frames; f++) {
    const a = Math.floor((start + f / fps) * sampleRate);
    const b = Math.min(Math.floor(Math.min(end, start + (f + 1) / fps) * sampleRate), samples.length);
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i] * samples[i];
    out.push(b > a ? Math.min(1, Math.sqrt(sum / (b - a)) * gain) : 0);
  }
  return out;
}

/** The internal times of the symbol's mouth poses, in order. A symbol whose top level holds a
 *  frame-by-frame layer uses that layer's keys (the first layer found); otherwise every frame of
 *  the symbol's timeline is a pose. Always at least one pose (time 0). */
export function lipSyncPoseTimes(symbol: SymbolAsset, fps: number): number[] {
  const layer = symbol.objects.find((o: SceneObject) => !o.parentId && o.isGroup && o.frames && o.frames.keys.length > 0);
  if (layer?.frames) return [...layer.frames.keys].map((k) => k.time).sort((a, b) => a - b);
  const dur = symbolEffectiveDuration(symbol);
  const n = Math.max(1, Math.round(dur * fps) + (dur > 0 ? 1 : 0));
  return Array.from({ length: Math.min(n, 64) }, (_, i) => i / fps);
}

export interface LipSyncOptions {
  /** 0..1: higher opens the mouth on quieter sound (default 0.5). */
  sensitivity?: number;
  /** Shortest time (frames) a pose is held, to stop flicker (default 2). */
  minHold?: number;
}

/** Pick a pose index (0 = rest … poseCount-1 = widest) for every frame of `levels`. Levels are
 *  normalized against the clip's loud end (95th percentile), so a quiet recording still opens. */
export function lipSyncPoses(levels: readonly number[], poseCount: number, opts: LipSyncOptions = {}): number[] {
  const n = Math.max(1, Math.floor(poseCount));
  if (levels.length === 0) return [];
  if (n === 1) return levels.map(() => 0);
  const sens = Math.min(1, Math.max(0, opts.sensitivity ?? 0.5));
  const minHold = Math.max(1, Math.round(opts.minHold ?? 2));
  const sorted = [...levels].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const ref = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
  if (!(ref > 1e-4)) return levels.map(() => 0);
  // Silence gate: 30% of the loud level at sensitivity 0, 5% at sensitivity 1.
  const gate = 0.3 - 0.25 * sens;
  const raw = levels.map((v) => {
    const x = Number.isFinite(v) ? Math.min(1, v / ref) : 0;
    if (x < gate) return 0;
    const t = (x - gate) / (1 - gate);
    return Math.min(n - 1, 1 + Math.floor(t * (n - 1)));
  });
  // Hold: a pose shorter than minHold frames takes its predecessor's pose.
  const out = raw.slice();
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j < out.length && out[j] === out[i]) j++;
    if (j - i < minHold && i > 0) for (let k = i; k < j; k++) out[k] = out[i - 1];
    i = j;
  }
  return out;
}

/** A gap (seconds) before each pose change: the remap jumps between the two keys, so the time
 *  never lingers on an in-between pose at frame times. */
const STEP = 1e-3;

/** The `symbolTimeTrack` that shows `poses[f]` (indexes into `poseTimes`) at `startTime + f/fps`,
 *  then returns to the rest pose when the clip ends. */
export function lipSyncTrack(poses: readonly number[], poseTimes: readonly number[], startTime: number, fps: number): Keyframe[] {
  if (poses.length === 0 || poseTimes.length === 0) return [];
  const at = (p: number) => poseTimes[Math.max(0, Math.min(poseTimes.length - 1, p))];
  const keys: Keyframe[] = [];
  const push = (time: number, value: number) => keys.push({ time: Math.max(0, time), value, easing: 'linear' });
  const t0 = Math.max(0, startTime);
  push(t0, at(poses[0]));
  for (let f = 1; f <= poses.length; f++) {
    const next = f < poses.length ? poses[f] : 0;
    const prev = poses[f - 1];
    if (next === prev) continue;
    const t = t0 + f / fps;
    push(t - STEP, at(prev));
    push(t, at(next));
  }
  // Rest before the clip (when it starts later than 0) so the mouth is closed until it speaks.
  if (t0 > STEP && poses[0] !== 0) keys.unshift({ time: t0 - STEP, value: at(0), easing: 'linear' });
  if (t0 > 0) keys.unshift({ time: 0, value: at(0), easing: 'linear' });
  // Dedupe equal times (keep the last).
  const out: Keyframe[] = [];
  for (const k of keys) {
    if (out.length && Math.abs(out[out.length - 1].time - k.time) < 1e-9) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}
