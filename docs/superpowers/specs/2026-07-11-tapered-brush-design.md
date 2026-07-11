# Tapered Brush — Design

**Date:** 2026-07-11 · **Status:** Approved (program roadmap #6; decisions documented per pre-approved
autonomous flow) · **Roadmap:** docs/superpowers/specs/2026-07-10-art-tools-roadmap.md

## Goal

The brush gains a width profile: taper-in/out ramps and optional pen pressure. When any profile is
active, the stroke commits as a BAKED FILLED OUTLINE (via feature 5's `outlineStroke` width-fn
hook) — the classic motion-graphics brush look. With no profile (the default), the brush is
byte-identical to today (stroked centerline; trim/draw-on and stroke animation keep working).

## Decisions (with rationale)

1. **Parity-first commit branch:** taper active ⇔ `brushTaperIn > 0 || brushTaperOut > 0 ||
   brushUsePressure`. Inactive → today's `addVectorPath(path, {strokeWidth, round caps})`
   UNCHANGED (the Stage unit test pinning stroked output and e2e/brush.spec stay green
   untouched). Active → bake: `outlineStroke(strokeToPath(samples, params), widthFn, 'round',
   'round')` → commit rings as a filled path. The trade-off (no trim/stroke-anim on baked
   strokes) is inherent and documented; users who want draw-on keep taper off.
2. **State (EditorState top-level, transportPrefsSlice pattern):** `brushTaperIn: number` (0..0.5,
   fraction of stroke length, default 0), `brushTaperOut: number` (same, default 0),
   `brushUsePressure: boolean` (default false). Setters clamp; defaults keep parity.
3. **Width function (pure, engine `brush.ts` next to `strokeToPath`):**
   `buildBrushWidthFn(opts: { size: number; taperIn: number; taperOut: number; pressureAtT?: (t: number) => number }): (t: number) => number`
   = `size × rampIn(t) × rampOut(t) × pressureScale(t)`, where rampIn rises 0→1 linearly over
   `[0, taperIn]` (1 when taperIn=0), rampOut falls 1→0 over `[1−taperOut, 1]`, and
   `pressureScale = pressureAtT ? clamp(2·pressureAtT(t), 0.1, 2) : 1` (Pointer Events mouse
   constant 0.5 → 1×; pen 0..1 → 0..2×). Result clamped ≥ 0.1 (degenerate-zero guard —
   outlineStroke's rails need non-zero width; the taper endpoints visually converge at 0.1px).
4. **Pressure capture (approach: raw-sample arc-length resample — does NOT touch
   simplify/dedupe/PathPoint):** the brush controller's closure accumulates `(point, pressure)`
   pairs together at capture time (widen `begin`/`move` to accept an optional pressure — the
   Stage handlers read native `e.pressure`; React's synthetic pointerdown proxies it).
   At `end()`, build `pressureAtT` from the RAW samples' own cumulative arc length (piecewise
   linear lookup), independent of what dedupe/RDP later drop. Raw-t vs smoothed-curve-t misalign
   slightly (smoothing changes length) — accepted approximation, noted in code.
   Mouse input (constant 0.5) with `brushUsePressure` on yields 1× everywhere — harmless.
5. **Committing rings:** new store action `addVectorOutline(rings: PathData[], styleSeed?)` —
   `addVectorPath`'s normalization generalized to multi-ring (normalize ALL rings by the
   COMBINED bbox origin; `path = rings[0]`, `compoundRings = rings.slice(1)` omitted when
   empty). Style seed from the bake branch: `{ fill: <today's default brush stroke color — read
   PATH_DEFAULT_STYLE>, stroke: 'none', strokeWidth: 0 }` (mirrors computeOutlineStrokeEffect's
   output style shape). Selection/tool-switch behavior identical to addVectorPath.
6. **Options UI:** PrimitiveOptions brush branch gains rows mirroring Size/Smoothing: "Taper in"
   (%: range 0–50, maps to 0..0.5), "Taper out" (same), "Pressure" (checkbox; shown always —
   auto-detection by pointerType is out of scope). VM + intents extended accordingly.
7. **Live preview stays the centerline polyline** (today's raw `d` preview). A width-accurate
   ribbon preview per pointermove would run outlineStroke per event — deferred (perf); the
   committed result appearing tapered is acceptable v1 feedback.
8. **No DSL/MCP** (gesture tool). No model changes (output is a plain filled path + rings).
9. **Out of scope:** ribbon live-preview; pressure auto-detect; velocity-based width; taper
   easing curves (linear only); editing a baked stroke's profile after commit.

## Testing

- Engine unit (`brush.test.ts` append): buildBrushWidthFn — SEMANTICS (binding): final width =
  `max(0.1, size · rampIn(t) · rampOut(t) · pressureScale(t))` (PRODUCT of ramps; the 0.1 clamp
  applies to the final width). Pin: taperIn .2, size 10 → t=0 → 0.1 (clamped), t=0.1 → 5,
  t≥0.2 → 10; symmetric taper-out; OVERLAPPING ramps (taperIn=.8, taperOut=.8) → product gives a
  bump-shaped profile peaking at t=.5 below full size — pin the midpoint value; pressure lookup
  resample (raw samples with varying pressure → piecewise values at t stations); mouse-0.5 → 1×.
- Controller unit (`brushTool.test.ts` append): pressure pairs accumulate; taper-off end() commits
  via addVectorPath byte-identical to today (existing tests green unmodified); taper-on end()
  calls outlineStroke and commits fill-only style via addVectorOutline (mock-free store fixture
  per existing controller tests).
- Store unit: addVectorOutline multi-ring normalization (combined bbox; compoundRings byte-clean),
  selection/tool behavior parity with addVectorPath.
- Component: PrimitiveOptions rows commit through intents.
- E2E (`e2e/tapered-brush.spec.ts`): set Taper in/out 30% via the panel, draw the brush.spec
  zigzag with page.mouse → ONE committed object with `fill` set and `stroke` none/absent and `d`
  containing `Z`; existing e2e/brush.spec.ts untouched and green (parity). Pressure e2e skipped
  (Playwright mouse has no pressure; unit-covered).
- Full gates + @portable.
