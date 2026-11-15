import { isMotionPreset, type Project } from '@savig/engine';

// Motion presets (spec 2026-11-15-motion-presets): load-time check. Malformed entries are dropped
// (and duplicate ids after the first), so the Presets panel only ever sees well-formed data.
export function sanitizeMotionPresets(project: Project): Project {
  if (!('motionPresets' in project)) return project;
  const raw: unknown = project.motionPresets;
  const seen = new Set<string>();
  const kept = (Array.isArray(raw) ? raw : []).filter((p) => {
    if (!isMotionPreset(p) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  const out = { ...project };
  if (kept.length) out.motionPresets = kept;
  else delete out.motionPresets;
  return out;
}
