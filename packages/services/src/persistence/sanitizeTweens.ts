import { MAX_SHAPE_HINTS } from '@savig/engine';
import type { FrameKey, Project, SceneObject, ShapeHint, ShapeTween } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Shape tween (spec 2026-11-13-shape-tween §Model): load-time shape check for FrameKey.tween.
// The morph itself is ordinary baked track data; only the marker is checked. A malformed
// marker (wrong kind, non-string/object easing, non-string created ids) is dropped. Returns
// the same object when nothing changes, so clean files stay reference-equal.

function cleanTween(t: unknown): ShapeTween | null {
  if (!t || typeof t !== 'object') return null;
  const r = t as Record<string, unknown>;
  if (r.kind !== 'shape') return null;
  const out: ShapeTween = { kind: 'shape' };
  if (typeof r.easing === 'string' || (r.easing && typeof r.easing === 'object')) out.easing = r.easing as ShapeTween['easing'];
  if (Array.isArray(r.created)) {
    const ids = r.created.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (ids.length > 0) out.created = ids;
  }
  // Shape hints (spec 2026-11-14-shape-hints): keep well-formed {a:{x,y}, b:{x,y}} pairs, ≤ 26.
  if (Array.isArray(r.hints)) {
    const pt = (p: unknown) => !!p && typeof p === 'object' && Number.isFinite((p as { x: unknown }).x) && Number.isFinite((p as { y: unknown }).y);
    const hints = r.hints
      .filter((h): h is ShapeHint => !!h && typeof h === 'object' && pt((h as ShapeHint).a) && pt((h as ShapeHint).b))
      .slice(0, MAX_SHAPE_HINTS)
      .map((h) => ({ a: { x: h.a.x, y: h.a.y }, b: { x: h.b.x, y: h.b.y } }));
    if (hints.length > 0) out.hints = hints;
  }
  return out;
}

function sanitizeObject(o: SceneObject): SceneObject {
  const keys = o.frames?.keys;
  if (!Array.isArray(keys) || !keys.some((k) => k && 'tween' in k)) return o;
  let changed = false;
  const next = keys.map((k: FrameKey) => {
    if (!k || !('tween' in k)) return k;
    const t = cleanTween(k.tween);
    if (t && JSON.stringify(t) === JSON.stringify(k.tween)) return k;
    changed = true;
    const out = { ...k };
    if (t) out.tween = t;
    else delete out.tween;
    return out;
  });
  return changed ? { ...o, frames: { ...o.frames!, keys: next } } : o;
}

export function sanitizeTweens(project: Project): Project {
  return sanitizeAllObjects(project, sanitizeObject);
}
