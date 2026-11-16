import { isTextAnimator, type Project, type SceneObject, type TextAnimator } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Per-character text animation (spec 2026-11-16-text-animator): load-time check. A malformed
// animator is dropped (the text then draws as one run); a valid one is copied field by field so
// unknown keys don't ride along.
function clean(a: TextAnimator): TextAnimator {
  const from: TextAnimator['from'] = {};
  for (const k of ['opacity', 'dx', 'dy', 'rotation'] as const) if (a.from[k] !== undefined) from[k] = a.from[k];
  return {
    by: a.by, start: a.start, stagger: a.stagger, duration: a.duration,
    ...(a.easing ? { easing: a.easing } : {}),
    ...(a.order ? { order: a.order } : {}),
    ...(a.seed !== undefined ? { seed: a.seed } : {}),
    ...(a.direction ? { direction: a.direction } : {}),
    from,
  };
}

function sanitizeObject(o: SceneObject): SceneObject {
  if (!('textAnimator' in o)) return o;
  const out = { ...o };
  if (isTextAnimator(o.textAnimator)) out.textAnimator = clean(o.textAnimator);
  else delete out.textAnimator;
  return out;
}

export function sanitizeTextAnimators(project: Project): Project {
  return sanitizeAllObjects(project, sanitizeObject);
}
