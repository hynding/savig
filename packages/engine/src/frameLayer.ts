// Frame-by-frame layers (spec 2026-11-07-frame-by-frame-design.md). A frame layer is an
// `isGroup` container carrying `frames` (its keyframes); each direct child is tagged with the
// `frameKeyId` it belongs to. A key's exposure window is DERIVED from the sorted key list, so
// spans can never overlap or leave gaps. Pure engine math shared by flattenInstances (render),
// duration, validate, and (later slices) the timeline + onion skin.

import type { FrameLayer, SceneObject } from './types';

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
