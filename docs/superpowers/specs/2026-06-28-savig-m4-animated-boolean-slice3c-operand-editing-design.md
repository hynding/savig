# Animated Boolean — Slice 3c: Operand Discoverability on Canvas — Design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)
**Area:** Savig M4 — boolean follow-ups (animated boolean milestone, slice 3c)
**Scope:** Make a live boolean's render-hidden operands visible and selectable on the editor canvas

## Milestone context

Slices 1/2/3a/3b shipped live-boolean geometry, authoring, standalone export, and group/nested
operands. A live boolean's operands are render-hidden — `flattenInstances` puts them in a `consumed`
set so they're sampled for the clip but not drawn (the boolean's result replaces them visually). The
editor Stage renders from `flattenInstances` too (`renderLeaves`), so operands are **invisible on the
canvas**. They appear only as rows in the Layers panel.

## The gap

Operands are already fully **editable** once selected: the Stage selection overlay computes
`entityAABB` for any selected object regardless of render, so selecting an operand in the Layers panel
shows its bbox + transform handles, and moving/scaling it re-clips the boolean live (the editor calls
`resolveBooleanRings` every frame). The ONLY missing piece is **canvas discoverability**: you cannot
see where a boolean's operands are, nor click them on the canvas — you must hunt in the Layers tree.

## Goal

When a live boolean (or one of its operands) is selected, draw each operand as a faint "ghost"
outline on the canvas, and let a click on a ghost select that operand. The operand then edits with the
existing handles, re-clipping the boolean live. This closes the boolean authoring/editing loop on the
canvas.

### Non-goals (3c)

- **Alt-aware button-disabled state** — ALREADY SATISFIED by 3b: live-operand eligibility converged
  with `canBool` (`Inspector.tsx`: `eligibleForBool` counts groups + booleans; the store's live filter
  is now `eligible`), so an enabled boolean button always forms a live boolean under Alt, and the
  buttons already title `"Alt: animated (live) boolean"`. No work here. (Removed from 3c scope.)
- Editing an operand's geometry via node-editing through the ghost (the ghost selects the object; node
  editing then uses the normal Node tool flow — unchanged).
- A dedicated "operand-edit mode" (heavy; rejected — the ghost-and-select affordance is enough).
- Always showing operands (only when the boolean or an operand is selected — operands stay hidden
  otherwise, preserving the "boolean replaces its operands" model).
- Per-frame clip caching (3d).
- Root-scene only (live booleans are root-only through this milestone).

## Architecture

A live boolean draws its result path directly from `resolveBooleanRings` world coordinates inside the
Stage content `<g>` (the boolean's own `<g>` carries no per-object transform). So an operand ghost,
computed from the operand's WORLD geometry, draws in the exact same coordinate space with no transform
math. `operandWorldGeom(project, obj, time)` already returns an operand's world geometry uniformly for
a leaf (its outline), a group (union of its leaves), and a nested boolean (its result) — but typed
`PcPolygon | PcMultiPolygon`, which needs depth-normalization before serializing to an SVG path.

### Component 1: engine — `operandWorldRings`

`src/engine/geom/boolean.ts`. A small exported helper mirroring `resolveBooleanRings`'s return shape,
so the Stage renders a ghost exactly like it renders the boolean:

```ts
/** The world-space outline rings of a single boolean OPERAND (a leaf shape, a GROUP's leaf-union, or
 *  a nested boolean's result) at `time`, as a flat PathData[] (compound, even-odd like the boolean's
 *  own rings). [] when the operand contributes no geometry. Used by the editor to ghost a selected
 *  boolean's operands on canvas. Normalizes operandWorldGeom's PcPolygon | PcMultiPolygon. */
export function operandWorldRings(project: Project, obj: SceneObject, time: number): PathData[] {
  const geom = operandWorldGeom(project, obj, time, new Set());
  if (geom.length === 0) return [];
  // PcPolygon (Ring[]) -> geom[0][0] is a Pair (number,number); PcMultiPolygon (Polygon[]) ->
  // geom[0][0] is a Ring (Pair[]). Distinguish by whether the innermost is a number.
  const isMulti = Array.isArray((geom as PcMultiPolygon)[0]?.[0]?.[0]);
  const rings: PcRing[] = isMulti ? (geom as PcMultiPolygon).flat() : (geom as PcPolygon);
  return rings.map((r) => ringToPathData(r));
}
```

(`ringToPathData` already exists in this file; export it or keep it module-private and use it here —
it stays private, `operandWorldRings` is the new export.) `operandWorldGeom`'s `visited` param gets a
fresh set (a top-level operand outline; nested-boolean operands resolve through it with their own
cycle guard).

### Component 2: Stage — ghost overlay + click-to-select

`src/ui/components/Stage/Stage.tsx`. Inside the content `<g>` (line ~1753), after the `renderLeaves`
map and before the selection-handle overlays, add an operand-ghost layer:

1. **Active boolean for operand editing** (memoized): from the single selection `selectedId`,
   - if its object has `.boolean` → that object is the active boolean;
   - else the first root object `b` with `b.boolean?.operandIds.includes(selectedId)` → `b`;
   - else none.
   Gated on `activeAssetId === null` (root scene). When an operand is selected, its owning boolean is
   the active boolean, so sibling ghosts stay visible while editing.

2. **Ghosts:** for each `operandId` of the active boolean, resolve the operand object, compute
   `operandWorldRings(project, operandObj, time)`, and if non-empty render:

   ```tsx
   <path
     key={`operand-ghost-${operandId}`}
     data-testid={`operand-ghost-${operandId}`}
     data-operand-of={activeBoolean.id}
     d={pathToDRings(rings[0], rings.slice(1))}
     fillRule="evenodd"
     fill="transparent"            /* interior is clickable but invisible */
     stroke="var(--color-accent)"
     strokeOpacity={0.5}
     strokeWidth={1 / zoom}
     strokeDasharray={`${4 / zoom} ${3 / zoom}`}
     style={{ pointerEvents: 'all', cursor: 'pointer' }}
     onPointerDown={(e) => { e.stopPropagation(); useEditor.getState().selectObject(operandId); }}
   />
   ```

   `fill="transparent"` + `pointerEvents:'all'` makes the whole operand area select it (not just the
   thin stroke); `stopPropagation` prevents the canvas-background deselect. Overlapping operands →
   the topmost (last-drawn) ghost wins the click — acceptable.

3. **Order:** ghosts draw above the boolean's filled result (so they're visible over it) and below the
   selection handles (so handles stay grabbable). They animate with `time` (operandWorldRings samples
   at the playhead).

No change to selection handles, move/scale/rotate, or the Layers panel — once a ghost selects an
operand, every existing edit path already works and re-clips the boolean live.

## Edge cases

- **Degenerate operand** (empty group, or a nested boolean that's currently empty) → `operandWorldRings`
  returns `[]` → no ghost for it (nothing to click; edit it via Layers if needed). Harmless.
- **Operand also animated** → the ghost re-derives each frame (sampled at `time`), so it tracks the
  operand as it animates.
- **Multiple booleans sharing an operand** (rare) → the active-boolean lookup picks the first; the
  selected operand's ghost-set is that boolean's. Acceptable for v1.
- **Selection is a non-boolean, non-operand object** → no active boolean → no ghosts (parity: the
  canvas is unchanged for every non-boolean editing context).
- **Inside a symbol** (`activeAssetId !== null`) → no ghosts (no live booleans there).

## Files touched

- `src/engine/geom/boolean.ts` — add `operandWorldRings`.
- `src/engine/geom/boolean.test.ts` — `operandWorldRings` for a leaf, a group (union), a nested
  boolean; `[]` for a degenerate operand.
- `src/ui/components/Stage/Stage.tsx` — active-boolean memo + operand-ghost overlay.
- `src/ui/components/Stage/Stage.test.tsx` — ghosts render for a selected boolean's operands; a ghost
  click selects the operand; no ghosts for an unrelated selection.
- `e2e/boolean-ops.spec.ts` (or a new `e2e/boolean-live-operands.spec.ts`) — select a live boolean →
  operand ghosts visible → click a ghost → operand selected (handles appear) → nudge it → boolean
  result changes. (One focused e2e.)

## Testing

- **Engine (unit):** `operandWorldRings` returns ≥1 ring for a leaf operand; for a two-rect GROUP it
  returns the union outline (bounds span both rects); for a nested boolean with a hole it returns ≥2
  rings (outer + hole); `[]` for an empty group. (Mirrors the `resolveBooleanRings` fixtures.)
- **Stage (RTL):** with a live boolean selected, `operand-ghost-<id>` paths render for each operand
  with a non-empty `d`; clicking one calls `selectObject(operandId)` (assert `selectedObjectId`);
  selecting an unrelated rect renders no ghosts; selecting an operand still shows its siblings' ghosts.
- **E2E:** the full loop (select boolean → ghost → click → handles → nudge → result updates).
- **Parity:** existing Stage tests stay green (ghosts only appear in a boolean editing context).

## Open / deferred

- Distinct styling for the currently-selected operand's ghost vs siblings (cosmetic).
- Node-editing an operand directly through its ghost (use the Node tool after selecting — unchanged).
- 3d: per-frame clip caching (only if profiling warrants).
- The 3b deferrals (curve-preserving group/nested operands; boolean-inside-group operand; SVG operands).
