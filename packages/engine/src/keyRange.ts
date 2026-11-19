// Multi-keyframe editing (spec 2026-11-19-key-selection): one rule set for every time-keyed
// channel of an object — property tracks, shape, colour, gradient, dash offset, trim, motion-path
// progress, time remap and filter params — so a range of keys can be moved, stretched, reversed,
// deleted, copied and pasted together.
import { TRIM_TRACK_KEYS } from './trim';
import type { CubicBezierEasing, Easing, SceneObject } from './types';

/** Keys within this of each other are the same instant. */
const EPS = 1e-6;

interface Keyed {
  time: number;
}

/** A closed time range [start, end] (seconds). */
export interface KeyRange {
  start: number;
  end: number;
}

/** Every keyframe channel of `obj` as a stable key -> track map (absent channels omitted). The
 *  keys name the channel: `tracks.x`, `shape`, `color.fill`, `gradient.stroke`, `dash`,
 *  `trim.start`, `progress`, `remap`, `filter.<filterId>.<param>`. */
export function keyChannels(obj: SceneObject): Map<string, Keyed[]> {
  const out = new Map<string, Keyed[]>();
  const add = (k: string, t: Keyed[] | undefined) => {
    if (t && t.length > 0) out.set(k, t);
  };
  for (const [p, t] of Object.entries(obj.tracks)) add(`tracks.${p}`, t);
  add('shape', obj.shapeTrack);
  for (const p of ['fill', 'stroke'] as const) {
    add(`color.${p}`, obj.colorTracks?.[p]);
    add(`gradient.${p}`, obj.gradientTracks?.[p]);
  }
  add('dash', obj.dashOffsetTrack);
  for (const [prop, key] of Object.entries(TRIM_TRACK_KEYS)) add(`trim.${prop}`, obj.trim?.[key]);
  add('progress', obj.motionPath?.progress);
  add('remap', obj.symbolTimeTrack);
  for (const [k, t] of Object.entries(obj.filterTracks ?? {})) add(`filter.${k}`, t);
  return out;
}

/** `obj` with channel `channel` replaced by `track` (an empty track removes the channel where the
 *  model allows; trim/progress keep their container). */
export function withKeyChannel(obj: SceneObject, channel: string, track: Keyed[]): SceneObject {
  const dot = channel.indexOf('.');
  const head = dot < 0 ? channel : channel.slice(0, dot);
  const rest = dot < 0 ? '' : channel.slice(dot + 1);
  const t = track as never;
  const empty = track.length === 0;
  switch (head) {
    case 'tracks': {
      const tracks = { ...obj.tracks };
      if (empty) delete tracks[rest as keyof typeof tracks];
      else tracks[rest as keyof typeof tracks] = t;
      return { ...obj, tracks };
    }
    case 'shape': {
      const out = { ...obj };
      if (empty) delete out.shapeTrack;
      else out.shapeTrack = t;
      return out;
    }
    case 'color':
    case 'gradient': {
      const field = head === 'color' ? 'colorTracks' : 'gradientTracks';
      const map = { ...(obj[field] ?? {}) } as Record<string, unknown>;
      if (empty) delete map[rest];
      else map[rest] = t;
      const out = { ...obj };
      if (Object.keys(map).length === 0) delete out[field];
      else (out as Record<string, unknown>)[field] = map;
      return out;
    }
    case 'dash': {
      const out = { ...obj };
      if (empty) delete out.dashOffsetTrack;
      else out.dashOffsetTrack = t;
      return out;
    }
    case 'trim': {
      if (!obj.trim) return obj;
      const key = TRIM_TRACK_KEYS[rest as keyof typeof TRIM_TRACK_KEYS];
      const trim = { ...obj.trim };
      if (empty) delete trim[key];
      else trim[key] = t;
      return { ...obj, trim };
    }
    case 'progress':
      return obj.motionPath ? { ...obj, motionPath: { ...obj.motionPath, progress: t } } : obj;
    case 'remap': {
      const out = { ...obj };
      if (empty) delete out.symbolTimeTrack;
      else out.symbolTimeTrack = t;
      return out;
    }
    case 'filter': {
      const map = { ...(obj.filterTracks ?? {}) };
      if (empty) delete map[rest];
      else map[rest] = t;
      const out = { ...obj };
      if (Object.keys(map).length === 0) delete out.filterTracks;
      else out.filterTracks = map;
      return out;
    }
    default:
      return obj;
  }
}

const inRange = (t: number, r: KeyRange) => t >= r.start - EPS && t <= r.end + EPS;
const sameTime = (a: number, b: number) => Math.abs(a - b) < EPS;
const byTime = (a: Keyed, b: Keyed) => a.time - b.time;

/** Times of every key of `obj` inside `range`, deduplicated and sorted. */
export function keyTimesInRange(obj: SceneObject, range: KeyRange): number[] {
  const times: number[] = [];
  for (const track of keyChannels(obj).values()) {
    for (const k of track) if (inRange(k.time, range) && !times.some((t) => sameTime(t, k.time))) times.push(k.time);
  }
  return times.sort((a, b) => a - b);
}

/** Apply `edit` to every channel's in-range keys: it gets them (sorted) and returns their
 *  replacements; keys outside the range stay, except where a replacement lands on one (the moved
 *  key wins, as in Flash). */
function editRange(obj: SceneObject, range: KeyRange, edit: <K extends Keyed>(picked: K[]) => K[]): SceneObject {
  let out = obj;
  for (const [channel, track] of keyChannels(obj)) {
    const picked = track.filter((k) => inRange(k.time, range)).sort(byTime);
    if (picked.length === 0) continue;
    const moved = edit(picked);
    const kept = track.filter((k) => !inRange(k.time, range) && !moved.some((m) => sameTime(m.time, k.time)));
    out = withKeyChannel(out, channel, [...kept, ...moved].sort(byTime));
  }
  return out;
}

const retimed = <K extends Keyed>(k: K, time: number): K => ({ ...k, time: Math.max(0, time) });

/** Move every key of `obj` inside `range` by `dt` seconds (clamped at 0). */
export function shiftKeys(obj: SceneObject, range: KeyRange, dt: number): SceneObject {
  if (dt === 0) return obj;
  return editRange(obj, range, (picked) => picked.map((k) => retimed(k, k.time + dt)));
}

/** Stretch (or squeeze) the keys inside `range` so the range ends at `newEnd`, keeping `start`
 *  fixed. `snap` rounds each new time (e.g. to the frame grid); keys that collapse onto the same
 *  instant keep the later one. */
export function scaleKeys(obj: SceneObject, range: KeyRange, newEnd: number, snap: (t: number) => number = (t) => t): SceneObject {
  const span = range.end - range.start;
  if (span <= EPS || newEnd <= range.start) return obj;
  const factor = (newEnd - range.start) / span;
  return editRange(obj, range, (picked) => {
    const out: typeof picked = [];
    for (const k of picked) {
      const t = snap(range.start + (k.time - range.start) * factor);
      const i = out.findIndex((o) => sameTime(o.time, t));
      if (i >= 0) out.splice(i, 1);
      out.push(retimed(k, t));
    }
    return out;
  });
}

/** The easing that plays a segment backwards: ease-in <-> ease-out, curves mirrored. */
export function reverseEasing(e: Easing): Easing {
  if (typeof e === 'string') return e === 'easeIn' ? 'easeOut' : e === 'easeOut' ? 'easeIn' : e;
  const c = e as CubicBezierEasing; // p1,p2 = first control point; p3,p4 = second
  return { type: 'cubicBezier', p1: 1 - c.p3, p2: 1 - c.p4, p3: 1 - c.p1, p4: 1 - c.p2 };
}

/** Fields that describe the segment from a key INTO the next one; reversing moves them along with
 *  the segment. Correspondence maps can't be reversed and are dropped. */
const SEGMENT_FIELDS = ['easing', 'rotationMode', 'morph'] as const;

/** Play the keys inside `range` backwards: each key's time mirrors about the range's middle, and
 *  each segment's easing moves to the segment's new start key, reversed. The last key keeps the
 *  easing that led out of the range. */
export function reverseKeys(obj: SceneObject, range: KeyRange): SceneObject {
  return editRange(obj, range, (picked) => {
    const n = picked.length;
    const mirrored = picked.map((k) => retimed(k, range.start + range.end - k.time)).reverse();
    return mirrored.map((k, j) => {
      const copy = { ...k } as Record<string, unknown>;
      delete copy.correspondence;
      delete copy.nodeEasings;
      // New segment j -> j+1 is old segment (n-2-j) -> (n-1-j) played backwards.
      const src = (j < n - 1 ? picked[n - 2 - j] : picked[n - 1]) as unknown as Record<string, unknown>;
      for (const f of SEGMENT_FIELDS) {
        if (src[f] === undefined) delete copy[f];
        else copy[f] = f === 'easing' && j < n - 1 ? reverseEasing(src[f] as Easing) : src[f];
      }
      return copy as unknown as typeof k;
    });
  });
}

/** Remove every key of `obj` inside `range`. */
export function deleteKeys(obj: SceneObject, range: KeyRange): SceneObject {
  return editRange(obj, range, () => []);
}

/** A copied block of keys: per channel, keys with times relative to the block start. */
export type KeyBlock = Record<string, Keyed[]>;

/** Copy the keys of `obj` inside `range`, times relative to `range.start`. Deep-cloned. */
export function copyKeys(obj: SceneObject, range: KeyRange): KeyBlock {
  const block: KeyBlock = {};
  for (const [channel, track] of keyChannels(obj)) {
    const picked = track.filter((k) => inRange(k.time, range));
    if (picked.length) block[channel] = picked.map((k) => ({ ...structuredClone(k), time: k.time - range.start }));
  }
  return block;
}

/** Paste `block` into `obj` starting at `at`, replacing keys at the same instants. Channels the
 *  object can't hold (trim without a trim, progress without a motion path, a filter it doesn't
 *  have) are skipped. Returns the object unchanged when nothing applied. */
export function pasteKeys(obj: SceneObject, block: KeyBlock, at: number): SceneObject {
  let out = obj;
  const filterIds = new Set((obj.filters ?? []).map((f) => f.id));
  for (const [channel, keys] of Object.entries(block)) {
    if (channel.startsWith('trim.') && !obj.trim) continue;
    if (channel === 'progress' && !obj.motionPath) continue;
    if (channel.startsWith('filter.') && !filterIds.has(channel.slice(7).split('.')[0])) continue;
    const placed = keys.map((k) => ({ ...structuredClone(k), time: Math.max(0, at + k.time) }));
    const existing = keyChannels(out).get(channel) ?? [];
    const kept = existing.filter((k) => !placed.some((p) => sameTime(p.time, k.time)));
    out = withKeyChannel(out, channel, [...kept, ...placed].sort(byTime));
  }
  return out;
}

/** Length of a copied block (its last key's relative time). */
export function keyBlockSpan(block: KeyBlock): number {
  let span = 0;
  for (const keys of Object.values(block)) for (const k of keys) span = Math.max(span, k.time);
  return span;
}
