# Savig M4 — Symbol Duration Manual Override (47c follow-up)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — a 47c per-instance-timing follow-up. Makes the reserved `SymbolAsset.duration`
field a real manual override of a symbol's effective loop/clip length.

---

## 1. Motivation

A symbol instance's internal clock is remapped by `remapLocalTime(parentTime, timing, symbolDuration)`
(47c). Today `symbolDuration` is always the symbol's INTRINSIC length, `objectsMaxKeyframeTime(asset.
objects)` — the `SymbolAsset.duration` field is explicitly *"NOT read by the remap; reserved for a
future manual-override mechanism."* Two consequences:
- A symbol with no keyframes (e.g. one whose only content is a keyframe-less nested instance) has
  intrinsic duration 0, so `remapLocalTime` collapses to 0 (static) — it cannot loop (the documented 47c
  0-duration edge).
- You cannot set an explicit loop/clip length independent of the keyframes (e.g. loop a 1s animation over
  a 2s cycle, or cut it to 0.5s).

This slice makes `SymbolAsset.duration` a manual override: `0` = auto (intrinsic, today's behaviour);
`> 0` = the symbol's effective duration.

## 2. Architecture

### 2.1 Engine — `symbolEffectiveDuration` (the single seam)

New helper in `src/engine/symbol.ts`:

```ts
/** A symbol's effective timeline length: the manual `duration` override when set (> 0), else the
 *  intrinsic length derived from its objects' keyframes. (47c manual-override) */
export function symbolEffectiveDuration(asset: SymbolAsset): number {
  return asset.duration > 0 ? asset.duration : objectsMaxKeyframeTime(asset.objects);
}
```

The ONE call site in `flattenInstances` changes from:

```ts
remapLocalTime(localTime, o.symbolTime, objectsMaxKeyframeTime(asset.objects))
```
to:
```ts
remapLocalTime(localTime, o.symbolTime, symbolEffectiveDuration(asset))
```

The `SymbolAsset.duration` field comment is updated (it is now READ by the remap).

### 2.2 Store — `setSymbolDuration(symId, duration)`

```ts
setSymbolDuration(symId, duration) {
  const s = get();
  const project = s.history.present;
  const sym = project.assets.find((a) => a.id === symId);
  if (!sym || sym.kind !== 'symbol') return;
  const d = Math.max(0, duration); // 0 = auto/intrinsic; negative clamps to 0
  if (sym.duration === d) return; // no-op -> no spurious commit
  get().commit({ ...project, assets: project.assets.map((a) => (a.id === symId ? { ...a, duration: d } : a)) });
}
```

Edits the symbol asset directly by id (a symbol is global), so it works from an instance selection. One
whole-project commit → undoable.

### 2.3 Inspector — duration field in the "Symbol timing" panel

The per-instance "Symbol timing" panel (shown when the selected object `isSymbolInstance`) gains a
"symbol duration (0 = auto)" `NumberField` below speed:

```tsx
<div className={styles.row}>
  <label htmlFor="insp-symbol-duration">symbol duration</label>
  <NumberField
    label="symbol duration"
    value={round((assets.find((a) => a.id === obj.assetId) as SymbolAsset | undefined)?.duration ?? 0)}
    step={0.1}
    onCommit={(n) => setSymbolDuration(obj.assetId, n)}
  />
</div>
```

It edits the SYMBOL's duration (a definition property → affects every instance of that symbol); the
label/title communicates this. `0` shows when on auto.

## 3. Parity, undo, regression-safety

- **Parity (preview == export) is preserved by construction:** the override is read ONLY through
  `symbolEffectiveDuration`, called inside the shared `flattenInstances` — so the export
  (`renderSvgDocument → flattenInstances`) and the runtime/preview (`computeFrame → flattenInstances`)
  use the identical effective duration. A parity test covers a manual-duration looping instance.
- **Regression-safe:** every existing symbol has `duration: 0` (createSymbol/createSymbolAsset default),
  so `symbolEffectiveDuration` returns the intrinsic — byte-identical to today. Only a user-set
  `duration > 0` changes anything.
- **Undo** restores the prior duration (one whole-project commit).
- **This is an intentional render-behaviour change** (the first since the in-symbol routing arc) — it
  changes how a manual-duration instance animates; that is the feature, and it does not break the
  preview==export invariant.

## 4. Scope (this slice) vs deferred

**In:** `symbolEffectiveDuration` + the `flattenInstances` seam change; `setSymbolDuration`; the Inspector
duration field; tests (engine + store + RTL + e2e).

**Deferred (other 47c follow-ups):** loop modes (ping-pong / play-count-N / random-start) on
`SceneObject.symbolTime` (extend `remapLocalTime`); keyframing the `symbolTime` fields; accounting for a
symbol instance's effective duration in `computeProjectDuration` (the project timeline length).

## 5. Risks / tradeoffs

- **Render-path change:** carefully scoped to one helper read inside the shared walker; parity preserved
  and regression-safe (duration-0 symbols unchanged). A parity test pins it.
- **Per-symbol vs per-instance:** the duration is a SYMBOL property (all instances share it), shown in
  the per-instance panel for discoverability; the label states it affects the symbol. (Per-instance loop
  length, if ever wanted, is a separate `symbolTime` field — deferred.)
- **`duration > 0` semantics:** a manual duration shorter than the intrinsic cuts the loop; longer pads
  it (the animation plays then holds before the cycle repeats) — standard clip-length behaviour.

## 6. Testing strategy

- `src/engine/symbol.test.ts` (or `duration.test.ts`):
  - `symbolEffectiveDuration` returns the manual `duration` when `> 0`, else `objectsMaxKeyframeTime`.
  - `flattenInstances` on a 0-intrinsic symbol (no keyframes) with a manual `duration > 0` and a LOOPING
    instance → the instance leaf's `localTime` is the looped remap (NON-zero past the start), not the
    collapsed 0.
- `src/services/export/renderDocument.test.ts`: a manual-duration looping instance — `computeFrame` at a
  time T equals the exported body's transform (export == preview parity).
- `store.test.ts`: `setSymbolDuration(symId, 2)` sets the asset's `duration`; a negative clamps to 0; an
  unchanged value is a no-op; undoable.
- RTL (`Inspector.test.tsx`): selecting a symbol instance shows a "symbol duration" field; committing it
  calls `setSymbolDuration` (the asset's `duration` updates).
- e2e (`symbols.spec.ts`): create a symbol + instance, open the Symbol timing panel, set the symbol
  duration field → the field reflects the value (the override persists).
