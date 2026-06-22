# Savig SDD Artifacts — Index

Spec-driven-development trail for Savig. Each feature flows
**brainstorm → design spec (`specs/`) → implementation plan(s) (`plans/`) → execute & merge**.
Plans use `- [ ]` checkboxes for task tracking — boxes are intentionally left unchecked
in-file. Every cycle runs a `feature-dev:code-reviewer` pass (often a review LOOP until no
Critical/Important remain) before a `--no-ff` merge to `main`.

Files are dated `YYYY-MM-DD` by authoring date. **All work below is merged to `main`.**
This index is a navigation aid — open the individual file for full detail; don't
consolidate these into one document (it would destroy the dated provenance). Run
`ls specs/` / `ls plans/` for exact filenames; paths below are abbreviated with `…`.

## Status at a glance (2026-06-22)

| Milestone | Scope | Status |
|-----------|-------|--------|
| **M1** | Core editor (engine, services, UI, audio clock) | ✅ COMPLETE |
| **M2** | Vector drawing tools (pen/shapes/brush) + a large polish program | ✅ COMPLETE (slices 1–35) |
| **M3** | Path morphing & advanced tweens | ✅ COMPLETE — every feature was pulled forward into M2 |
| **M4** | Grouping, layers & nested symbols/clips | 🚧 IN PROGRESS — selection toolkit done: layers/lock/visibility/reorder + **multi-select (36)**, **multi-move (37)**, **marquee (38)**, **copy/paste (39)** |
| M5–M11 | CSS export · multitrack audio · scenes · video/GIF · scripting · cloud · collab | ⬜ Not started (master spec §10) |

> **M3 note:** M3's deliverables (interpolate path `d` between keyframes; motion paths;
> custom-bezier easing UI) all shipped during M2 — path morphing (slice 3), the
> arc-length / node-correspondence / per-node-easing morph roadmap (F1–F4), motion paths
> (slice 5). There is no separate M3 work to do.

## Milestone 1 — Core editor (COMPLETE)

| Area | Spec | Plan(s) | Merge |
|------|------|---------|-------|
| Master design | `specs/2026-06-19-savig-animated-svg-editor-design.md` | — | — |
| Animation engine | ↑ | `plans/2026-06-19-savig-engine-core.md` | `86a9974` |
| Services layer | ↑ | `plans/2026-06-19-savig-services.md` | `04c6271` |
| UI layer | ↑ | `plans/2026-06-19-savig-ui.md` | `2e7d2fc` (completes M1) |
| Audio master clock | ↑ (§4) | — | `c0cd9f0` |

## Milestone 2 — Vector drawing tools (COMPLETE, slices 1–35)

Core authoring (1–8), the morph/easing roadmap (F1–F4), then a long sequence of
feature + polish slices. `…` = `YYYY-MM-DD-savig-m2-` matching the slice's date.

| Slice / feature | Spec | Merge |
|-----------------|------|-------|
| 1 — Vector foundation | `specs/…vector-foundation-design.md` | `56cbc22`, `63baf40` |
| 2 — Pen / bezier paths + node editing | `specs/…slice2-pen-paths-design.md` | `b2ab484` |
| 3 — Path morphing | `specs/…slice3-path-morphing-design.md` | `5a3cff9` |
| Morph/easing roadmap | `specs/…morph-easing-roadmap-design.md` | `dd2d3e3` |
| F1 — Keyframe easing UI (custom bezier) | `specs/…keyframe-easing-ui-design.md` | `dd2d3e3` |
| F2 — Arc-length / cross-shape morph | `specs/…arc-length-morph-design.md` | `c368e0b`, `f408905` |
| F3 — Node correspondence editor | `specs/…node-correspondence-design.md` | `97e50f7`, `72c0f07`, `5e17f56` (+ `a6de8b9`) |
| F4 — Per-node easing | `specs/…per-node-easing-design.md` | `4ea43a4`, `07decad` |
| 4 — Color animation (fill/stroke) | `specs/…slice4-color-animation-design.md` | `6e1084a`, `23df609` |
| 5 — Motion paths | `specs/…slice5-motion-paths-design.md` | `514661d` |
| 6 — Primitives (polygon/star/line) | `specs/…slice6-primitives-design.md` | `186ea2f` |
| 7 — Freehand brush | `specs/…slice7-freehand-brush-design.md` | `dc7d920` |
| 8 — Gradients (linear/radial, static) | `specs/…slice8-gradients-design.md` | `9232596` |
| 9 — Animated gradients | `specs/…slice9-animated-gradients-design.md` | `3c8f9df` |
| 10 — Stroke dash & self-drawing | `specs/…slice10-stroke-dash-design.md` | `8dbd0af` |
| 11 — On-canvas gradient handles | `specs/…slice11-gradient-handles-design.md` | `091c419` |
| 12 — SVG rotate handle | `specs/…slice12-rotation-handle-design.md` | (see spec) |
| 13 — Onion skinning | `specs/…slice13-onion-skinning-design.md` | (see spec) |
| 14 — Duplicate object | `specs/…slice14-duplicate-object-design.md` | (see spec) |
| 15 — Delete object | `specs/…slice15-delete-object-design.md` | (see spec) |
| 16 — Reorder objects | `specs/…slice16-reorder-objects-design.md` | (see spec) |
| 17 — Layers panel | `specs/…slice17-layers-panel-design.md` | (see spec) |
| 18 — Rename object | `specs/…slice18-rename-object-design.md` | (see spec) |
| 19 — Object lock | `specs/…slice19-object-lock-design.md` | (see spec) |
| 20 — Layers drag-reorder | `specs/…slice20-layers-drag-reorder-design.md` | (see spec) |
| 21 — Object clipboard (copy/cut/paste) | `specs/…slice21-clipboard-design.md` | (see spec) |
| 22 — SVG rotate handle (cont.) | `specs/…slice22-svg-rotate-handle-design.md` | (see spec) |
| 23 — Scale handles | `specs/…slice23-scale-handles-design.md` | (see spec) |
| 24 — Copy/paste keyframes | `specs/…slice24-copy-paste-keyframes-design.md` | (see spec) |
| 25 — Drag-to-retime keyframes | `specs/…slice25-drag-keyframe-retime-design.md` | `98797b0` |
| 26 — Edge scale handles | `specs/…slice26-edge-scale-handles-design.md` | `833ed64` |
| 27 — Lock-aware timeline | `specs/…slice27-lock-aware-timeline-design.md` | (see spec) |
| 28 — Uniform (shift) scale/resize | `specs/…slice28-uniform-scale-resize-design.md` | `d17c4a0` |
| 29 — Cut keyframe | `specs/…slice29-cut-keyframe-design.md` | `1c7cde5` |
| 30 — Alt scale/resize from centre | `specs/…slice30-scale-from-center-design.md` | `26f0d94` |
| **True-M2-polish program (31–35):** | | |
| 31 — Curve-tight `pathBounds` | `specs/…slice31-curve-tight-bounds-design.md` | `17d6073` |
| 32 — Rounded polygon/star corners | `specs/…slice32-rounded-primitive-corners-design.md` | `295c979` |
| 33 — Stage snapping / alignment guides | `specs/…slice33-snapping-guides-design.md` | `b0985a6` |
| 34 — Gradient stop-count morphing | `specs/…slice34-gradient-stop-morph-design.md` | `2df60b4` |
| 35 — Parametric primitive re-editing | `specs/…slice35-parametric-primitives-design.md` | `7817bc2` |

## Milestone 4 — Grouping, layers & nested symbols (IN PROGRESS)

Layers panel, object lock, **visibility** (eye toggle), and drag-reorder shipped during M2
(slices 17/19/20). Remaining M4 work is multi-object selection/transform, grouping, boolean
ops, and nested symbols.

| Slice / feature | Spec | Merge |
|-----------------|------|-------|
| 36 — Multi-select foundation (Shift/Cmd-click; bulk delete/duplicate; multi-highlight; Inspector multi-state) | `specs/2026-06-22-savig-m4-slice36-multi-select-design.md` | `20c5135` |
| 37 — Multi-object move (drag a member → all move; arrows nudge all; outlines follow) | `specs/2026-06-22-savig-m4-slice37-multi-move-design.md` | `466ebb0` |
| 38 — Marquee (rubber-band) selection (drag the empty background → select intersecting; Shift adds) | `specs/2026-06-22-savig-m4-slice38-marquee-design.md` | `5241108` |
| 39 — Multi-object copy/cut/paste (clipboard → list; bulk; drops the cut collapse) | `specs/2026-06-22-savig-m4-slice39-multi-clipboard-design.md` | `3bb3763` |

## What's next / backlog

Curated pointers — the authoritative lists live in each spec's *Deferred / Non-goals*
section and the master spec §10. When a slice ships, move it up into a table and prune here.

**Recommended next (M4 — the selection toolkit (36–39) is complete; next is acting on groups):**

| Candidate | Why / source |
|-----------|--------------|
| **Multi-object transform** (a group bbox with resize/rotate/scale handles acting on all selected; per-object scale-about-pivot + position math) — the main remaining selection capability | slice36 §4, slice37 §3 |
| **Grouping** (parent/child container; needs a data-model + nested-transform render/export/persistence change) — the M4 headline, unblocked by multi-select | master §10 |
| **Boolean path ops** (union/intersect/subtract; robust polygon clipping) — gated on multi-select, now unblocked | slice6 §12, slice7 §13 |
| **Nested symbols / clips** (Flash-style reusable animated symbols) — the large M4 item | master §10 |
| Multi-object snapping (move-drag suppresses snap for >1 today); paste-at-cursor | slice37 §3, slice39 §3 |

**Other tracked backlog (non-M4):**

| Candidate | Source |
|-----------|--------|
| Cross-OBJECT keyframe paste; paste-at-cursor; multi-keyframe select+cut | slice29 / slice24 deferrals |
| Cross-TYPE gradient morph (linear↔radial); userSpaceOnUse / spreadMethod / gradientTransform; per-stop opacity UI; HSL/OKLCH stops; `fill: string \| Gradient` paint-union refactor | slice34 §2, slice8/9 deferrals |
| Snapping: resize/scale/rotate handles + node drags; distance/spacing guides; snap-to-grid; hold-to-bypass modifier | slice33 §4 |
| Parametric LINE/rect/ellipse; animating primitive params; on-canvas radius/rotation handle | slice35 §4 |
| Pressure/velocity-variable brush width; input stabilizer; Schneider least-squares fit; textured brushes | slice7 §13 |
| Alt-to-scale-from-CENTRE for rotate; aspect-ratio snapping presets | slice28/30 deferrals |
| **Deferred-polish "C-list"** (mostly done): ~~snapping/guides~~ (slice 33); bundled starter project; single-file vs folder export; license choice | master §10 |

**Roadmap docs:** big-picture M1–M11 table + C-list →
`specs/2026-06-19-savig-animated-svg-editor-design.md` §10; M2 morph/easing sequencing →
`specs/2026-06-20-savig-m2-morph-easing-roadmap-design.md`.
