# Per-instance overrides: TINT + FIRST-FRAME

**Status:** design spec | **Date:** 2026-06-28 | **Slice:** 47f

---

## 1. Goal

Two instances of the same `SymbolAsset` can already diverge in *timing* (47c).
This slice adds two more per-instance *visual* overrides so they can also diverge in
**appearance**:

1. **TINT** — an optional semi-transparent color overlay applied to all of the
   instance's rendered content (color + amount/strength 0–1).  Default absent = no
   tint (byte-identical parity).

2. **FIRST-FRAME (static poster)** — when true, the instance's internal clock is
   frozen at time 0 regardless of the playhead. Useful for a "poster" or a static
   badge variant of an animated symbol.  Default absent/false = no freeze (parity).

---

## 2. Data model

Both fields live on `SceneObject` (per-INSTANCE, not on `SymbolAsset`).

```ts
// src/engine/types.ts — added to SceneObject

/** Per-instance tint overlay (47f). When present, all of the instance's rendered
 *  content is tinted with `color` at the given `amount` (0..1). Absent = no tint
 *  (parity). Only meaningful when the object is a symbol instance. */
tint?: { color: string; amount: number };

/** When true, the instance's internal clock is forced to 0 (first frame) regardless
 *  of the parent playhead position or any symbolTime/symbolTimeTrack remap (47f).
 *  Absent/false = animate normally (parity). Only meaningful for symbol instances. */
freezeFirstFrame?: boolean;
```

Serialisation: both use optional fields → `JSON.stringify` omits them when absent →
existing `.savig` files load byte-identically.

---

## 3. FIRST-FRAME: compute path

`flattenInstances` in `src/engine/symbol.ts` computes `childTime` for each instance.
The freeze check is inserted **after** all existing remap logic — it wins over
`symbolTimeTrack` and `symbolTime`:

```
childTime =
  o.freezeFirstFrame
    ? 0                           // ← new: freeze wins over everything
    : (symbolTimeTrack remap) OR (symbolTime remap) OR localTime;
```

`frame.ts` (bundled as `src/runtime/runtimeSource.generated.ts`) imports
`flattenInstances` from the engine, so **`pnpm build:runtime` must be run** after
this change to regenerate the bundle.

---

## 4. TINT: render approach

### Why `feColorMatrix`-based SVG filter

A tint overlay that works in *both* the editor SVG canvas and the exported SVG must
be a pure SVG construct. Options:

| Approach | Works in SVG export? | Notes |
|----------|----------------------|-------|
| CSS `mix-blend-mode: multiply` | No (CSS, not SVG 1.1) | Editor-only |
| Transparent rect on top | Yes | Covers `<use>` children; works but clutters DOM |
| `feFlood` + `feBlend` SVG filter | Yes | Clean, encapsulated in `<filter>` def |

**Chosen: `feFlood` + `feBlend(mode=multiply)` filter per instance.**

SVG filter:
```xml
<filter id="savig-tint-RENDERID" x="0%" y="0%" width="100%" height="100%"
        color-interpolation-filters="sRGB">
  <feFlood flood-color="COLOR" flood-opacity="AMOUNT" result="flood"/>
  <feComposite in="flood" in2="SourceGraphic" operator="in" result="tintLayer"/>
  <feBlend in="SourceGraphic" in2="tintLayer" mode="multiply"/>
</filter>
```

This:
1. Floods the filter region with the tint color at `amount` opacity.
2. Composites the flood with `SourceGraphic` (alpha-mask: keeps the tint shaped to
   the content silhouette).
3. Blends the tinted layer back over the source via `multiply`.

The result: the instance's content is "multiply-tinted" by `color` with strength
`amount`. At amount=0 → identity (no filter ref emitted → parity). At amount=1 →
full multiply tint.

### Threading tint through flattenInstances

The tint is a **render-layer concern** (color overlay on the instance's composed
group), NOT a per-leaf property. It is consumed by the two render layers:
- `renderSvgDocument` (export)
- `Stage.tsx` (editor)

**Design decision: thread `tint` through `InstanceLeaf`** so both render layers see
it without parsing the parent object chain themselves.

```ts
// Added to InstanceLeaf (src/engine/symbol.ts)
tint?: { color: string; amount: number };
```

All leaves belonging to the same instance share the same `tint` value (identical, set
from the instance `SceneObject`). The render layers wrap the instance's leaves in a
`<g filter="url(#savig-tint-CLIPID_or_INSTID)">` (or equivalent).

Actually, a cleaner model: the tint is a **group-level filter** applied to the wrapper
`<g>` that already groups clip-path runs. If there is no clip, we emit a new `<g
filter="...">` wrapper around the instance's leaves. If there is a clip, the clip
wrapper gets the filter attribute too.

Because a tint could theoretically combine with a clip, the render layers must handle
both independently. The approach for v1:

- Tint wraps the **entire instance's leaf run** in a `<g filter="url(#savig-tint-INSTID)">`.
- Clip wraps identically in a `<g clip-path="url(#CLIPID)">`.
- When both apply: the clip wrapper is innermost (already grouping leaves), the tint
  wrapper is outermost. This keeps the filter's `SourceGraphic` = the clipped result.

To know a leaf belongs to a tinted instance, `InstanceLeaf` carries:
```ts
tintId?: string;          // unique id for the filter: "tint-" + instance renderId path
tintColor?: string;       // flood-color
tintAmount?: number;      // flood-opacity (0..1)
```

When amount is 0 or absent, no tint fields are emitted → parity.

**`frame.ts` is NOT affected by tint** (the runtime animates per-object transforms and
geometry, not instance-level filters). The filter is baked into the static export
markup; the runtime does not touch it. Therefore `pnpm build:runtime` is only needed
for the freeze change, not tint.

### Why not per-leaf filter?

Applying the filter per leaf (each individual `<rect>`, `<path>`, `<use>`) would tint
each shape independently and they'd mix additively when they overlap inside a symbol.
We want a single multiply over the entire composited group → group-level filter is
the right semantics.

---

## 5. Runtime bundle

`src/runtime/runtimeSource.generated.ts` is regenerated via `pnpm build:runtime`,
which bundles `frame.ts` (and transitively `symbol.ts`). The freeze change touches
`symbol.ts` → bundle must be regenerated. The tint change touches only `symbol.ts`
(InstanceLeaf) → also in the bundle, so run `build:runtime` after all engine changes.

---

## 6. UI: Inspector controls

In `Inspector.tsx`, inside the `{isSymbolInstance(obj, assets) && (...)}` block,
after the existing timing controls, add:

```
[instance visual overrides section]
  freeze first frame  [checkbox]
  tint color          [color input]  (enabled when tint not absent)
  tint amount         [number 0..1]  (enabled when tint not absent)
```

The tint color input enables/disables the tint in one step: when a color is entered
(or the checkbox is toggled on), tint is activated at color+amount. A dedicated
"tint on/off" toggle with a color picker below gives a clean UX.

Store actions added:
- `setInstanceFreeze(freeze: boolean): void` — sets/clears `freezeFirstFrame` on
  the selected symbol instance.
- `setInstanceTint(tint: { color: string; amount: number } | undefined): void` —
  sets/clears `tint` on the selected symbol instance.

---

## 7. Export and editor render

### Export (`renderSvgDocument`)

After the existing clip-path grouping loop, wrap tinted-instance runs additionally
with `<g filter="url(#savig-tint-INSTID)">`. The filter def is emitted into `<defs>`.

A `tintId` leaf field (from `flattenInstances`) identifies the run boundaries (same
as `clipId`). Since leaves are contiguous per instance, the existing `while (i < leaves.length && ...)` loop pattern works for both clip and tint runs simultaneously.

Algorithm in `renderSvgDocument`:
1. Identify if the current run has a `tintId`.
2. If so, build the filter def (`feFlood` + `feComposite` + `feBlend`) keyed by
   `tintId`, add to `tintFilterDefs[]`.
3. Wrap the (already clip-wrapped if needed) inner HTML in `<g filter="url(#TINTID)">`.
4. Emit tint filter defs alongside clip-path defs in `<defs>`.

### Editor Stage (`Stage.tsx`)

Analogous: after wrapping clip runs, if the run has a `tintId`, wrap in a React
`<g filter="url(#savig-tint-INSTID)">` with an inline `<defs>` containing the SVG
filter. Alternatively, emit the filter element into a top-level `<defs>` already
present in the Stage SVG. The Stage SVG already has a `<defs>` for clip paths (47e);
we can add tint filters to the same `<defs>` block.

---

## 8. Test plan

### Unit tests (`src/engine/symbol.test.ts`)
- `freezeFirstFrame: true` → leaf `localTime === 0` regardless of parent time.
- `freezeFirstFrame: true` with `symbolTime`/`symbolTimeTrack` set → freeze still wins.
- Absent `freezeFirstFrame` → `localTime` animates normally (parity).
- `tint` on instance → all leaves carry `tintId`, `tintColor`, `tintAmount`.
- No tint on instance → no `tintId` on leaves (parity).

### Export tests (`src/services/export/renderDocument.test.ts`)
- Tinted instance → export contains `<filter id="savig-tint-…">` with `feFlood`+`feComposite`+`feBlend`.
- Tinted instance → export contains `<g filter="url(#savig-tint-…)">` wrapping the instance's leaves.
- No tint → no filter in export (parity).
- Frozen instance → all leaves have `localTime = 0`; content matches the non-frozen same instance at t=0.

### Stage RTL test (under `src/ui/**` for jsdom)
- Render a frozen instance; verify the rendered output does not change between time=0 and time=5.
- Render a tinted instance; verify the `<g filter>` wrapper exists in the DOM.

### E2E (`e2e/symbols.spec.ts` or a new `per-instance-overrides.spec.ts`)
- Select a symbol instance → Inspector shows "freeze first frame" checkbox and tint controls.
- Toggle freeze → instance UI updates; parity at t=0.
- Enter a tint color and amount → the Stage SVG contains the filter wrapper.

---

## 9. Parity guarantees

| Scenario | Guarantee |
|----------|-----------|
| No `freezeFirstFrame`, no `tint` on any instance | `flattenInstances` output byte-identical to today |
| Non-instance objects | Completely unaffected (the new fields are only consulted inside the symbol-instance branch) |
| `freezeFirstFrame: false` or explicitly `undefined` | Same as absent (the freeze branch is `o.freezeFirstFrame === true`) |
| `tint` with `amount: 0` | No filter emitted → parity (special-cased in emission) |

---

## 10. Deferrals (v1 scope)

| Deferred | Why |
|----------|-----|
| Animated tint (tint color/amount as keyframe tracks) | Needs color/scalar track machinery; v1 static tint covers the main use-case (swap a badge color) |
| Tint blend mode selector (hard light, screen, etc.) | v1 multiply only |
| Tint in the export runtime's per-frame animation | The filter is static (color doesn't change per frame in v1); the runtime ignores it correctly |
| Same-path/grouped nested-tint composition | Nested tinted instances: the inner tint and outer tint stack via SVG filter chain; the visuals may be unexpected, but the v1 behavior is explicit and not broken |
| SVG-asset object tint | Those leaves use `<use>`, which composes into the filter; should work, but the edge-case of a `<use>` referencing a `<symbol>` with internal `opacity` needs verification — deferred |
