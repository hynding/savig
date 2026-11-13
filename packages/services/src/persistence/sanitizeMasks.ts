import type { Asset, Project, Scene, SceneObject } from '@savig/engine';

// Mask layers (spec 2026-11-13): load-time shape check for SceneObject.isMask / maskedBy. A
// malformed value is dropped (the object then renders as an ordinary, unmasked object). Link
// SEMANTICS (dangling / not-a-mask / self) are left to the renderer's honour rules + validate.
// Returns the same object/array/project when nothing changes, so clean files stay reference-equal.

function sanitizeObject(o: SceneObject): SceneObject {
  const badMask = 'isMask' in o && o.isMask !== true;
  const badLink = 'maskedBy' in o && (typeof o.maskedBy !== 'string' || o.maskedBy.length === 0);
  if (!badMask && !badLink) return o;
  const out = { ...o };
  if (badMask) delete out.isMask;
  if (badLink) delete out.maskedBy;
  return out;
}

function sanitizeList(objects: SceneObject[]): SceneObject[] {
  if (!Array.isArray(objects)) return objects;
  let changed = false;
  const next = objects.map((o) => {
    if (!o || typeof o !== 'object') return o;
    const s = sanitizeObject(o);
    if (s !== o) changed = true;
    return s;
  });
  return changed ? next : objects;
}

export function sanitizeMasks(project: Project): Project {
  const objects = sanitizeList(project.objects);
  const scenes = Array.isArray(project.scenes)
    ? (() => {
        let changed = false;
        const next = project.scenes!.map((sc: Scene) => {
          const objs = sanitizeList(sc.objects);
          if (objs === sc.objects) return sc;
          changed = true;
          return { ...sc, objects: objs };
        });
        return changed ? next : project.scenes;
      })()
    : project.scenes;
  const assets = Array.isArray(project.assets)
    ? (() => {
        let changed = false;
        const next = project.assets.map((a: Asset) => {
          if (!a || a.kind !== 'symbol') return a;
          const objs = sanitizeList(a.objects);
          if (objs === a.objects) return a;
          changed = true;
          return { ...a, objects: objs };
        });
        return changed ? next : project.assets;
      })()
    : project.assets;
  if (objects === project.objects && scenes === project.scenes && assets === project.assets) return project;
  return { ...project, objects, assets, ...(scenes !== undefined ? { scenes } : {}) };
}
