import { guidePos, isRulerGuide, type Project } from '@savig/engine';

// Ruler guides (spec 2026-11-19-rulers-guides): load-time check. Malformed entries are dropped and
// positions rounded to whole pixels; an empty list removes the field.
export function sanitizeGuides(project: Project): Project {
  if (!('guides' in project)) return project;
  const raw: unknown = project.guides;
  const kept = (Array.isArray(raw) ? raw : []).filter(isRulerGuide).map((g) => ({ axis: g.axis, pos: guidePos(g.pos) }));
  const out = { ...project };
  if (kept.length) out.guides = kept;
  else delete out.guides;
  return out;
}
