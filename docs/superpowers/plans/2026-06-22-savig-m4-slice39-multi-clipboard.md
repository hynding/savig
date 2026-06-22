# Slice 39 — M4 Multi-object copy / cut / paste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** copy/cut/paste act on the whole multi-selection (matching the bulk delete/duplicate), and `cut` drops its slice-36 collapse-to-primary.

**Architecture:** `clipboard` → a `{ object, asset }[]` list; `copySelected`/`cut`/`paste` become bulk. Editor-only (transient clipboard).

**Tech Stack:** Zustand, React + RTL, Playwright.

## Global Constraints

- Editor-only: NO engine/export/runtime/persistence change (v4).
- Single-object behavior must be preserved (copy 1 → paste 1; locked clone not selected; frozen snapshot).
- `clipboard` is `null` or a NON-empty list (never `[]`).
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: List-shaped clipboard + bulk copy/cut/paste

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

- [ ] **Step 1: Update the existing clipboard tests to the list shape** — in the `clipboard (copy/cut/paste)` describe block, change every `clipboard?.object.id` to `clipboard?.[0].object.id` (4 occurrences: lines ~1410, ~1453, ~1462; plus any other). Then ADD the new multi tests at the end of the block:

```ts
it('copySelected snapshots ALL selected; paste adds offset copies of all (one commit)', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().copySelected();
  expect(useEditor.getState().clipboard).toHaveLength(2);
  const past = useEditor.getState().history.past.length;
  useEditor.getState().paste();
  expect(useEditor.getState().history.present.objects).toHaveLength(4);
  expect(useEditor.getState().selectedObjectIds).toHaveLength(2); // the two clones
  expect(useEditor.getState().selectedObjectIds).not.toContain(a);
  expect(useEditor.getState().selectedObjectIds).not.toContain(b);
  expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit
});

it('cut removes ALL selected and the clipboard holds them; paste restores them', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().cut();
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
  expect(useEditor.getState().clipboard).toHaveLength(2);
  useEditor.getState().paste();
  expect(useEditor.getState().history.present.objects).toHaveLength(2);
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm vitest run src/ui/store/store.test.ts` → the updated `[0]` reads fail (clipboard is still single → `[0]` is undefined) and the new multi tests fail.

- [ ] **Step 3: Implement** —
  - Change the interface field (near line 119): `clipboard: { object: SceneObject; asset?: Asset }[] | null;`
  - Change the initial value (near line 334): `clipboard: null as { object: SceneObject; asset?: Asset }[] | null,`
  - Rewrite `copySelected`:
    ```ts
    copySelected() {
      const s = get();
      const project = s.history.present;
      const entries = s.selectedObjectIds
        .map((id) => project.objects.find((o) => o.id === id))
        .filter((o): o is SceneObject => !!o)
        .sort((x, y) => x.zOrder - y.zOrder)
        .map((obj) => ({ object: obj, asset: project.assets.find((a) => a.id === obj.assetId) }));
      if (entries.length === 0) return; // nothing selected -> leave the clipboard
      set({ clipboard: entries, keyframeClipboard: null }); // immutable snapshots; clears the keyframe clipboard
    },
    ```
  - Rewrite `cut` (drop the collapse):
    ```ts
    cut() {
      get().copySelected();
      get().deleteSelectedObject(); // both bulk; cutting a locked member copies but does not remove it
    },
    ```
  - Rewrite `paste`:
    ```ts
    paste() {
      const clip = get().clipboard;
      if (!clip || clip.length === 0) return;
      let project = get().history.present;
      const selectIds: string[] = [];
      for (const entry of clip) {
        const { object, clonedAsset } = duplicateObject(entry.object, entry.asset, { objectId: newId(), assetId: newId() }, DUP_OFFSET);
        const placed = { ...object, zOrder: nextZOrder(project.objects) };
        let assets = project.assets;
        if (clonedAsset) assets = [...assets, clonedAsset];
        else if (entry.asset && !assets.some((a) => a.id === placed.assetId)) assets = [...assets, entry.asset];
        project = { ...project, assets, objects: [...project.objects, placed] };
        if (!placed.locked) selectIds.push(placed.id); // don't select a locked clone (Slice-19)
      }
      get().commit(project);
      get().selectObjects(selectIds);
    },
    ```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run src/ui/store/store.test.ts` → PASS (updated single tests + new multi tests).

- [ ] **Step 5: Commit**
```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice39): list-shaped clipboard + bulk copy/cut/paste"
```

---

### Task 2: e2e + full gate

- [ ] **Step 1: e2e** — `e2e/multi-clipboard.spec.ts`: draw two rects; Shift-click both selected; `ControlOrMeta+KeyC`; `ControlOrMeta+KeyV`; assert `[data-savig-object]` count is 4 and exactly two `selection-outline-*` elements (the clones) are shown. (Model setup on `e2e/multi-select.spec.ts`.)

- [ ] **Step 2: Run e2e** — `pnpm exec playwright test e2e/multi-clipboard.spec.ts` → PASS.

- [ ] **Step 3: Full gate + commit**
```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add -A
git commit -m "test(slice39): multi-object copy/paste e2e (Cmd+C/Cmd+V two rects -> 4)"
```

---

## Self-Review (post-write)

- **Spec coverage:** §2 model → T1; §5 e2e → T2.
- **Type consistency:** `clipboard` list type in the interface + initial + the 3 actions; `selectObjects` for the clones.
- **No placeholders:** T1 has the full store code + test updates; the multi tests assert count 4 / clipboard length 2 / clones selected / one commit.
- **Single-object preserved:** copy 1 → list of 1 → paste 1 (selected); cut 1 → delete + clipboard[0]; locked clone not selected; the `[0]`-updated existing tests cover these.
- **Truthiness:** `copySelected` never stores `[]`; `paste` guards `length === 0`.
