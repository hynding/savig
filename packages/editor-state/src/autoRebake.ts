// Automatic shape tween re-bake (spec 2026-11-14-tween-rebake): every commit checks whether the
// edit touched a tweened key's start drawings or its end drawings, in any object list (root,
// each scene, each symbol), and re-bakes those tweens inside the same commit — one undo step,
// no stale morphs. Key-timing edits already re-bake themselves (the layer's key list changed).
import { bakeSprings, collectReferencedAssetIds, computeProjectDuration, rebakeShapeTweens, staleShapeTweens } from '@savig/engine';
import type { Asset, Project, SceneObject } from '@savig/engine';

/** Drop vector/svg/text assets that `before` referenced and nothing references any more (a
 *  shape tween replaces each drawing's asset with a fresh path asset). */
export function pruneOrphanedAssets(before: Project, next: Project): Project {
  const was = collectReferencedAssetIds(before);
  const now = collectReferencedAssetIds(next);
  const assets = next.assets.filter((a) => a.kind === 'symbol' || a.kind === 'audio' || now.has(a.id) || !was.has(a.id));
  return assets.length === next.assets.length ? next : { ...next, assets };
}

type ListRef = { kind: 'root' } | { kind: 'scene'; id: string } | { kind: 'symbol'; id: string };

function lists(p: Project): Array<{ ref: ListRef; objects: SceneObject[] }> {
  const out: Array<{ ref: ListRef; objects: SceneObject[] }> = [];
  if (p.scenes) for (const s of p.scenes) out.push({ ref: { kind: 'scene', id: s.id }, objects: s.objects });
  else out.push({ ref: { kind: 'root' }, objects: p.objects });
  for (const a of p.assets) if (a.kind === 'symbol') out.push({ ref: { kind: 'symbol', id: a.id }, objects: a.objects });
  return out;
}

/** The object list `ref` names in `p` (empty when it doesn't exist there). */
function listOf(p: Project, ref: ListRef): SceneObject[] {
  if (ref.kind === 'root') return p.objects;
  if (ref.kind === 'scene') return p.scenes?.find((s) => s.id === ref.id)?.objects ?? [];
  const a = p.assets.find((x) => x.id === ref.id);
  return a && a.kind === 'symbol' ? a.objects : [];
}

function writeList(p: Project, ref: ListRef, objects: SceneObject[], assets: Asset[]): Project {
  if (ref.kind === 'root') return { ...p, objects, assets };
  if (ref.kind === 'scene') return { ...p, assets, scenes: p.scenes!.map((s) => (s.id === ref.id ? { ...s, objects } : s)) };
  return { ...p, assets: assets.map((a) => (a.id === ref.id && a.kind === 'symbol' ? { ...a, objects } : a)) };
}

/** `next` with every shape tween the `prev → next` edit left stale re-baked (same object when
 *  nothing is stale). */
export function autoRebakeTweens(prev: Project, next: Project): Project {
  if (prev === next) return next;
  let out = next;
  for (const { ref, objects } of lists(next)) {
    const stale = staleShapeTweens(listOf(prev, ref), objects, prev.assets, next.assets);
    if (stale.length === 0) continue;
    const res = rebakeShapeTweens(listOf(out, ref), out.assets, stale);
    out = writeList(out, ref, res.objects, res.assets);
  }
  return out === next ? next : pruneOrphanedAssets(prev, out);
}

/** Bone springs (spec 2026-11-14-bone-springs): `next` with every sprung bone's baked
 *  follow-through re-simulated when its object list, the fps or the duration changed (root
 *  objects, or each scene). Same object when nothing changed. Springs inside symbols are not
 *  simulated in v1. */
export function autoBakeSprings(prev: Project, next: Project): Project {
  if (prev === next) return next;
  const fps = next.meta.fps;
  const timingChanged = prev.meta.fps !== fps || computeProjectDuration(prev) !== computeProjectDuration(next);
  if (!next.scenes) {
    if (!timingChanged && prev.objects === next.objects) return next;
    const objects = bakeSprings(next.objects, fps, computeProjectDuration(next));
    return objects === next.objects ? next : { ...next, objects };
  }
  let changed = false;
  const scenes = next.scenes.map((s) => {
    const before = prev.scenes?.find((x) => x.id === s.id);
    if (!timingChanged && before?.objects === s.objects && before.duration === s.duration) return s;
    const objects = bakeSprings(s.objects, fps, s.duration);
    if (objects === s.objects) return s;
    changed = true;
    return { ...s, objects };
  });
  return changed ? { ...next, scenes } : next;
}
