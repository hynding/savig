# Savig SDD Artifacts — Index

Spec-driven-development trail for Savig. Each feature flows
**brainstorm → design spec (`specs/`) → implementation plan(s) (`plans/`) → execute & merge**.
Plans are split into **engine** (pure/pipeline) and **ui** (React/store/Stage) and use
`- [ ]` checkboxes for task tracking — boxes are intentionally left unchecked in-file;
live completion was tracked in `.superpowers/sdd/progress.md`.

Files are dated `YYYY-MM-DD` by authoring date. All work below is **merged to `main`**.
This index is a navigation aid — open the individual file for full detail; don't
consolidate these into one document (it would destroy the dated provenance).

## Milestone 1 — Core editor (COMPLETE)

| Area | Spec | Plan(s) | Merge |
|------|------|---------|-------|
| Master design | `specs/2026-06-19-savig-animated-svg-editor-design.md` | — | — |
| Animation engine | ↑ | `plans/2026-06-19-savig-engine-core.md` | `86a9974` |
| Services layer | ↑ | `plans/2026-06-19-savig-services.md` | `04c6271` |
| UI layer | ↑ | `plans/2026-06-19-savig-ui.md` | `2e7d2fc` (completes M1) |
| Audio master clock | ↑ (§4) | — | `c0cd9f0` |

## Milestone 2 — Vector drawing tools (Slices 1–8 COMPLETE)

| Slice / feature | Spec | Plan(s) | Merge |
|-----------------|------|---------|-------|
| 1 — Vector foundation | `specs/2026-06-20-savig-m2-vector-foundation-design.md` | `plans/…vector-foundation-engine.md`, `plans/…vector-foundation-ui.md` | `56cbc22`, `63baf40` |
| 2 — Pen / bezier paths | `specs/2026-06-20-savig-m2-slice2-pen-paths-design.md` | `plans/…slice2-pen-paths-engine.md`, `plans/…slice2-pen-paths-ui.md` | `b2ab484` |
| 3 — Path morphing | `specs/2026-06-20-savig-m2-slice3-path-morphing-design.md` | `plans/…slice3-path-morphing-engine.md`, `plans/…slice3-path-morphing-ui.md` | `5a3cff9` (+ review fixes `2a2d32d`) |
| Morph/easing roadmap | `specs/2026-06-20-savig-m2-morph-easing-roadmap-design.md` | — | `dd2d3e3` |
| F1 — Keyframe easing UI | `specs/2026-06-20-savig-m2-keyframe-easing-ui-design.md` | `plans/2026-06-20-savig-keyframe-easing-ui.md` | `dd2d3e3` |
| F2 — Arc-length morph | `specs/2026-06-20-savig-m2-arc-length-morph-design.md` | `plans/…arc-length-morph-engine.md`, `plans/…arc-length-morph-ui.md` | `c368e0b`, `f408905` |
| F3 — Node correspondence | `specs/2026-06-20-savig-m2-node-correspondence-design.md` | `plans/…node-correspondence-engine.md`, `plans/…node-correspondence-ui-nudge.md`, `plans/…node-correspondence-ui-overlay.md` | `97e50f7`, `72c0f07`, `5e17f56` (+ polish `a6de8b9`) |
| F4 — Per-node easing | `specs/2026-06-20-savig-m2-per-node-easing-design.md` | `plans/…per-node-easing-engine.md`, `plans/…per-node-easing-ui.md` | `4ea43a4`, `07decad` |
| 4 — Color animation | `specs/2026-06-21-savig-m2-slice4-color-animation-design.md` | `plans/…slice4-color-animation-engine.md`, `plans/…slice4-color-animation-ui.md` | `6e1084a`, `23df609` |
| 5 — Motion paths | `specs/2026-06-21-savig-m2-slice5-motion-paths-design.md` | `plans/…slice5-motion-paths-engine.md`, `plans/…slice5-motion-paths-ui.md` | `514661d` |
| 6 — Primitives (polygon/star/line) | `specs/2026-06-21-savig-m2-slice6-primitives-design.md` | `plans/…slice6-primitives-engine.md`, `plans/…slice6-primitives-ui.md` | `186ea2f` |
| 7 — Freehand brush | `specs/2026-06-21-savig-m2-slice7-freehand-brush-design.md` | `plans/…slice7-freehand-brush-engine.md`, `plans/…slice7-freehand-brush-ui.md` | `dc7d920` |
| 8 — Gradients (linear/radial) | `specs/2026-06-21-savig-m2-slice8-gradients-design.md` | `plans/…slice8-gradients-engine.md`, `plans/…slice8-gradients-ui.md` | `9232596` |

> Plan paths are abbreviated with `…` = `2026-06-20-savig-m2-` or `2026-06-21-savig-m2-`
> (matching the slice's date); the engine/ui suffix disambiguates. Run `ls plans/` for exact names.

## What's next / deferred (backlog)

This is a **curated digest with pointers** — not a copy. The authoritative lists
live in each spec's own *Deferred / Non-goals / Open questions* section and in the
master spec. Keep it that way: when a slice ships, move its line up into the
completed table and prune it here.

- **Big-picture roadmap (M1–M11)** + the deferred-polish "C-list" (snapping/alignment
  guides · bundled starter project · single-file vs folder export · license choice):
  `specs/2026-06-19-savig-animated-svg-editor-design.md` §10.
- **M2 morph/easing feature sequencing:** `specs/2026-06-20-savig-m2-morph-easing-roadmap-design.md`.

**Near-term M2 candidates** (pulled from the most recent slice specs; Slice 5 motion
paths declared no formal deferrals):

| Candidate | Source spec (§) |
|-----------|-----------------|
| Animated gradient stops (color/offset/opacity keyframing) — reuses the Slice-4 color seam; flagged as the natural *next* slice | slice8-gradients §2, §13 |
| Animated gradient geometry (endpoints/focal move over time) | slice8-gradients §2 |
| On-canvas gradient handles (drag endpoints/focal on the Stage) | slice8-gradients §2 |
| Per-stop opacity Inspector control (data model + emitter already support it; UI only) | slice8-gradients §2 |
| `gradientUnits: userSpaceOnUse`, `spreadMethod`, `gradientTransform`; gradients on imported SVG; HSL/OKLCH & `currentColor` stops | slice8-gradients §2 |
| `fill: string \| Gradient` paint-union refactor (rejected for Slice 8, tracked) | slice8-gradients §3, §13 |
| Pressure/velocity-variable stroke width + ribbon-outline brushes | slice7-freehand-brush §13 |
| Input stabilizer / lazy-brush; auto-close near-coincident endpoints; Schneider least-squares bezier fit; textured/patterned brushes | slice7-freehand-brush §13 |
| Parametric re-editing of primitives (change sides/points/inner-ratio post-creation); rounded-corner & tip-sharpness controls | slice6-primitives §12 |
| **Boolean path ops** (union/intersect/subtract; needs robust polygon clipping) — recurs in slices 6 & 7 | slice6 §12, slice7 §13 |
| **Multi-select / grouping** — explicitly **M4** | slice6 §12, slice7 §13, master §10 |
