# Shape hints — design

Status: approved direction (Steve, 2026-11-14: "work on each in order"). Follows the shape tween
(`2026-11-13-shape-tween-design.md`), whose Deferred list named shape hints.

## Goal

Flash's *shape hints*: when a shape tween twists, slides, or folds through itself, the author pins
matching points on the start and end drawings ("this corner becomes that corner"). Hints are
lettered a–z, at most 26 per tween.

## Model

```ts
interface ShapeTween { kind: 'shape'; easing?; created?; hints?: ShapeHint[] }
interface ShapeHint { a: PathPoint; b: PathPoint } // layer-local: a on the start key, b on the end key
```

- Stored on the tween marker (`FrameKey.tween.hints`), next to `easing`. The morph itself stays
  ordinary baked `shapeTrack` data (the shape tween's bake approach), so renderers, exporters and
  the runtime need no change and the format version does not bump (an older build drops unknown
  marker fields and keeps the baked morph).
- Points are in the frame layer's coordinates. Each hint belongs to the drawing pair (start, end)
  whose start outline lies nearest `a`; `a` and `b` snap to the nearest point on their outlines.

## Correspondence (engine `morph/hints.ts`)

1. Flatten both outlines; find each hint's arc length on A (`sa`) and B (`sb`).
2. Keep the largest set of hints whose order agrees on both outlines (longest increasing
   subsequence; on a closed outline measured cyclically from each hint in turn). A hint that would
   make the morph cross itself is dropped, never an error.
3. Cut both outlines at the kept hints. Each matching pair of stretches is resampled with the same
   number of points (96 in total, split by the longer relative stretch length, at least 1 each).
   Open outlines add implicit cuts at both ends (ends stay ends).
4. The resampled pair (equal node counts, straight segments) replaces the default node matching for
   that pair. No hints, an open/closed mismatch, or an empty outline → the default matching.

## Surfaces

- Re-bakes (key timing edits, retiming, re-tween with a new easing) keep the hints.
- core `shapeTween(project, layer, key, { easing?, hints? })`: validated (finite points, ≤ 26);
  omitted keeps prior hints, `[]` clears.
- DSL: `tween: { easing?, hints? }`. describe: ` hints×N` on the key line.
- MCP `shape_tween` takes `hints`.
- Sanitizer keeps well-formed pairs (≤ 26) and drops the rest.
- Editor (slice 2): lettered hint markers on the stage, shown at the start key (a) and the end
  key (b), draggable (each drop re-bakes), with Add shape hint and Remove all hints.

## Slices

1. Engine correspondence + bake wiring + agent surfaces + sanitizer
   (`plans/2026-11-14-shape-hints-slice1.md`).
2. Editor hint markers, commands, Inspector row, e2e.

## Deferred

- Hints between drawings with different hole counts / compound paths (each subpath pairing).
- Per-hint enable/disable and Flash's green/yellow/red validity colours (slice 2 may show dropped
  hints greyed).
