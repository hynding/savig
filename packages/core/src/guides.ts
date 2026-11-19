/** Headless ruler-guide verbs (spec 2026-11-19-rulers-guides, slice 2). Guides are editor chrome:
 *  lines on the root Stage that objects snap to while dragging in the editor; no export draws them.
 *  Pure; fail loud on bad input. */
import { guidePos, isRulerGuide } from '@savig/engine';
import type { Project, RulerGuide } from '@savig/engine';

function withGuides(project: Project, guides: RulerGuide[]): Project {
  const out: Project = { ...project, guides };
  if (guides.length === 0) delete out.guides;
  return out;
}

function checked(g: unknown): RulerGuide {
  if (!isRulerGuide(g)) throw new Error(`savig/core: a guide needs axis "x" or "y" and a finite pos (got ${JSON.stringify(g)})`);
  return { axis: g.axis, pos: guidePos(g.pos) };
}

/** Add a guide: axis 'x' is a vertical line at x = pos, 'y' a horizontal line at y = pos. */
export function addGuide(project: Project, axis: 'x' | 'y', pos: number): Project {
  return withGuides(project, [...(project.guides ?? []), checked({ axis, pos })]);
}

/** Replace every guide (an empty list removes them all). */
export function setGuides(project: Project, guides: readonly { axis: 'x' | 'y'; pos: number }[]): Project {
  return withGuides(project, guides.map(checked));
}

/** Remove every guide. */
export function clearGuides(project: Project): Project {
  return withGuides(project, []);
}
