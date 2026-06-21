# M2 Slice 18 — Rename Object (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §7)
Predecessor: Slice 17 — layers panel + object visibility (merged `1750336`)

## 1. Goal

Let a user **rename an object** by double-clicking its name in the Layers panel and
typing. Names are currently locked to auto-generated values ("Rectangle 1", "… copy");
inline rename turns the Layers panel into a real organizational tool ("background",
"logo", "title").

Non-goals (deferred, tracked in §8): a name field in the Inspector; renaming assets;
rename-on-the-stage; name-uniqueness enforcement (duplicate names already occur).

## 2. Store — `renameObject(id, name)`

```ts
renameObject(id: string, name: string): void;
```

```ts
renameObject(id, name) {
  const project = get().history.present;
  const obj = project.objects.find((o) => o.id === id);
  if (!obj || obj.name === name) return;   // unknown / unchanged -> no-op (no history entry)
  get().commit(replaceObject(project, { ...obj, name }));
}
```

One `commit` → one undo step. `name` is a persisted document field (it already
round-trips); renaming is undoable. No migration.

## 3. Layers-panel inline edit (`LayersPanel.tsx`)

The existing name `<span>` becomes a double-click-to-edit field, with local component
state for the in-progress edit:

```ts
const [editingId, setEditingId] = useState<string | null>(null);
const [draft, setDraft] = useState('');
const cancelRef = useRef(false);

const startEdit = (o) => { cancelRef.current = false; setEditingId(o.id); setDraft(o.name); };
const finishEdit = () => {
  const id = editingId;
  if (id && !cancelRef.current) {
    const trimmed = draft.trim();
    if (trimmed) renameObject(id, trimmed);   // empty/whitespace -> keep old name
  }
  cancelRef.current = false;
  setEditingId(null);
};
```

Per row:
- when `editingId !== o.id`: the name `<span>` with `onDoubleClick={() => startEdit(o)}`;
- when `editingId === o.id`: an `<input data-testid="rename-<id>">` with
  - `autoFocus`, `onFocus={(e) => e.currentTarget.select()}` (select-all),
  - `value={draft}`, `onChange` updates `draft`,
  - `onClick={(e) => e.stopPropagation()}` (positioning the cursor must not re-fire the
    row's `onClick → selectObject`),
  - `onBlur={finishEdit}` (click-away commits),
  - `onKeyDown`: `Enter` → `finishEdit()`; `Escape` → `{ cancelRef.current = true; finishEdit(); }`.

**Escape/blur correctness:** Escape sets `cancelRef` then `finishEdit()`, which skips
the rename and nulls `editingId` (unmounting the input, so a later `onBlur` does not
re-commit). Enter and blur both commit the (trimmed, non-empty) draft. The global
keyboard handler already early-returns on an `<input>` target (`isEditable`), so typing
Backspace/Delete edits the text rather than deleting the object.

> Double-clicking the name also fires the row's single `onClick` first, so the object
> is selected and then enters edit — the expected behavior.

## 4. CSS

Add a `.nameInput` rule to `LayersPanel.module.css` (a flush, panel-colored input):

```css
.nameInput { flex: 1; min-width: 0; font: inherit; color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-accent); border-radius: var(--radius-1); padding: 0 var(--space-1); }
```

## 5. Persistence & parity

No persistence/render/runtime/export change — `name` already serializes. No migration
(v4). The eye button's `aria-label` (``${o.name} visibility``) updates automatically.

## 6. Testing

- **Store unit (`store.test.ts`):** `renameObject` changes the name (undoable — undo
  restores); no-op for an unknown id; no-op when the name is unchanged (no history entry).
- **Layers-panel unit (`LayersPanel.test.tsx`):**
  - double-clicking a name shows an `rename-<id>` input pre-filled with the current name;
  - typing + Enter renames the object (the row shows the new name);
  - Escape cancels (the name is unchanged);
  - committing an empty/whitespace name keeps the old name.
- **e2e (Playwright):** draw a rect → double-click its Layers row name → select-all +
  type "Hero" → Enter → the Layers row shows "Hero".

## 7. Decisions (delegated to implementer, recorded)

1. **Slice = rename object** (inline in the Layers panel).
2. **Double-click → input**; Enter/blur commit; Escape cancels; empty → keep old name.
3. **`renameObject(id, name)`** undoable store action; no-op when unknown/unchanged.
4. **Inline-edit state in LayersPanel** (`editingId`/`draft`/`cancelRef`); no engine helper.
5. **One plan.**

## 8. Deferred (tracked)

- A name field in the Inspector; rename via a double-click on the stage.
- Name-uniqueness enforcement / auto-disambiguation.
- Renaming assets; renaming in a future timeline object-row label.
- Multi-select rename (M4).
