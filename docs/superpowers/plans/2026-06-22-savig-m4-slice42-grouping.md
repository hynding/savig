# Savig M4 Slice 42 — Grouping (selection-grouping) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` tracking.

**Goal:** Group selected objects so they select/move/scale/rotate/copy/delete together; Ungroup dissolves it.

**Architecture:** A group is a set of `SceneObject`s sharing a fresh `groupId`. Selecting any member expands the selection to the whole group, so every group operation reuses the slice-36–41 multi-object machinery. No engine/export/runtime change; objects render flat. `groupId` is an additive optional field → no persistence migration.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TS strict; no new deps. CSS Modules + tokens for any UI.
- Single undo step per group/ungroup (one `get().commit`).
- The primary/anchor invariant holds: every selection writer sets `selectedObjectIds` AND `selectedObjectId === selectedObjectIds.at(-1) ?? null` (use existing `selectObjects`).
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Data field + clone clears groupId

**Files:**
- Modify: `src/engine/types.ts` (SceneObject)
- Modify: `src/engine/duplicate.ts`
- Test: `src/engine/duplicate.test.ts`

**Interfaces:**
- Produces: `SceneObject.groupId?: string`.

- [ ] **Step 1: Add the field.** In `src/engine/types.ts`, under the reserved `parentId?: string;` line, add:
```ts
  /** Selection-group membership (slice 42). Objects sharing a groupId select/transform
   *  as a unit. Distinct from the reserved `parentId` (future nested parenting). */
  groupId?: string;
```

- [ ] **Step 2: Failing test** — append to `src/engine/duplicate.test.ts`:
```ts
it('drops groupId on the clone (clones are ungrouped)', () => {
  const obj = { ...baseObject(), id: 'a', groupId: 'g1' };
  const { object } = duplicateObject(obj, undefined, { objectId: 'b', assetId: 'b2' }, 10);
  expect(object.groupId).toBeUndefined();
});
```
(Reuse the file's existing object factory; if it is named differently than `baseObject`, match the existing helper — grep the test file.)

- [ ] **Step 3: Run** `pnpm vitest run src/engine/duplicate.test.ts` → FAIL (clone keeps `groupId`).

- [ ] **Step 4: Implement.** In `src/engine/duplicate.ts`, immediately after `const object = clone(obj);` add:
```ts
  delete object.groupId; // clones are ungrouped — avoids merging a pasted group with its source
```

- [ ] **Step 5: Run** the test → PASS. Then `pnpm typecheck`.

- [ ] **Step 6: Commit** `feat(slice42): groupId field; clone clears it`.

---

### Task 2: Store — group helpers, group/ungroup, selection-expansion

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces (store actions):
  - `groupSelected(): void` — assign a fresh `groupId` to all selected non-locked objects; no-op for < 2; one commit.
  - `ungroupSelected(): void` — clear `groupId` from EVERY object sharing a groupId with any selected object; one commit.
  - `selectObjectOrGroup(id: string): void` — select all of id's group.
  - `toggleObjectOrGroup(id: string): void` — add/remove id's whole group from the selection.
  - `selectObjectsExpandingGroups(ids: string[]): void` — expand each id to its group, then select.
- Consumes: existing `selectObjects`, `newId`, `get().commit`, `SceneObject`.

- [ ] **Step 1: Failing tests** — add to `src/ui/store/store.test.ts` (use the file's existing helpers to add objects and read state). Cover:
```ts
it('groupSelected assigns one shared fresh groupId (>=2; <2 is a no-op)', () => {
  const s = useEditor.getState();
  // ...add objects a,b,c; select [a,b]
  s.selectObjects(['a', 'b']);
  s.groupSelected();
  const objs = useEditor.getState().history.present.objects;
  const ga = objs.find((o) => o.id === 'a')!.groupId;
  const gb = objs.find((o) => o.id === 'b')!.groupId;
  expect(ga).toBeTruthy();
  expect(gb).toBe(ga);
  expect(objs.find((o) => o.id === 'c')!.groupId).toBeUndefined();
  // <2 no-op:
  useEditor.getState().selectObjects(['c']);
  useEditor.getState().groupSelected();
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'c')!.groupId).toBeUndefined();
});

it('selectObjectOrGroup selects all group members from any one', () => {
  const s = useEditor.getState();
  s.selectObjects(['a', 'b']); s.groupSelected();
  s.selectObject('c'); // outside the group
  s.selectObjectOrGroup('a');
  expect([...useEditor.getState().selectedObjectIds].sort()).toEqual(['a', 'b']);
});

it('toggleObjectOrGroup adds then removes the whole group', () => {
  const s = useEditor.getState();
  s.selectObjects(['a', 'b']); s.groupSelected();
  s.selectObject('c');
  s.toggleObjectOrGroup('a'); // add group
  expect([...useEditor.getState().selectedObjectIds].sort()).toEqual(['a', 'b', 'c']);
  s.toggleObjectOrGroup('b'); // remove the whole group
  expect(useEditor.getState().selectedObjectIds).toEqual(['c']);
});

it('ungroupSelected clears groupId across the whole touched group', () => {
  const s = useEditor.getState();
  s.selectObjects(['a', 'b']); s.groupSelected();
  s.selectObject('a'); // only one member selected
  s.ungroupSelected();
  const objs = useEditor.getState().history.present.objects;
  expect(objs.find((o) => o.id === 'a')!.groupId).toBeUndefined();
  expect(objs.find((o) => o.id === 'b')!.groupId).toBeUndefined();
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/ui/store/store.test.ts` → FAIL (actions undefined).

- [ ] **Step 3: Declare the actions** in the store interface (near `selectObjects(ids: string[]): void;`, ~line 212):
```ts
  groupSelected(): void;
  ungroupSelected(): void;
  selectObjectOrGroup(id: string): void;
  toggleObjectOrGroup(id: string): void;
  selectObjectsExpandingGroups(ids: string[]): void;
```

- [ ] **Step 4: Add the pure helpers** at module scope in `store.ts` (near `clearStaleSelection`):
```ts
/** All ids sharing `id`'s non-null groupId (incl. id); just [id] when ungrouped. */
function groupMatesOf(objects: SceneObject[], id: string): string[] {
  const obj = objects.find((o) => o.id === id);
  if (!obj || !obj.groupId) return [id];
  return objects.filter((o) => o.groupId === obj.groupId).map((o) => o.id);
}
/** Unique union of each id expanded to its group (order-stable). */
function expandToGroups(objects: SceneObject[], ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) for (const m of groupMatesOf(objects, id)) if (!out.includes(m)) out.push(m);
  return out;
}
```

- [ ] **Step 5: Implement the actions** (place beside `selectObjects`, ~line 1109):
```ts
  groupSelected() {
    const s = get();
    const project = s.history.present;
    const targets = s.selectedObjectIds
      .map((id) => project.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !o.locked);
    if (targets.length < 2) return; // a group of <2 is meaningless
    const gid = newId();
    const ids = new Set(targets.map((o) => o.id));
    const objects = project.objects.map((o) => (ids.has(o.id) ? { ...o, groupId: gid } : o));
    get().commit({ ...project, objects });
  },
  ungroupSelected() {
    const s = get();
    const project = s.history.present;
    const gids = new Set<string>();
    for (const id of s.selectedObjectIds) {
      const obj = project.objects.find((o) => o.id === id);
      if (obj?.groupId) gids.add(obj.groupId);
    }
    if (gids.size === 0) return;
    const objects = project.objects.map((o) =>
      o.groupId && gids.has(o.groupId) ? { ...o, groupId: undefined } : o,
    );
    get().commit({ ...project, objects });
  },
  selectObjectOrGroup(id) {
    get().selectObjects(groupMatesOf(get().history.present.objects, id));
  },
  toggleObjectOrGroup(id) {
    const objects = get().history.present.objects;
    const mates = groupMatesOf(objects, id);
    const cur = get().selectedObjectIds;
    const next = mates.every((m) => cur.includes(m))
      ? cur.filter((x) => !mates.includes(x))
      : [...cur, ...mates.filter((m) => !cur.includes(m))];
    get().selectObjects(next);
  },
  selectObjectsExpandingGroups(ids) {
    get().selectObjects(expandToGroups(get().history.present.objects, ids));
  },
```
(Confirm `SceneObject` is imported in `store.ts`; it is used widely already.)

- [ ] **Step 6: Run** the store tests → PASS. Then `pnpm vitest run src/engine/duplicate.test.ts` (Task 1 still green).

- [ ] **Step 7: Commit** `feat(slice42): groupSelected/ungroupSelected + group-expanding selection`.

---

### Task 3: Keyboard — Cmd+G group, Cmd+Shift+G ungroup

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/hooks/useKeyboard.test.ts`

**Interfaces:**
- Consumes: `groupSelected`, `ungroupSelected` (Task 2).

- [ ] **Step 1: Failing test** — add to `src/ui/hooks/useKeyboard.test.ts` (match the file's existing dispatch helper for a keydown with metaKey):
```ts
it('Cmd+G groups, Cmd+Shift+G ungroups the selection', () => {
  // ...render the hook; add objects a,b; select [a,b]
  useEditor.getState().selectObjects(['a', 'b']);
  fireKey('g', { metaKey: true });
  const gid = useEditor.getState().history.present.objects.find((o) => o.id === 'a')!.groupId;
  expect(gid).toBeTruthy();
  fireKey('g', { metaKey: true, shiftKey: true });
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'a')!.groupId).toBeUndefined();
});
```
(Use the existing key-dispatch helper in the file rather than `fireKey` if it differs.)

- [ ] **Step 2: Run** `pnpm vitest run src/ui/hooks/useKeyboard.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In `useKeyboard.ts`, after the Cmd+D block (`s.duplicateSelected()`), add:
```ts
      if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelected();
        else s.groupSelected();
        return;
      }
```
(`mod` already excludes the single-key `g` polygon-tool shortcut in the switch below.)

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit** `feat(slice42): Cmd+G group / Cmd+Shift+G ungroup`.

---

### Task 4: Stage + Layers wiring — click selects the group; marquee expands

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Modify: `src/ui/components/LayersPanel/LayersPanel.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`, `src/ui/components/LayersPanel/LayersPanel.test.tsx`

**Interfaces:**
- Consumes: `selectObjectOrGroup`, `toggleObjectOrGroup`, `selectObjectsExpandingGroups` (Task 2).

- [ ] **Step 1: Failing test (Stage)** — add to `Stage.test.tsx`: group two objects, pointer-down ONE, assert BOTH appear in `selectedObjectIds`:
```ts
it('clicking one grouped object selects the whole group', () => {
  // ...render Stage; add objects a,b with assets; autoKey on
  useEditor.getState().selectObjects(['a', 'b']);
  useEditor.getState().groupSelected();
  useEditor.getState().selectObject(null);
  fireEvent.pointerDown(screen.getByTestId('stage-object-a')); // match the file's object-handle testid
  expect([...useEditor.getState().selectedObjectIds].sort()).toEqual(['a', 'b']);
});
```
(Use the actual object-element testid/selector the file already uses for `onObjectPointerDown`.)

- [ ] **Step 2: Failing test (Layers)** — add to `LayersPanel.test.tsx`: group a,b; click a's row; assert both selected. Use the existing row query pattern in that file.

- [ ] **Step 3: Run** both → FAIL (only the clicked one is selected).

- [ ] **Step 4: Stage wiring.** In `Stage.tsx` `onObjectPointerDown` (~line 645–653):
  - Shift/Cmd branch: replace `toggleObjectSelection(id)` with `useEditor.getState().toggleObjectOrGroup(id)`.
  - Plain branch: replace `if (!multi) selectObject(id);` with `if (!multi) useEditor.getState().selectObjectOrGroup(id);`
    Keep the `multi` computation as-is (dragging a member of a multi-selection still moves the set).

- [ ] **Step 5: Stage marquee.** In the marquee `onUp` (~line 1104–1108), expand hits to groups:
```ts
          if (mq.additive) {
            const cur = useEditor.getState().selectedObjectIds;
            useEditor.getState().selectObjectsExpandingGroups([...cur, ...hits]);
          } else {
            useEditor.getState().selectObjectsExpandingGroups(hits);
          }
```

- [ ] **Step 6: Layers wiring.** In `LayersPanel.tsx` row `onClick` (~line 56–57): destructure `selectObjectOrGroup, toggleObjectOrGroup` from the store hook (replace the `selectObject, toggleObjectSelection` usage at the row), then:
```tsx
              if (e.shiftKey || e.metaKey || e.ctrlKey) toggleObjectOrGroup(o.id);
              else selectObjectOrGroup(o.id);
```
(Leave other `selectObject`/`toggleObjectSelection` consumers elsewhere in the file untouched if any; only the layer-row click changes.)

- [ ] **Step 7: Run** both tests → PASS. Then run the FULL existing Stage + Layers suites to catch regressions:
`pnpm vitest run src/ui/components/Stage/Stage.test.tsx src/ui/components/LayersPanel/LayersPanel.test.tsx`.

- [ ] **Step 8: Commit** `feat(slice42): Stage/Layers click selects the group; marquee expands`.

---

### Task 5: Inspector — Group / Ungroup buttons

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `groupSelected`, `ungroupSelected` (Task 2).

- [ ] **Step 1: Failing test** — add to `Inspector.test.tsx`: with two objects selected, a "Group" button is present and clicking it assigns a shared groupId; after grouping (still multi-selected), an "Ungroup" button appears and clears it. Match the file's render + selection setup.
```ts
it('multi-state offers Group, then Ungroup', () => {
  // ...render Inspector; add a,b; select [a,b]
  useEditor.getState().selectObjects(['a', 'b']);
  fireEvent.click(screen.getByRole('button', { name: 'Group' }));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'a')!.groupId).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ungroup' }));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'a')!.groupId).toBeUndefined();
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx` → FAIL.

- [ ] **Step 3: Implement.** Add `groupSelected, ungroupSelected` to the `useEditor.getState()` destructure (~line 109). Add an objects selector near line 96: `const objects = useEditor((s) => s.history.present.objects);`. Replace the multi-state block (142–151) with:
```tsx
  if (selectedIds.length > 1) {
    const someGrouped = selectedIds.some((id) => objects.find((o) => o.id === id)?.groupId);
    return (
      <div className={styles.panel}>
        <div className={styles.row}>{selectedIds.length} objects selected</div>
        <div className={styles.row}>
          <button onClick={() => groupSelected()}>Group</button>
          {someGrouped && <button onClick={() => ungroupSelected()}>Ungroup</button>}
          <button onClick={() => duplicateSelected()}>Duplicate</button>
          <button onClick={() => deleteSelectedObject()}>Delete</button>
        </div>
      </div>
    );
  }
```

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit** `feat(slice42): Inspector Group/Ungroup buttons`.

---

### Task 6: Persistence round-trip

**Files:**
- Test: `src/services/persistence/savig.test.ts`

**Interfaces:**
- Consumes: `SceneObject.groupId` (Task 1).

- [ ] **Step 1: Test** — add to `savig.test.ts`: build a project with two objects sharing a `groupId`, serialize → deserialize, assert `groupId` survives and the format `version` is unchanged. Match the file's existing serialize/deserialize helper names and project factory.
```ts
it('round-trips object groupId without a version bump', () => {
  const project = makeProject(/* two objects, both groupId: 'g1' */);
  const restored = loadSavig(saveSavig(project)); // use this file's actual fn names
  expect(restored.objects.every((o) => o.groupId === 'g1')).toBe(true);
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/services/persistence/savig.test.ts` → PASS (additive field round-trips for free; this LOCKS it).

- [ ] **Step 3: Commit** `test(slice42): persistence round-trips groupId`.

---

### Task 7: e2e + full gate

**Files:**
- Create: `e2e/grouping.spec.ts`

- [ ] **Step 1: Write** `e2e/grouping.spec.ts` modeled on `e2e/multi-move.spec.ts`: draw two rects; select both (marquee or shift-click); press `Meta+g`; click ONE object → assert both `selection-outline-*` rects are present; drag it → assert both moved; press `Meta+Shift+g`; click one → assert only one outline. Use the repo's existing helpers for drawing rects, selecting, and reading transforms (copy the patterns from `multi-move.spec.ts` / `multi-scale.spec.ts`).

- [ ] **Step 2: Run** `pnpm exec playwright test e2e/grouping.spec.ts` → PASS. Debug stale-closure / testid mismatches against the existing specs if needed.

- [ ] **Step 3: Full gate** — `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test` → all green.

- [ ] **Step 4: Commit** `test(e2e): group two objects; click/drag the group; ungroup`.

---

## Self-Review (post-write)

- **Spec coverage:** groupId (T1) ✓; group/ungroup (T2,T3,T5) ✓; selection-expansion Stage+Layers+marquee (T4) ✓; clone clears groupId (T1) ✓; persistence (T6) ✓; e2e (T7) ✓.
- **Type consistency:** action names identical across interface decl (T2) and all callers (T3 keyboard, T4 Stage/Layers, T5 Inspector). `groupMatesOf`/`expandToGroups`/`groupId` spelled consistently.
- **No placeholders:** all steps carry real code; test scaffolds note "match the file's existing helpers" where a factory name must be confirmed at the file (legitimate — the helpers already exist).
- **Deferred (not in plan, per spec §5):** nested container/transform + nested export; double-click-to-enter; nested groups; regroup-on-paste; group row in Layers.
