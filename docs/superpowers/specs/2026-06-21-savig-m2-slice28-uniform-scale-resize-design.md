# M2 Slice 28 — Uniform (shift) scale & resize (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §6)
Predecessor: Slice 27 — lock-aware timeline (merged `99c69f6`)

## 1. Goal

Hold **Shift while dragging a corner handle to keep the aspect ratio** — the universally
expected constrained-resize gesture, currently missing from both on-canvas size systems:
the **scale** handles (imported-SVG & path, S23/S26) and the **resize** handles
(rect/ellipse geometry, S1). Shift on an **edge** handle is a no-op (edges are inherently
single-axis); shift only constrains the four **corners**.

Both systems get it via the same idea: when Shift is held, **project the pointer onto the
dragged corner's start diagonal** before the existing free computation. The projected
point lies on the corner diagonal, so the resulting scale (or geometry) comes out at the
**start aspect ratio** — provably (see §2). Shift is read live each pointer-move, so
toggling it mid-drag works.

Non-goals (deferred, §7): Shift on edge handles doing something special; a fixed list of
"snap" aspect ratios; aspect-lock for the rotate/gradient handles (N/A); proportional
multi-object scale (M4).

## 2. The shared math — `projectOntoLine`, and why it preserves aspect

New pure helper `src/ui/components/Stage/handleMath.ts`:

```ts
export interface Pt2 { x: number; y: number; }

/** Orthogonally project point `p` onto the infinite line through `a` and `b`.
 *  Returns `a` when `a` and `b` coincide (degenerate line). */
export function projectOntoLine(p: Pt2, a: Pt2, b: Pt2): Pt2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
```

**Scale (content space).** `applyScaleHandleDrag` maps a local point via
`content(p) = a + R·S0·(p − a) + base`. With Shift, project the pointer onto the line
through the **opposite** corner's content position and the **dragged** corner's *start*
content position. For a projected point `P' = O_c + t·(C_c − O_c)` (with `O_c`/`C_c` the
opposite/corner content positions, and `C_c − O_c = R·S0·(c − o)`), the existing free
formula yields `sx = t·S0x`, `sy = t·S0y` → **`sx/sy = startScaleX/startScaleY`** (aspect
preserved). Worked check: 100×100, anchor (50,50), scale 1, SE corner, opposite NW →
diagonal `(0,0)→(100,100)`; off-diagonal pointer `(200,150)` projects to `(175,175)` →
`sx = sy = 1.75`.

**Resize (object-local space).** `applyHandleResize` derives `w2`/`h2` from the local
pointer. With Shift on a **corner**, project the local pointer onto the line through the
**fixed** corner and the **dragged** corner's start position, then proceed. Since the
projected point lies on that diagonal, `w2/h2 = width/height` (start aspect).

## 3. `applyScaleHandleDrag` — `uniform` flag

Add `uniform?: boolean` to `ScaleInput`. When `uniform` (and the handle is a corner — for
an edge the diagonal is axis-aligned, so projection is a no-op and single-axis scaling
stands), replace the pointer with its projection onto the start diagonal, then run the
unchanged free computation:

```ts
// at the top of applyScaleHandleDrag, before computing dx/dy:
let px = i.pointerX;
let py = i.pointerY;
// Only corners aspect-lock; for an edge (corner & opposite share a coordinate) the
// projection would wrongly perturb the rotated single-axis result, so skip it.
const isCorner = i.corner.x !== i.opposite.x && i.corner.y !== i.opposite.y;
if (i.uniform && isCorner) {
  const t = (i.rotationDeg * Math.PI) / 180;
  const cr = Math.cos(t);
  const sr = Math.sin(t);
  const contentOf = (lx: number, ly: number) => {
    const ex = i.startScaleX * (lx - i.anchorX);
    const ey = i.startScaleY * (ly - i.anchorY);
    return { x: i.anchorX + (cr * ex - sr * ey) + i.baseX, y: i.anchorY + (sr * ex + cr * ey) + i.baseY };
  };
  const oC = contentOf(i.opposite.x, i.opposite.y);
  const cC = contentOf(i.corner.x, i.corner.y);
  const proj = projectOntoLine({ x: px, y: py }, oC, cC);
  px = proj.x;
  py = proj.y;
}
// …then the existing math uses px/py instead of i.pointerX/i.pointerY.
```

The rest of `applyScaleHandleDrag` (the `R(-rot)`/`u`/`sx,sy`/clamp/translation) is
unchanged except for reading `px`/`py`. MIN_SCALE clamp and the opposite-corner-fixed
translation are inherited.

## 4. `applyHandleResize` — `uniform` flag

Add `uniform?: boolean` to `ResizeInput`. When `uniform` and the handle is a corner
(`(movesLeft||movesRight) && (movesTop||movesBottom)`), project the local pointer onto the
corner diagonal first:

```ts
let lx = i.localX;
let ly = i.localY;
const isCorner = (movesLeft || movesRight) && (movesTop || movesBottom);
if (i.uniform && isCorner) {
  const fixed = { x: movesRight ? 0 : i.width, y: movesBottom ? 0 : i.height };
  const dragged = { x: movesRight ? i.width : 0, y: movesBottom ? i.height : 0 };
  const proj = projectOntoLine({ x: lx, y: ly }, fixed, dragged);
  lx = proj.x;
  ly = proj.y;
}
// …then the existing w2/h2 computation uses lx/ly instead of i.localX/i.localY.
```

The rest (`foX/foY`, anchor compensation, `base'`) is unchanged. `minSize` still applies:
because the projected point is on the diagonal through the (≥minSize-respecting) free
corner, both `w2` and `h2` stay ≥ `minSize`.

## 5. Stage — pass `e.shiftKey`

The window `onMove(e: PointerEvent)` already calls both helpers. Add `uniform: e.shiftKey`
to the `applyScaleHandleDrag({ … })` call and the `applyHandleResize({ … })` call. Shift is
thus read live on every move (press/release mid-drag re-evaluates). No other Stage change.

## 6. Persistence & parity

No engine/store/persistence/render/runtime/export/migration change — pure handle math +
two call-site flags. Reuses the S1 resize and S23/S26 scale infrastructure. Stays v4.

## 7. Decisions (delegated to implementer, recorded)

1. **Slice = Shift-to-keep-aspect** on corner handles, for BOTH scale (svg/path) and resize
   (rect/ellipse). Edges unaffected.
2. **Shared `projectOntoLine`** pure helper; both `applyScaleHandleDrag` and
   `applyHandleResize` gain a `uniform?: boolean` that projects the pointer onto the corner
   start-diagonal first (provably aspect-preserving). The rest of each helper is unchanged.
3. **Stage** passes `uniform: e.shiftKey` to both helpers in the live `onMove` (toggles mid-drag).
4. **Editor-only** — no engine/store/persistence change.
5. **One plan.**

## 8. Deferred (tracked)

- Shift on edge handles (currently a no-op); Alt to scale/resize from the center.
- Aspect-ratio snapping presets; numeric aspect lock in the Inspector.
- Diagonal-projection refinement for very off-axis drags (the projection already handles
  these; only listed if a "feel" tweak is wanted).

## 9. Testing

- **Pure unit (`handleMath.test.ts`):** `projectOntoLine` — a point projects onto the line
  (e.g. `(1,0)` onto `(0,0)→(1,1)` is `(0.5,0.5)`); a point already on the line maps to
  itself; a degenerate line (`a===b`) returns `a`.
- **Scale pure (`scaleHandles.test.ts`):** an SE-corner drag with `uniform: true` and an
  OFF-diagonal pointer yields `scaleX === scaleY` for a square start; for a non-square
  start (`startScaleX=2, startScaleY=1`) the result keeps `scaleX/scaleY === 2`
  (aspect preserved regardless of pointer). A non-uniform drag (existing tests) is
  unaffected.
- **Resize pure (`resizeHandles.test.ts`):** an `se` drag with `uniform: true` and an
  off-diagonal local pointer yields `width/height === startWidth/startHeight`.
- **Stage unit (`Stage.test.tsx`):** Shift-dragging a scale CORNER on an imported-svg
  object commits `scaleX === scaleY` (aspect-locked), where a non-shift drag to the same
  point would not.
- **e2e (Playwright):** import box.svg → instance → Select → Shift-drag the `scale-handle-se`
  corner along an off-diagonal path → the object's `transform` has `scale(k, k)` with equal
  factors (aspect preserved), and is no longer `scale(1, 1)`.
