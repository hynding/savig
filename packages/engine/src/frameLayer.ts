// Frame-by-frame layers (spec 2026-11-07-frame-by-frame-design.md). A frame layer is an
// `isGroup` container carrying `frames` (its keyframes); each direct child is tagged with the
// `frameKeyId` it belongs to. A key's exposure window is DERIVED from the sorted key list, so
// spans can never overlap or leave gaps. Pure engine math shared by flattenInstances (render),
// duration, validate, and (later slices) the timeline + onion skin.

import { snapToFrame } from './keyframes';
import type { FrameKey, FrameLayer, SceneObject } from './types';

const EPS = 1e-6;

export interface FrameKeySpan {
  id: string;
  /** Inclusive start (seconds). */
  start: number;
  /** Exclusive end (seconds). */
  end: number;
}

/** Each key's half-open exposure window, sorted by start time. Key i ends where key i+1 starts;
 *  the last key ends at `layer.end`. Robust to unsorted input (sorts a copy, stable on ties). */
export function frameKeySpans(layer: FrameLayer): FrameKeySpan[] {
  const keys = layer.keys
    .map((k, i) => ({ k, i }))
    .sort((a, b) => a.k.time - b.k.time || a.i - b.i)
    .map(({ k }) => k);
  return keys.map((k, i) => ({
    id: k.id,
    start: k.time,
    end: i + 1 < keys.length ? keys[i + 1].time : layer.end,
  }));
}

/** True when `time` lies in the half-open window [start, end), epsilon-tolerant at both edges
 *  (a playhead a hair below a key's start still counts as that key — float frame math). */
export function spanContains(span: { start: number; end: number }, time: number): boolean {
  return time >= span.start - EPS && time < span.end - EPS;
}

/** The id of the key exposed at `time`, or null before the first key / from `end` on. */
export function exposedFrameKeyId(layer: FrameLayer, time: number): string | null {
  for (const span of frameKeySpans(layer)) {
    if (spanContains(span, time)) return span.id;
  }
  return null;
}

/** Is `obj` exposed at `time` by the frame layers in its ancestor chain?
 *
 *  Walks obj → parent → grandparent… (cycle-guarded, stopping at the first non-group parent,
 *  like `isRenderHidden`). At every link whose PARENT is a frame layer and whose own
 *  `frameKeyId` names one of that layer's keys, tests that key's window.
 *
 *  Returns `undefined` when no link is frame-controlled (the object is not under any frame
 *  layer key — callers emit nothing, preserving byte-identical parity), `false` when any
 *  controlling link is unexposed, else `true`. A missing or dangling `frameKeyId` on a
 *  frame-layer child is not controlling (always exposed — graceful degradation). */
export function isExposedAt(
  obj: SceneObject,
  objectsById: Map<string, SceneObject>,
  time: number,
): boolean | undefined {
  let controlled = false;
  const seen = new Set<string>([obj.id]);
  let node: SceneObject = obj;
  while (node.parentId && !seen.has(node.parentId)) {
    const parent = objectsById.get(node.parentId);
    if (!parent?.isGroup) break;
    seen.add(parent.id);
    if (parent.frames && node.frameKeyId) {
      const span = frameKeySpans(parent.frames).find((s) => s.id === node.frameKeyId);
      if (span) {
        controlled = true;
        if (!spanContains(span, time)) return false;
      }
    }
    node = parent;
  }
  return controlled ? true : undefined;
}

/** True when `obj` is a frame-layer container (a group carrying `frames`). */
export function isFrameLayer(obj: SceneObject): boolean {
  return !!obj.isGroup && !!obj.frames;
}

// --- Authoring ops (frame-by-frame slice 2) -------------------------------------------------
// Pure FrameLayer → FrameLayer transforms behind the editor's F5/F6/F7 verbs. Every time they
// write is re-snapped to the frame grid (`snapToFrame`) so repeated shifts never drift. They
// never touch children: a caller that drops a key also deletes the objects tagged with it.

/** The key that STARTS at `time` (epsilon-tolerant), if any. */
export function frameKeyAt(layer: FrameLayer, time: number): FrameKey | undefined {
  return layer.keys.find((k) => Math.abs(k.time - time) <= EPS);
}

function sortedKeys(keys: FrameKey[]): FrameKey[] {
  return keys
    .map((k, i) => ({ k, i }))
    .sort((a, b) => a.k.time - b.k.time || a.i - b.i)
    .map(({ k }) => k);
}

/** The key whose span holds `time`, or — past `end` — the LAST key (what F6 copies there).
 *  Null before the first key. */
export function frameKeyForCopy(layer: FrameLayer, time: number): FrameKey | null {
  const id = exposedFrameKeyId(layer, time);
  if (id) return layer.keys.find((k) => k.id === id) ?? null;
  const keys = sortedKeys(layer.keys);
  const last = keys[keys.length - 1];
  return last && time >= layer.end - EPS ? last : null;
}

/** Insert `key` in time order. Past `end`, `end` grows to one frame after the new key so it is
 *  on screen. The caller guarantees no key already starts at `key.time`. */
export function insertFrameKey(layer: FrameLayer, key: FrameKey, fps: number): FrameLayer {
  const time = snapToFrame(key.time, fps);
  const keys = sortedKeys([...layer.keys, { ...key, time }]);
  return { keys, end: Math.max(layer.end, snapToFrame(time + 1 / fps, fps)) };
}

/** F5: hold the drawing under `time` for `n` more frames — every key starting after `time`
 *  and `end` move right. At/after `end`, extends `end` to one frame past the playhead instead. */
export function insertFramesAt(layer: FrameLayer, time: number, n: number, fps: number): FrameLayer {
  if (time >= layer.end - EPS) return { keys: layer.keys, end: snapToFrame(time + 1 / fps, fps) };
  const d = n / fps;
  return {
    keys: layer.keys.map((k) => (k.time > time + EPS ? { ...k, time: snapToFrame(k.time + d, fps) } : k)),
    end: snapToFrame(layer.end + d, fps),
  };
}

/** Shift+F5: remove `n` frames at `time` — keys starting after `time` and `end` move left. When
 *  the span holding `time` is no longer than the removed frames, that key collapses and is
 *  dropped (`clearedKeyId`; its children must be deleted by the caller). Returns null when the
 *  removal is impossible: past `end`, too few empty frames before the first key, or the only
 *  key would collapse (a layer always keeps one key). */
export function removeFramesAt(
  layer: FrameLayer,
  time: number,
  n: number,
  fps: number,
): { layer: FrameLayer; clearedKeyId: string | null } | null {
  if (time >= layer.end - EPS) return null;
  const d = n / fps;
  const spans = frameKeySpans(layer);
  const holding = spans.find((s) => spanContains(s, time));
  let clearedKeyId: string | null = null;
  if (!holding) {
    // Empty frames before the first key: there must be at least `n` of them.
    if (spans.length > 0 && spans[0].start - time < d - EPS) return null;
  } else if (holding.end - holding.start <= d + EPS) {
    if (layer.keys.length <= 1) return null;
    clearedKeyId = holding.id;
  }
  const keys = layer.keys
    .filter((k) => k.id !== clearedKeyId)
    .map((k) => (k.time > time + EPS ? { ...k, time: snapToFrame(Math.max(0, k.time - d), fps) } : k));
  const lastKey = Math.max(...keys.map((k) => k.time));
  const end = Math.max(snapToFrame(layer.end - d, fps), snapToFrame(lastKey + 1 / fps, fps));
  return { layer: { keys, end }, clearedKeyId };
}

/** Drop key `id` (the previous key then holds across its span). Null when it is the only key. */
export function removeFrameKey(layer: FrameLayer, id: string): FrameLayer | null {
  if (layer.keys.length <= 1) return null;
  return { ...layer, keys: layer.keys.filter((k) => k.id !== id) };
}

/** Move key `id` to `time`, frame-snapped and clamped strictly between its neighbours (keys
 *  never reorder in v1). The last key may not reach `end`; the first may not go below 0. */
export function moveFrameKey(layer: FrameLayer, id: string, time: number, fps: number): FrameLayer {
  const keys = sortedKeys(layer.keys);
  const i = keys.findIndex((k) => k.id === id);
  if (i < 0) return layer;
  const f = 1 / fps;
  const lo = i > 0 ? keys[i - 1].time + f : 0;
  const hi = i + 1 < keys.length ? keys[i + 1].time - f : layer.end - f;
  if (hi < lo - EPS) return layer; // no room to move
  const t = snapToFrame(Math.min(Math.max(time, lo), hi), fps);
  return { ...layer, keys: keys.map((k) => (k.id === id ? { ...k, time: t } : k)) };
}

/** Set (or clear, with an empty/blank label) key `id`'s frame label. */
export function setFrameKeyLabel(layer: FrameLayer, id: string, label: string | undefined): FrameLayer {
  const trimmed = label?.trim();
  return {
    ...layer,
    keys: layer.keys.map((k) => {
      if (k.id !== id) return k;
      const rest: FrameKey = { id: k.id, time: k.time };
      return trimmed ? { ...rest, label: trimmed } : rest;
    }),
  };
}

/** `obj` without its `frameKeyId` (same object when it has none) — for objects that leave a
 *  frame layer, so no stale key tag survives a move to the root or into an ordinary group. */
export function withoutFrameKey<T extends SceneObject>(obj: T): T {
  if (obj.frameKeyId === undefined) return obj;
  const out = { ...obj };
  delete out.frameKeyId;
  return out;
}

// --- Onion skin (frame-by-frame slice 4) ----------------------------------------------------

/** The keys whose drawings onion-skin around `time`: up to `count` before and after the key on
 *  screen (nearest first). The reference is the exposed key's start, so the current drawing is
 *  never its own ghost; with no key exposed (before the first key / past `end`) it is `time`.
 *  `hasDrawing` (default: every key) skips blank keys — a ghost of nothing is no help, so the
 *  skin reaches past a blank key to the next real drawing. */
export function frameOnionKeys(
  layer: FrameLayer,
  time: number,
  count: number,
  hasDrawing: (keyId: string) => boolean = () => true,
): { before: FrameKeySpan[]; after: FrameKeySpan[] } {
  const spans = frameKeySpans(layer);
  const current = spans.find((s) => spanContains(s, time));
  const ref = current ? current.start : time;
  const usable = spans.filter((s) => s !== current && hasDrawing(s.id));
  return {
    before: usable.filter((s) => s.start < ref - EPS).reverse().slice(0, count),
    after: usable.filter((s) => s.start > ref + EPS).slice(0, count),
  };
}

/** Does scene object `obj` belong to key `keyId` of frame layer `layerId` — is it (or an
 *  ancestor below the layer) a direct child of the layer tagged with that key? Cycle-guarded. */
export function isInFrameKey(
  obj: SceneObject,
  objectsById: Map<string, SceneObject>,
  layerId: string,
  keyId: string,
): boolean {
  const seen = new Set<string>();
  for (let node: SceneObject | undefined = obj; node && !seen.has(node.id); node = node.parentId ? objectsById.get(node.parentId) : undefined) {
    seen.add(node.id);
    if (node.parentId === layerId) return node.frameKeyId === keyId;
  }
  return false;
}
