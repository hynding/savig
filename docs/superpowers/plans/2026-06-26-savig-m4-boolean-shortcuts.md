# Boolean-Op Keyboard Shortcuts Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cmd/Ctrl+Shift+U/S/I/E trigger union/subtract/intersect/exclude.

**Architecture:** Four branches in `useKeyboard`'s `onKey` calling the self-gating `booleanOp(op)`.
No store/engine change.

**Tech Stack:** React 18 + TS strict, Vitest + RTL.

## Global Constraints
- preview == export parity (no engine/store change; booleanOp identical by button or key).
- TS strict.

---

### Task 1: Keyboard branches + tests

**Files:** Modify `src/ui/hooks/useKeyboard.ts`; Test `src/ui/hooks/useKeyboard.test.ts`.

- [ ] **Step 1: Failing test** — append to useKeyboard.test.ts, mirroring the existing Cmd+D test
(render a component using the hook, set up a multi-vector selection, fire the key, assert the result).
Check the existing test harness first (how it renders `useKeyboard` and seeds selection). A robust
assertion: with two overlapping vector rects selected, `Cmd+Shift+U` reduces the object count to one
merged path (booleanOp replaces operands with one result). Pattern:

```ts
it('Cmd+Shift+U unions the selected vector objects', () => {
  renderHook ... (as the file already does)
  // create 2 vector rects, select both
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 20, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const before = useEditor.getState().history.present.objects.length;
  fireEvent.keyDown(window, { key: 'u', metaKey: true, shiftKey: true });
  expect(useEditor.getState().history.present.objects.length).toBe(before - 1); // 2 operands -> 1 result
});
```

Add analogous (lighter) checks that S/I/E call the op — simplest: spy is overkill; assert the op ran
(object count changed for union/subtract/intersect; for a clean assertion just cover union fully and
add one that `Cmd+Shift+S` also collapses the two into a result, OR assert no-throw + selection
changed). Also: a regression test that a plain `s` (no modifier) still sets the star tool
(`expect(activeTool).toBe('star')`).

NOTE before running: confirm the test file's render/setup harness (it tests Cmd+D/Cmd+] already —
copy that exact setup, incl. how it mounts the hook and resets state in beforeEach). Confirm
`addVectorShape` + `selectObjects` are the right factory/selection calls (used elsewhere in the suite).

- [ ] **Step 2: Run → fails** (`npx vitest run src/ui/hooks/useKeyboard.test.ts -t "Shift"`): no handler yet.

- [ ] **Step 3:** In `useKeyboard.ts`, after the `mod && (e.key === 'g'…)` group block (line ~33) and
before the `kfSelected` computation, add:

```ts
      if (mod && e.shiftKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); s.booleanOp('union'); return; }
      if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); s.booleanOp('subtract'); return; }
      if (mod && e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); s.booleanOp('intersect'); return; }
      if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); s.booleanOp('exclude'); return; }
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Full verify + commit** — `npx vitest run && npm run typecheck && npx eslint src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts`;
`feat(shortcuts): Cmd/Ctrl+Shift+U/S/I/E for boolean ops`.

---

## Self-Review
- Spec coverage: 4 branches + union test + regression (plain `s`) + isEditable inherited.
- Placeholders: the "NOTE" verifies the existing harness — a real check.
- Type consistency: `s.booleanOp('union'|'subtract'|'intersect'|'exclude')` matches `BoolOp`.
