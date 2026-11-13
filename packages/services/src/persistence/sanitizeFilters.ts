import { FILTER_PARAMS, isFilterKind } from '@savig/engine';
import type { Keyframe, ObjectFilter, Project, SceneObject } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Filters (spec 2026-11-13-filters §Persistence): load-time shape check for SceneObject.filters /
// filterTracks. Malformed entries are dropped — unknown kind, missing/duplicate id, non-finite or
// unknown params, non-string color, non-boolean enabled — and tracks whose key doesn't name a
// surviving filter's known param, or whose keyframes aren't finite. Clamping is the sampler's job.
// Returns the same object when nothing changes, so clean files stay reference-equal.

function cleanFilter(f: unknown): ObjectFilter | null {
  if (!f || typeof f !== 'object') return null;
  const r = f as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || !isFilterKind(r.kind)) return null;
  const allowed = FILTER_PARAMS[r.kind];
  const params: Record<string, number> = {};
  if (r.params && typeof r.params === 'object') {
    for (const [k, v] of Object.entries(r.params as Record<string, unknown>)) {
      if (k in allowed && typeof v === 'number' && Number.isFinite(v)) params[k] = v;
    }
  }
  return {
    id: r.id,
    kind: r.kind,
    params,
    ...(typeof r.color === 'string' ? { color: r.color } : {}),
    ...(r.enabled === false ? { enabled: false } : {}),
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function validTrack(t: unknown): t is Keyframe[] {
  return Array.isArray(t) && t.every((k) => k && typeof k === 'object' && Number.isFinite((k as Keyframe).time) && Number.isFinite((k as Keyframe).value));
}

function sanitizeObject(o: SceneObject): SceneObject {
  if (!('filters' in o) && !('filterTracks' in o)) return o;
  const out = { ...o };
  const seen = new Set<string>();
  const filters: ObjectFilter[] = [];
  for (const f of Array.isArray(o.filters) ? o.filters : []) {
    const c = cleanFilter(f);
    if (c && !seen.has(c.id)) {
      seen.add(c.id);
      filters.push(c);
    }
  }
  if (filters.length > 0) out.filters = filters;
  else delete out.filters;
  const tracks: Record<string, Keyframe[]> = {};
  if (o.filterTracks && typeof o.filterTracks === 'object') {
    for (const [key, t] of Object.entries(o.filterTracks)) {
      const dot = key.lastIndexOf('.');
      const f = filters.find((x) => x.id === key.slice(0, dot));
      if (dot > 0 && f && key.slice(dot + 1) in FILTER_PARAMS[f.kind] && validTrack(t) && t.length > 0) tracks[key] = t;
    }
  }
  if (Object.keys(tracks).length > 0) out.filterTracks = tracks;
  else delete out.filterTracks;
  return sameJson(out.filters, o.filters) && sameJson(out.filterTracks, o.filterTracks) ? o : out;
}

export function sanitizeFilters(project: Project): Project {
  return sanitizeAllObjects(project, sanitizeObject);
}
