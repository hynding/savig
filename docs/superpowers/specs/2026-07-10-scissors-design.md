# Scissors — Design

**Date:** 2026-07-10 · **Status:** Approved (program roadmap #4; decisions documented per pre-approved
autonomous flow) · **Roadmap:** docs/superpowers/specs/2026-07-10-art-tools-roadmap.md

## Goal

A Scissors tool (key `c`): click a point on a path segment — a **closed** path opens at that point
(cut point becomes the start AND end anchor); an **open** path splits into **two objects**. The cut
is geometry-exact (true cubic subdivision, no shape distortion) and position-exact (pieces don't
move, regardless of the object's rotation/scale).

## Decisions (with rationale)

1. **Cut math is real de Casteljau, in engine:** new `packages/engine/src/cutPath.ts` exporting
   `cutPath(path: PathData, segmentIndex: number, t: number): { kind: 'opened'; path: PathData } |
   { kind: 'split'; a: PathData; b: PathData }`. Uses `splitCubicRange`/`evalCubic` from
   `geom/boolean-curves.ts` (straight segments split by lerp — same result). The existing
   `insertNodeAt` linear-lerp is NOT reused (it distorts curves — a pre-existing node-tool gap we
   deliberately do not inherit; fixing insertNodeAt itself is out of scope, logged as follow-up).
   Cut-point anchors get the split's exact handle pairs (in/out from the subdivided cubic halves);
   the cut anchors themselves are corner nodes (no cross-cut smoothing).
   - Closed → `opened`: nodes reordered so the cut point is `nodes[0]` (with its `out` handle) and
     duplicated as the LAST node (with its `in` handle); `closed: false`.
   - Open → `split`: piece `a` = nodes[0..cut], piece `b` = cut..end; degenerate cuts (t≈0/t≈1 on
     the first/last segment producing an empty or single-node piece) are rejected — `cutPath`
     returns the input unchanged via a third variant `{ kind: 'noop' }` (spec'd: a piece must have
     ≥2 nodes).
2. **Chord-t → curve-t:** `hitTestSegment` returns straight-chord t (documented approximation).
   For segments with handles, re-project the click point onto the actual cubic via the exported
   `projectToCubic` (boolean-curves.ts) before splitting, so the cut lands where the user clicked
   on the CURVE. Straight segments use chord-t directly.
3. **Store op `cutSelectedPathAt(segmentIndex, t): void`** (node-tool conventions; active-scene
   routed). Gates (each a silent no-op + `pushToast('error', …)` message, groupSymbolSlice
   precedent):
   - object is a vector path (not rect/ellipse/text/svg/group/instance);
   - **`shapeTrack` present → blocked** ("Can't cut a morphing path") — NEW rule, deliberately
     diverging from node-editing's edit-current-keyframe precedent because a structural split into
     two objects cannot be expressed across keyframes;
   - **`compoundRings` present → blocked** ("Release compound shapes before cutting") — the
     what-happens-to-the-holes question has no v1 answer;
   - boolean operands/results follow existing editability (an operand consumed by a live boolean
     isn't clickable on stage anyway; a live boolean RESULT object is blocked — its path is
     derived).
   Effects:
   - `opened`: object keeps identity; path replaced via the setPathData seam (primitive-detach
     fires as with any node edit — cutting a stamped star detaches its spec + strips its param
     tracks, the established rule).
   - `split`: original object becomes piece `a` (path replaced, nodes left in original local
     coords); piece `b` = NEW asset+object (style deep-copied, `base` copied verbatim, name
     `<name> cut`, `zOrder: nextZOrder(...)`, appended via `appendObjectToScene`) — ONE commit.
   - **Anchor pinning (position exactness):** before the cut, resolve the original object's anchor
     point once (`resolveAnchor` semantics, local coords); BOTH pieces get
     `anchorMode: 'absolute'` with that point (fraction anchors re-derived from each piece's
     smaller bbox would move the rotate/scale pivot and visibly shift rotated/scaled pieces).
     Applies to the `opened` case too only if the node set changes bbox — it doesn't (same nodes),
     so `opened` keeps the object's existing anchor untouched.
   - **Animation fields on pieces:** transform `tracks` copied verbatim to piece b (it moves like
     the original). `trim` and `dashOffsetTrack` are DROPPED from both pieces (a cut redefines the
     path's 0..1 parameterization — normalized trim/dash fractions would silently point at
     different arcs; dropping is honest; the static `strokeDasharray` pattern on the STYLE is kept
     since it's length-relative and re-scales cleanly). `motionPath` copied verbatim. `repeat`
     copied verbatim.
   - Selection after: both pieces selected (`selectedObjectIds: [a, b]`; `selectedObjectId: b` —
     boolean-result convention of surfacing the op's product).
4. **Tool wiring (eyedropper/node checklist):** `ToolMode 'scissors'`; ADD to `SYMBOL_EDIT_TOOLS`
   (path-structural like node); registry `tool('tool.scissors', 'Scissors tool', 'scissors', 'c')`
   (unmodified `c` confirmed free); ToolPalette entry + icon; Stage `onBackgroundPointerDown`
   branch (mirror the node branch's ring-scan hit-test but calling the cut op; scissors is
   one-shot per click but the tool STAYS active — repeated cuts are the workflow, unlike
   eyedropper); `onObjectPointerDown` early-exit so clicks on painted fills route to the cut
   hit-test instead of move-drag (eyedropper precedent, but WITHOUT the revert-to-select).
   Empty-canvas click: no-op, tool stays.
5. **Agent surface:** core builder `cutPath` already IS the engine function; expose a store-level
   only feature v1 — DSL/MCP omitted (a click-point tool; agents can express cuts poorly without
   a hit-test. Deferred until someone asks). describe/validate untouched (no new model fields).
6. **Out of scope:** cutting compound rings; cutting morphing paths; fixing `insertNodeAt`'s
   linear-lerp distortion (follow-up ticket); joining/welding (the inverse tool); DSL/MCP surface;
   multi-cut drag gestures.

## Testing

- Engine unit (`cutPath.test.ts`): closed→opened node order/handles/closed flag (exact node
  arrays incl. de Casteljau handle values against hand-computed splits); open→split piece
  contents; straight-segment cuts; curved-segment cuts preserve shape (flattenPath-sample the
  original vs the concatenated pieces at N points — max deviation < epsilon); degenerate → noop;
  t clamping.
- Store unit: each gate (non-path, shapeTrack, compoundRings, boolean result) toasts + no commit;
  opened keeps identity + primitive-detach fires; split creates piece b (style/base/tracks copied,
  trim/dash dropped, absolute anchor pinned at the original resolved point) in ONE commit
  (single undo restores); selection convention; in-symbol scope.
- Interaction: chord-t→curve-t re-projection (unit on the Stage helper or interaction util).
- Component: Stage scissors branch cuts on segment click; object-press early-exit routes to cut.
- E2E (`e2e/scissors.spec.ts`): pen-draw an open 3-node path (or line tool), scissors-click the
  middle segment → two `[data-savig-object]` nodes; draw an ellipse→no (not a path) — use a
  closed pen path instead → scissors click → still one object but open (assert `d` has no `Z`).
  Full gates + @portable.
