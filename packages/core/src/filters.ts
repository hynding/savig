/** Headless filter builders (spec 2026-11-13-filters §DSL / MCP, slice 3) — the agent path to
 *  Flash-style filters. Same contract as build.ts: pure, id-addressed, root-scene only (MCP wraps
 *  them in `withScene`), fail loud on bad references, kinds or params. */
import { createFilter, createKeyframe, FILTER_DEFAULT_COLOR, FILTER_KINDS, FILTER_PARAMS, filterTrackKey, isFilterKind, newId, upsertKeyframe } from '@savig/engine';
import type { Easing, FilterKind, ObjectFilter, Project, SceneObject } from '@savig/engine';

export interface FilterSpec {
  kind: FilterKind;
  /** Stable id (default: generated). Unique within the object. */
  id?: string;
  /** Param overrides; the rest take the kind's defaults. */
  params?: Record<string, number>;
  /** dropShadow / glow only. */
  color?: string;
  /** false = skipped when rendering (default on). */
  enabled?: boolean;
}

function requireObject(project: Project, id: string): SceneObject {
  const o = project.objects.find((x) => x.id === id);
  if (!o) throw new Error(`savig/core: no object with id "${id}"`);
  return o;
}

function requireFilter(o: SceneObject, filterId: string): ObjectFilter {
  const f = o.filters?.find((x) => x.id === filterId);
  if (!f) throw new Error(`savig/core: object "${o.id}" has no filter "${filterId}"`);
  return f;
}

function checkParams(kind: FilterKind, params: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (!(k in FILTER_PARAMS[kind])) {
      throw new Error(`savig/core: ${kind} has no param "${k}" (params: ${Object.keys(FILTER_PARAMS[kind]).join(', ')})`);
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`savig/core: ${kind}.${k} must be a finite number`);
    out[k] = v;
  }
  return out;
}

function checkColor(kind: FilterKind, color: unknown): void {
  if (color === undefined) return;
  if (FILTER_DEFAULT_COLOR[kind] === undefined) throw new Error(`savig/core: ${kind} has no color`);
  if (typeof color !== 'string') throw new Error('savig/core: filter color must be a string');
}

function replace(project: Project, next: SceneObject): Project {
  return { ...project, objects: project.objects.map((o) => (o.id === next.id ? next : o)) };
}

/** Append a filter to `objectId`'s stack (filters apply in order, each feeding the next). */
export function addFilter(project: Project, objectId: string, spec: FilterSpec): { project: Project; filterId: string } {
  const o = requireObject(project, objectId);
  if (!isFilterKind(spec.kind)) throw new Error(`savig/core: unknown filter kind "${String(spec.kind)}" (kinds: ${FILTER_KINDS.join(', ')})`);
  const params = checkParams(spec.kind, spec.params);
  checkColor(spec.kind, spec.color);
  const filterId = spec.id ?? newId();
  if (o.filters?.some((f) => f.id === filterId)) throw new Error(`savig/core: object "${objectId}" already has a filter "${filterId}"`);
  const f = createFilter(spec.kind, filterId, { params, ...(spec.color !== undefined ? { color: spec.color } : {}), ...(spec.enabled === false ? { enabled: false } : {}) });
  return { project: replace(project, { ...o, filters: [...(o.filters ?? []), f] }), filterId };
}

/** Patch a filter's static params / color / enabled flag. */
export function setFilter(
  project: Project,
  objectId: string,
  filterId: string,
  patch: { params?: Record<string, number>; color?: string; enabled?: boolean },
): Project {
  const o = requireObject(project, objectId);
  const f = requireFilter(o, filterId);
  const params = checkParams(f.kind, patch.params);
  checkColor(f.kind, patch.color);
  const next: ObjectFilter = { ...f, params: { ...f.params, ...params }, ...(patch.color !== undefined ? { color: patch.color } : {}) };
  if (patch.enabled === false) next.enabled = false;
  else if (patch.enabled === true) delete next.enabled;
  return replace(project, { ...o, filters: o.filters!.map((x) => (x.id === filterId ? next : x)) });
}

/** Remove a filter and its param tracks. */
export function removeFilter(project: Project, objectId: string, filterId: string): Project {
  const o = requireObject(project, objectId);
  requireFilter(o, filterId);
  const out: SceneObject = { ...o };
  const filters = o.filters!.filter((f) => f.id !== filterId);
  if (filters.length) out.filters = filters;
  else delete out.filters;
  const tracks = Object.fromEntries(Object.entries(o.filterTracks ?? {}).filter(([k]) => !k.startsWith(`${filterId}.`)));
  if (Object.keys(tracks).length) out.filterTracks = tracks;
  else delete out.filterTracks;
  return replace(project, out);
}

/** Upsert one keyframe on a filter param's track (the track overrides the static param). */
export function setFilterKeyframe(
  project: Project,
  opts: { objectId: string; filterId: string; param: string; time: number; value: number; easing?: Easing },
): Project {
  const o = requireObject(project, opts.objectId);
  const f = requireFilter(o, opts.filterId);
  checkParams(f.kind, { [opts.param]: opts.value });
  if (!Number.isFinite(opts.time) || opts.time < 0) throw new Error('savig/core: keyframe time must be a finite number >= 0');
  const key = filterTrackKey(opts.filterId, opts.param);
  const track = upsertKeyframe(o.filterTracks?.[key] ?? [], createKeyframe(opts.time, opts.value, { easing: opts.easing ?? 'linear' }));
  return replace(project, { ...o, filterTracks: { ...o.filterTracks, [key]: track } });
}

/** Set a whole param track in one call (keyframes in any order; replaces an existing track). */
export function animateFilter(
  project: Project,
  objectId: string,
  filterId: string,
  param: string,
  keyframes: Array<{ t: number; value: number; easing?: Easing }>,
): Project {
  const o = requireObject(project, objectId);
  requireFilter(o, filterId);
  if (!Array.isArray(keyframes) || keyframes.length === 0) throw new Error('savig/core: animateFilter needs at least one keyframe');
  let p = replace(project, { ...o, filterTracks: Object.fromEntries(Object.entries(o.filterTracks ?? {}).filter(([k]) => k !== filterTrackKey(filterId, param))) });
  for (const k of keyframes) p = setFilterKeyframe(p, { objectId, filterId, param, time: k.t, value: k.value, easing: k.easing });
  return p;
}
