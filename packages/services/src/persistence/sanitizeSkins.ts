import type { Mat2D, Project, SceneObject, SkinSpec } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Bone skinning (spec 2026-11-14-bone-skinning §Model): load-time shape check for SceneObject.skin.
// A skin on a group, an empty/non-string bone list, a bind that isn't six finite numbers, or a
// weight row that isn't one finite non-negative number per bone drops the whole skin (the drawing
// renders undeformed). Rows are renormalized to sum to 1 (an all-zero row drops the skin). A skin
// whose node count doesn't match its path is left to the renderer, which falls back per frame.
// Same object back when nothing changes.

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanSkin(s: unknown): SkinSpec | null {
  if (!s || typeof s !== 'object') return null;
  const r = s as Record<string, unknown>;
  const bones = r.bones;
  if (!Array.isArray(bones) || bones.length === 0 || !bones.every((b) => typeof b === 'string' && b) || new Set(bones).size !== bones.length) return null;
  const binds = r.binds;
  if (!Array.isArray(binds) || binds.length !== bones.length) return null;
  if (!binds.every((m) => Array.isArray(m) && m.length === 6 && m.every(finite))) return null;
  const weights = r.weights;
  if (!Array.isArray(weights) || weights.length === 0) return null;
  const rows: number[][] = [];
  for (const row of weights) {
    if (!Array.isArray(row) || row.length !== bones.length || !row.every((w) => finite(w) && w >= 0)) return null;
    const sum = (row as number[]).reduce((a, w) => a + w, 0);
    if (!(sum > 0)) return null;
    rows.push(Math.abs(sum - 1) < 1e-9 ? (row as number[]) : (row as number[]).map((w) => w / sum));
  }
  return { bones: bones as string[], binds: binds as Mat2D[], weights: rows };
}

function sanitizeObject(o: SceneObject): SceneObject {
  if (!('skin' in o)) return o;
  const s = o.isGroup ? null : cleanSkin(o.skin);
  if (s && JSON.stringify(s) === JSON.stringify(o.skin)) return o;
  const out = { ...o };
  if (s) out.skin = s;
  else delete out.skin;
  return out;
}

export function sanitizeSkins(project: Project): Project {
  return sanitizeAllObjects(project, sanitizeObject);
}
