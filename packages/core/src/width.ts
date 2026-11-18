// Variable-width strokes (spec 2026-11-18-variable-width, slice 2), agent surface. Fail loud.
import { WIDTH_PRESETS, applyWidthProfile } from '@savig/engine';
import type { Project, WidthPreset, WidthStop } from '@savig/engine';

const REFUSALS: Record<string, string> = {
  'not-a-drawing': 'is not a shape or path',
  locked: 'is locked',
  'live-boolean': 'is a live boolean result',
  'no-stroke': 'has no stroke (give it one first)',
  'animated-shape': 'has an animated size',
};

/** Make drawing `id`'s stroke swell and taper along its length: `profile` is either a preset name
 *  or stations `{ t, w }` (t = 0..1 along the path, w = multiple of strokeWidth, 0..20); null,
 *  [] or 'uniform' clears it. A rect or ellipse becomes a path first. `time` picks the frame a
 *  converted rect/ellipse outline is taken from (default 0). */
export function setWidthProfile(project: Project, id: string, profile: WidthPreset | WidthStop[] | null, opts: { time?: number } = {}): Project {
  let stops: WidthStop[] | null;
  if (typeof profile === 'string') {
    if (!(profile in WIDTH_PRESETS)) throw new Error(`savig/core: unknown width preset "${profile}" (${Object.keys(WIDTH_PRESETS).join(', ')})`);
    stops = WIDTH_PRESETS[profile].map((s) => ({ ...s }));
  } else if (profile === null) {
    stops = null;
  } else {
    if (!Array.isArray(profile) || profile.some((s) => !s || !Number.isFinite(s.t) || !Number.isFinite(s.w))) {
      throw new Error('savig/core: a width profile is a list of { t, w } with finite numbers');
    }
    stops = profile;
  }
  if (!project.objects.some((o) => o.id === id)) throw new Error(`savig/core: no object "${id}"`);
  const r = applyWidthProfile(project.objects, project.assets, id, stops, opts.time ?? 0);
  if ('refused' in r) throw new Error(`savig/core: "${id}" ${REFUSALS[r.refused]}`);
  return { ...project, objects: r.objects, assets: r.assets };
}
