import { normalizeWidthProfile } from '@savig/engine';
import type { Project, VectorStyle } from '@savig/engine';

// Variable-width strokes (spec 2026-11-18-variable-width): load-time check. A vector asset's
// `style.widthProfile` is normalized (finite stations, t and w clamped, sorted, thinned). It is
// dropped when nothing usable is left, when every station is 1 (a uniform stroke), or when the
// asset is not a path (only paths draw a profile), so the document reads as if it never had one.
// Destructured on a parameter so the omitted name satisfies eslint's argsIgnorePattern.
function withoutProfile({ widthProfile: _widthProfile, ...rest }: VectorStyle): VectorStyle {
  return rest;
}

export function sanitizeWidthProfile(project: Project): Project {
  if (!Array.isArray(project.assets)) return project; // malformed shapes are another sanitizer's job
  let changed = false;
  const assets = project.assets.map((a) => {
    if (a.kind !== 'vector' || !a.style || !('widthProfile' in a.style)) return a;
    const profile = a.shapeType === 'path' ? normalizeWidthProfile(a.style.widthProfile) : undefined;
    const style: VectorStyle = profile ? { ...withoutProfile(a.style), widthProfile: profile } : withoutProfile(a.style);
    if (JSON.stringify(style) === JSON.stringify(a.style)) return a;
    changed = true;
    return { ...a, style };
  });
  return changed ? { ...project, assets } : project;
}
