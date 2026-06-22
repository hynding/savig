# Savig M2 Slice 30 — Alt to scale / resize **from center**

**Date:** 2026-06-21
**Status:** Approved (autonomous slice cycle)
**Depends on:** Slice 23/26 (scale handles), Slice 1 (resize handles), Slice 28 (uniform shift + `handleMath.ts`)

## 1. Goal

Hold **Alt** (Option on macOS) while dragging an on-canvas transform handle to
scale/resize **symmetrically about the object's center** instead of keeping the
opposite edge/corner fixed. Covers BOTH handle systems, mirroring Slice 28:

- **Scale handles** (svg / path objects — `Transform2D.scaleX/scaleY`, `applyScaleHandleDrag`)
- **Resize handles** (rect / ellipse geometry — `width`/`height`, `applyHandleResize`)

Alt composes with the existing **Shift** (uniform / keep-aspect) modifier:
`Alt+Shift` = uniform scale **from center**.

This completes the on-canvas transform-handle suite: move → rotate → scale-corner
(S23) → edge-scale (S26) → uniform-shift (S28) → **center-anchor Alt (S30)**.

## 2. Scope (YAGNI)

**In:**
- `fromCenter?: boolean` input on `ScaleInput` and `ResizeInput`; a branch in each
  pure helper. Both default falsy → existing callers unchanged.
- Thread `fromCenter: e.altKey` at the two Stage drag call sites (live, re-evaluated
  each pointer-move like `uniform: e.shiftKey`).
- Corner handles: scale/resize BOTH axes symmetrically about center.
- Edge handles: scale/resize the SINGLE moving axis symmetrically about center
  (cross axis unchanged).
- `Alt+Shift` (uniform + from-center) composes.

**Out (deferred, tracked):**
- Alt on the ROTATE handle (rotation has no center-vs-edge distinction).
- Numeric / aspect-ratio lock presets.
- Snapping.
- `pointercancel` leaving a drag ref dangling (pre-existing pattern across
  resizeRef/scaleRef/dragRef — a coordinated fix, not this slice).

**Editor-only.** ZERO engine / store / persistence / render / runtime / export /
migration change. Project stays v4. No bundle regen.

## 3. The math

### 3.1 Scale (`applyScaleHandleDrag`, content space, rotation-aware)

Content map (already used by the file):
`content(p) = anchor + base + R(rot)·S·(p − anchor)`, with `S = diag(scaleX, scaleY)`,
`anchor` = object-local pivot, `base = (baseX, baseY)`.

Key fact: `content(anchor) = anchor + base` for **any** `S`. So scaling about the
anchor with **base unchanged** holds the pivot fixed. Alt-scale is therefore the
pure scale-about-anchor solve:

```
u   = R(-rot) · (P - anchor - base)           // P = pointer (content)
sx  = (corner.x === anchorX) ? startScaleX : u.x / (corner.x - anchorX)
sy  = (corner.y === anchorY) ? startScaleY : u.y / (corner.y - anchorY)
sx,sy clamped >= MIN_SCALE
x = baseX,  y = baseY                          // base UNCHANGED
```

- Corner handle: `corner − anchor = (±w/2, ±h/2)` (centered pivot) → both axes solved.
- Edge handle: one component of `corner − anchor` is 0 → that axis holds `startScale`
  (single-axis symmetric scale).

**Uniform + from-center (`Alt+Shift`):** project `P` onto the line through the
anchor-content `A = (anchorX+baseX, anchorY+baseY)` and the corner's start-content
`Cc = content(corner)` BEFORE the solve. Then `u = t · S0 · (corner − anchor)` ⇒
`sx = t·S0x`, `sy = t·S0y` ⇒ aspect preserved. Floor `t ≥ tMin =
max(MIN_SCALE/S0x, MIN_SCALE/S0y)` (same proof as S28; also catches NaN/negative,
i.e. dragging past the anchor — no flip). Corners only.

### 3.2 Resize (`applyHandleResize`, object-local, rotation-aware base compensation)

Center (old local) = `(width/2, height/2)`. Dragging a handle to local `(lx, ly)`:

```
w2 = (movesLeft || movesRight) ? max(minSize, 2·|lx - width/2|) : width
h2 = (movesTop  || movesBottom) ? max(minSize, 2·|ly - height/2|) : height
```

Reuse the EXISTING base-compensation formula with the **center** as the fixed
point (instead of the opposite edge):

```
Fo = (width/2, height/2)      // fixed point, old local
Fn = (w2/2,    h2/2)          // fixed point, new local
base' = base + (A - A') + RS · [ (Fo - Fn) + (A' - A) ]
```

(`A`/`A'` = old/new anchor = `anchorFrac · extent`; `RS = R(rot)·diag(scaleX,scaleY)`.)
With the default centered pivot (`anchorFrac = 0.5`) the center equals the anchor, so
scale-from-center and resize-from-center keep the same fixed point.

**Uniform + from-center:** project the local pointer onto the line through the center
`(width/2, height/2)` and the dragged corner `(movesRight?width:0, movesBottom?height:0)`.
On that line `proj − center = t·(±w/2, ±h/2)` ⇒ `w2 = |t|·width`, `h2 = |t|·height` ⇒
aspect preserved. Floor `t ≥ tMin = max(minSize/width, minSize/height)`. Corners only.

## 4. Implementation surface

- `src/ui/components/Stage/scaleHandles.ts` — add `fromCenter?: boolean` to
  `ScaleInput`; branch: when `fromCenter`, run §3.1 (with the uniform projection onto
  `A→Cc`) and return early; else the existing opposite-fixed path is unchanged.
- `src/ui/components/Stage/resizeHandles.ts` — add `fromCenter?: boolean` to
  `ResizeInput`; compute `w2/h2` and the fixed point `Fo/Fn` per §3.2 inside the
  branch (with the uniform projection onto `center→corner`); the shared anchor +
  rotation + base-compensation block stays DRY.
- `src/ui/components/Stage/Stage.tsx` — add `fromCenter: e.altKey` to BOTH the
  `applyScaleHandleDrag` (line ~583) and `applyHandleResize` (line ~712) calls.

`handleMath.ts` (`projectParam`) is reused unchanged.

## 5. Testing

**Pure unit (`scaleHandles.test.ts`, `resizeHandles.test.ts`):**
- Scale from-center, axis-aligned (rot 0): dragging a corner to a point twice as far
  from center doubles BOTH scales; base (x,y) UNCHANGED.
- Scale from-center, non-square + rotated: independent per-axis factors; base unchanged.
- Scale Alt+Shift (uniform from-center): off-diagonal pointer keeps `sx/sy =
  startScaleX/startScaleY`; pinned values.
- Scale from-center EDGE handle: only the moving axis changes; cross axis holds start
  scale; base unchanged.
- Scale from-center near-zero: both axes floored at `MIN_SCALE`, aspect held under uniform.
- Resize from-center, rot 0: corner drag grows width/height symmetrically about center;
  the CENTER stays fixed in stage space (assert `base'` re-centers — old center maps to
  the same stage point as new center).
- Resize from-center EDGE: single-axis symmetric; cross axis + center fixed.
- Resize Alt+Shift uniform from-center: aspect constant; near-zero aspect-floor.
- Existing callers (no `fromCenter`) byte-identical (covered by the unchanged S1/26/28 tests).

**Stage integration (`Stage.test.tsx`, jsdom + identity CTM):**
- Alt-drag a scale corner → committed `scaleX/scaleY` ≈ symmetric factor; `x/y`
  unchanged from origin.
- Alt-drag a resize corner → committed `width/height` symmetric; object center
  unchanged.

**e2e (`alt-scale-from-center.spec.ts`, real chromium):**
- Import/draw an svg/path object → Select → Alt-drag a scale corner → assert the
  object grew on both sides of center (its bounding box center is unchanged while
  width grew). Reuse the S26/28 scale-handle harness.

## 6. Risks / decisions

- **Alt on macOS = Option.** `PointerEvent.altKey` is true during the drag; no browser
  default fires mid-pointer-capture (Shift was clean in S28; Alt is analogous). The e2e
  proves it in real chromium.
- **Center vs pivot for resize.** We fix the geometric center; with centered pivots
  (the app default) that equals the anchor, so the two handle systems agree. Documented.
- **No flip:** the `tMin` floor and `MIN_SCALE`/`minSize` clamps prevent the object
  inverting when the pointer crosses the center.
