# Animated Boolean — Slice 3d: Per-Frame Clip Caching — Decision (NOT BUILT)

**Date:** 2026-06-28
**Status:** Closed — measured, not warranted
**Area:** Savig M4 — boolean follow-ups (animated boolean milestone, slice 3d)

## Context

Across slices 1/2/3a/3b/3c, a live boolean's path is recomputed every frame by `resolveBooleanRings`
(`computeFrame` → editor render/playback + standalone export runtime). Slice 3d was reserved, from the
start, as **conditional**: "per-frame clip caching — only if profiling warrants." This document records
the measurement and the decision NOT to build it.

## Measurement

A throwaway benchmark (`src/engine/geom/_bench_3d.test.ts`, since deleted) built deliberately heavy
synthetic scenes — each live boolean a `union` of two GROUP operands, each group a union of N
overlapping, **animated** rects (so the clip genuinely changes per frame) — and timed the FULL
`computeFrame` (entire scene walk + every boolean clip) over 60 frames, plus a single heavy
`resolveBooleanRings`. Run under the project's Vitest (jsdom/node, single-threaded):

| Scene | Live booleans | Total objects | `computeFrame` avg |
|-------|---------------|---------------|--------------------|
| small  | 5  | 35  | **0.52 ms/frame** |
| large  | 20 | 180 | **1.77 ms/frame** |
| extreme| 50 | 550 | **7.37 ms/frame** |

Single `resolveBooleanRings` (2 groups × 8 leaves): **0.33 ms**.

## Decision: do NOT build clip caching

- The 60fps frame budget is ~16.7 ms. Even the **extreme** scene (50 live booleans / 550 objects — far
  beyond any realistic project) computes the *entire* frame in 7.4 ms, under half the budget, and that
  figure is the whole scene walk, not just booleans. A typical scene (a handful of booleans) is well
  under 2 ms.
- A correct cache would have to key on each operand's **resolved geometry at the current time** (operands
  animate), or invalidate on any operand transform/keyframe/parent-group change. That invalidation
  surface is broad and a subtle key error would silently render a stale clip — a real correctness risk —
  for a saving that is already comfortably within budget.
- YAGNI: speculative caching trades real complexity + risk for no measurable benefit.

## Re-open criteria

Revisit only if real-world profiling (not synthetic) shows boolean clipping pushing `computeFrame`
toward the frame budget — e.g. dozens of live booleans whose operands are themselves deep nested
booleans or large curved paths. If so, the lowest-risk first step is **memoizing within a single
`computeFrame` pass** (dedupe redundant same-frame recomputes from multiple consumers) before any
cross-frame cache.

## Outcome

With 3d closed, the **animated-boolean milestone (slices 1, 2, 3a, 3b, 3c, 3d) is COMPLETE**.
