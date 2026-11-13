# Filters & Color Effects — Design

**Date:** 2026-11-13
**Status:** approved for slicing (next studio feature after mask layers; Steve: "continue on all in order")

## Goal

Flash/Animate's **Filters** panel: stackable, animatable visual effects on any object — shapes,
text, groups and symbol instances. v1 ships the four that cover nearly every real use:

| Filter | Params (all animatable unless noted) | SVG |
|---|---|---|
| `blur` | `blur` (px) | `feGaussianBlur` |
| `dropShadow` | `dx`, `dy`, `blur`, `opacity`, `color` (static) | `feDropShadow` |
| `glow` | `blur`, `strength` (0..10), `opacity`, `color` (static) | blur SourceAlpha → flood → composite → merge under the graphic |
| `adjustColor` | `brightness` (-1..1), `contrast` (-1..1), `saturation` (-1..1), `hue` (deg) | `feColorMatrix` (hueRotate, saturate) + `feComponentTransfer` (linear) |

`adjustColor` is the "color effects" half (Flash's Brightness / Advanced color). Tint on instances
already exists (slice 47f) and alpha is `opacity`.

## Model (engine `types.ts`)

```ts
type FilterKind = 'blur' | 'dropShadow' | 'glow' | 'adjustColor';
interface ObjectFilter {
  id: string;            // stable, for tracks and UI
  kind: FilterKind;
  params: Record<string, number>;  // static values; defaults per kind (FILTER_DEFAULTS)
  color?: string;        // dropShadow / glow
  enabled?: boolean;     // false = skipped (Flash's per-filter toggle); absent = on
}
interface SceneObject {
  filters?: ObjectFilter[];                 // applied in order, each feeding the next
  filterTracks?: Record<string, Keyframe[]>; // key `${filterId}.${param}`; track wins over params
}
```

Absent/empty `filters` ⇒ byte-identical output (parity).

## Engine

- `filters.ts`: `FILTER_DEFAULTS`, `FILTER_PARAMS` (allowed params per kind + clamps),
  `sampleFilters(obj, time) → ResolvedFilter[]` (enabled filters, params resolved from tracks,
  clamped), `filterPrimitives(resolved) → { tag, attrs }[]` (one shared SVG builder used by the
  export string, the Stage JSX and the runtime DOM update, so they cannot drift), `filterDefId`.
- `flattenInstances` gains `InstanceLeaf.wrapChain?: WrapRef[]` — the full ordered list of
  wrappers around a drawn leaf, outermost first: walking from the outermost ancestor to the leaf,
  each node contributes its honoured **mask** and then its **filter** (Flash: a masked, filtered
  clip is filtered first, then masked). `WrapRef = { kind: 'mask', id } | { kind: 'filter', id,
  owner: SceneObject, time: number }` — the filter's owner and its local sample time travel with
  the ref so any renderer can build the def. `maskChain` stays (mask ids only) for compatibility.
- Mask content ignores filters (v1).
- `objectsMaxKeyframeTime` folds `filterTracks`.

## Render & export

- One `<filter id="savig-filter-<renderPrefix><objId>" data-savig-object="<same>" x="-50%"
  y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">` per filtered object per
  instance path, built from `filterPrimitives` at t=0.
- Wrappers: the mask wrapper stack generalises to a **wrap stack** over `wrapChain`; a filter ref
  opens `<g filter="url(#id)">`. Wrappers have no transform, so filters work in stage space
  (a rotated object's shadow still falls down-right, as in Flash).
- `computeFrame` appends one `FrameItem` per unique filter def (`kind: 'filter'`, `filterPrims`
  = the primitives' attrs at this frame). `applyFrameToNodes` rebuilds that filter's children via
  `createElementNS` (gradient precedent). The SMIL exporter animates each primitive attribute whose
  value changes over time with an `<animate>` on the primitive (sampled per frame, like opacity).
- The static-symbol `<use>` optimization skips instances with filters and symbols containing them.
- resvg supports all four primitives, so raster/GIF/video match.

## Editor (slice 2)

- Store: `addFilter(kind)`, `removeFilter(id)`, `moveFilter(id, dir)`, `toggleFilter(id)`,
  `setFilterParam(id, param, value)` (keyframes at the playhead when auto-key is on and the param
  has a track or auto-key creates one; else writes the static param), `setFilterColor(id, color)`.
  Active-scene aware, undoable, selected object (single).
- Inspector "Filters" section: add menu, one card per filter (enable checkbox, params as number
  fields with keyframe diamonds' usual behaviour, color input, up/down, remove).
- Timeline: filter tracks appear as rows like other property tracks (read-only label
  `<kind> <param>`), keyframes draggable/deletable via the existing generic track handling where
  feasible; otherwise listed in the object's track summary.
- Commands: `filter.add.<kind>` palette entries.

## DSL / MCP (slice 3)

- DSL: `filters: [{ kind, id?, color?, enabled?, blur?, dx?, … , animate?: { param: [{t, value}] } }]`
  on any shape/frames layer; round-trips.
- MCP: `add_filter { objectId, kind, params, color }`, `set_filter { objectId, filterId, params,
  color, enabled }`, `remove_filter`, `animate_filter { objectId, filterId, param, keyframes }`;
  describe lists filters.
- Template: "Glowing title" (text + animated glow + drop shadow).

## Persistence

Format **v10** (stamp-only migration). Sanitizer drops malformed filter entries (unknown kind,
non-finite params, non-string color, bad track keys).

## Testing

Engine (sampling, clamps, defaults, wrapChain ordering with masks/groups/instances, parity),
render (defs, wrappers, ordering, multi-scene, escaping, static `<use>` bypass), runtime (filter
children rebuilt per frame), SMIL (animate on primitives), raster (blur spreads pixels; shadow
offset; brightness), Stage parity, store/VM/e2e in slice 2, DSL/MCP in slice 3.

## Slices

1. Model + engine + render seam + Stage preview + persistence v10.
2. Editor: store verbs, Inspector panel, timeline rows, commands, e2e.
3. Agent parity: DSL, MCP, describe, template, INDEX.

## Deferred

Bevel, gradient glow, inner glow/shadow, knockout, per-filter quality; animating colors; filters on
mask content; filter presets library.
