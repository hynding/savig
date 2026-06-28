# Implementation plan — Per-instance overrides: TINT + FIRST-FRAME (slice 47f)

**Spec:** `specs/2026-06-28-savig-m4-per-instance-overrides-design.md`
**Branch:** `slice-per-instance-overrides`
**TDD:** failing tests → implementation → green → review → merge.

---

## Tasks

### T1 — Types: add fields to `SceneObject` and `InstanceLeaf`

**Files:** `src/engine/types.ts`, `src/engine/symbol.ts`

- [ ] Add `tint?: { color: string; amount: number }` to `SceneObject`.
- [ ] Add `freezeFirstFrame?: boolean` to `SceneObject`.
- [ ] Add `tintId?: string`, `tintColor?: string`, `tintAmount?: number` to
  `InstanceLeaf`.

---

### T2 — Engine: failing unit tests for FIRST-FRAME and TINT

**File:** `src/engine/symbol.test.ts`

- [ ] Test: `freezeFirstFrame: true` → all leaves have `localTime === 0` at `time=5`.
- [ ] Test: freeze wins over `symbolTime`/`symbolTimeTrack`.
- [ ] Test: absent `freezeFirstFrame` → `localTime` animates (parity).
- [ ] Test: instance with `tint` → leaves carry `tintId`, `tintColor`, `tintAmount`.
- [ ] Test: no tint on instance → no tint fields on leaves (parity).

---

### T3 — Engine: implement freeze and tint in `flattenInstances`

**File:** `src/engine/symbol.ts`

- [ ] In the `childTime` computation, add `o.freezeFirstFrame ? 0 :` guard at the
  top (before the track/symbolTime branches).
- [ ] After computing `nextClipCtx`, compute the `tintCtx` for the walk:
  - If `o.tint && o.tint.amount > 0`, compute `tintId = "tint-" + renderId`,
    `tintColor = o.tint.color`, `tintAmount = o.tint.amount`.
  - Pass `tintCtx` to the recursive `walk`.
- [ ] In the leaf push (the `else` branch), spread `tintCtx` fields onto the leaf
  (analogous to `clipCtx`).
- [ ] Run tests: `pnpm vitest run src/engine/symbol.test.ts` — T2 tests green.

---

### T4 — Runtime bundle: regenerate

- [ ] `pnpm build:runtime` — regenerates `src/runtime/runtimeSource.generated.ts`.
- [ ] Verify `pnpm vitest run src/runtime/` passes.

---

### T5 — Export: failing render tests

**File:** `src/services/export/renderDocument.test.ts`

- [ ] Test: tinted instance → `<filter id="savig-tint-…">` in output `<defs>`.
- [ ] Test: tinted instance → `<g filter="url(#savig-tint-…)">` in body.
- [ ] Test: no tint → no filter (parity).
- [ ] Test: frozen instance → `flattenInstances` at t=5 gives same static output as
  at t=0.

---

### T6 — Export: implement tint filter in `renderSvgDocument`

**File:** `src/services/export/renderDocument.ts`

- [ ] Collect `tintId` leaf fields (analogous to `clipId`); build filter defs and
  emit them into `<defs>`.
- [ ] In the body-building loop, detect tinted runs (by `tintId`) and wrap them in
  `<g filter="url(#…)">`.
- [ ] Handle the case where a run is both clipped AND tinted: the clip wrapper is
  the immediate parent of the leaves, the tint wrapper wraps the clip wrapper.
- [ ] Run render tests — T5 green.

---

### T7 — Store: add actions

**File:** `src/ui/store/store.ts`

- [ ] Add `setInstanceFreeze(freeze: boolean): void` to the store interface.
- [ ] Add `setInstanceTint(tint: { color: string; amount: number } | undefined): void` to the interface.
- [ ] Implement `setInstanceFreeze`: find selected object, set/clear `freezeFirstFrame`
  via `commitActiveScene`/`replaceObjectInScene`. Clear when `false`.
- [ ] Implement `setInstanceTint`: set/clear `tint`; clear when `undefined`.

---

### T8 — Inspector UI

**File:** `src/ui/components/Inspector/Inspector.tsx`

- [ ] Destructure `setInstanceFreeze` and `setInstanceTint` from `useEditor(...)`.
- [ ] Inside the `{isSymbolInstance(obj, assets) && (...)}` block, after the symbol
  timing section, add:
  ```
  <div className={styles.group}>Instance overrides</div>
  <div className={styles.row}>
    <label>freeze first frame</label>
    <input type="checkbox" data-testid="instance-freeze" checked={obj.freezeFirstFrame ?? false}
           onChange={e => setInstanceFreeze(e.target.checked)} />
  </div>
  <div className={styles.row}>
    <label>tint</label>
    <input type="checkbox" data-testid="instance-tint-enable"
           checked={!!obj.tint}
           onChange={e => setInstanceTint(e.target.checked ? {color: obj.tint?.color ?? '#ff0000', amount: obj.tint?.amount ?? 0.5} : undefined)} />
    <input type="color" data-testid="instance-tint-color"
           value={obj.tint?.color ?? '#ff0000'}
           disabled={!obj.tint}
           onChange={e => obj.tint && setInstanceTint({...obj.tint, color: e.target.value})} />
    <NumberField label="tint amount" value={obj.tint?.amount ?? 0.5} step={0.05}
                 disabled={!obj.tint}
                 onCommit={n => obj.tint && setInstanceTint({...obj.tint, amount: Math.max(0, Math.min(1, n))})} />
  </div>
  ```

---

### T9 — Stage: tint filter in editor

**File:** `src/ui/components/Stage/Stage.tsx`

- [ ] In the leaves loop, group tinted runs (by `tintId`, same pattern as `clipId`).
- [ ] Emit an SVG filter element (inline `<defs>`) into the Stage SVG for each unique
  `tintId`.
- [ ] Wrap tinted runs in `<g filter="url(#tintId)">`.
- [ ] Handle clip+tint: tint wraps clip (outer tint, inner clip).

---

### T10 — Stage RTL test (jsdom)

**File:** `src/ui/App.test.tsx` or new `src/ui/components/Stage/Stage.test.tsx`

- [ ] Test: frozen instance rendered at t=5 has same leaf transforms as at t=0
  (compare rendered DOM or `flattenInstances` output).
- [ ] Test: tinted instance → DOM contains `<g filter>` wrapper.

---

### T11 — E2E

**File:** `e2e/per-instance-overrides.spec.ts` (new)

- [ ] Open app, place a symbol instance, open Inspector.
- [ ] Toggle "freeze first frame" → verify checkbox state persists.
- [ ] Enable tint, set color → verify stage shows a `filter` attribute.

---

### T12 — Final verification

- [ ] `pnpm vitest run` — all unit tests green.
- [ ] `pnpm tsc --noEmit` — no type errors.
- [ ] `pnpm eslint src/engine/symbol.ts src/engine/types.ts src/services/export/renderDocument.ts src/ui/store/store.ts src/ui/components/Inspector/Inspector.tsx src/ui/components/Stage/Stage.tsx`
- [ ] `pkill -f vite; pnpm exec playwright test e2e/per-instance-overrides.spec.ts`
- [ ] Dispatch reviewer subagent; resolve Critical/Important findings.
- [ ] `git merge --no-ff slice-per-instance-overrides` from main.
- [ ] Update `docs/superpowers/INDEX.md` merge table.
