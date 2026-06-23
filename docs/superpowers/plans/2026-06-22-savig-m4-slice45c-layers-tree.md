# Savig M4 Slice 45c — Layers-tree group rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` tracking. Spec: `specs/2026-06-22-savig-m4-slice45c-layers-tree-design.md`.

**Goal:** Show the group hierarchy in the Layers panel (group rows + nested children + expand/collapse); a group's eye toggle hides the whole group (cascading visibility).

**Architecture:** A pure `isRenderHidden(obj, objectsById)` (child hidden when it OR its parent group is hidden) gates the two node/element sites (Stage `ordered`, `renderDocument`). The Layers panel builds a flat `{ obj, depth }` render list (top-level, then each expanded group's children) with local expand state. No data/persistence change.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TS strict; no new deps. Editor + a 2-site render cascade; no persistence/data change.
- preview==export: the visibility cascade is applied at BOTH render sites (Stage + renderDocument) so a group-hidden child is absent in preview AND export. `computeFrame` is unchanged.
- Selection routes through the existing `selectObjectOrGroup`/`toggleObjectOrGroup` (group-level).
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: `isRenderHidden` + visibility cascade at the render sites

**Files:** `src/engine/groupTransform.ts` + barrel; `src/services/export/renderDocument.ts`; `src/ui/components/Stage/Stage.tsx`. Tests: `src/engine/groupTransform.test.ts`, `src/services/export/renderDocument.test.ts`, `src/ui/components/Stage/Stage.test.tsx`.

**Interface:** `isRenderHidden(obj: SceneObject, objectsById: Map<string, SceneObject>): boolean` — `obj.hidden || !!(obj.parentId && objectsById.get(obj.parentId)?.isGroup && objectsById.get(obj.parentId)?.hidden)`.

- [ ] **Step 1: Failing engine test** (`groupTransform.test.ts`): a visible child of a hidden group → `isRenderHidden` true; a visible child of a visible group → false; a hidden child → true.
- [ ] **Step 2:** Implement `isRenderHidden` in `groupTransform.ts` (export via the engine barrel — `groupTransform` is already `export *`-ed).
- [ ] **Step 3: Failing render tests:** `renderDocument.test.ts` — a child of a hidden group emits NO element (and a child of a visible group does). `Stage.test.tsx` — a child of a hidden group registers no node (or: the `object-<childId>` node is absent).
- [ ] **Step 4: Wire the cascade.**
  - `renderDocument.ts` line 41: replace `if (obj.hidden) return '';` with `if (isRenderHidden(obj, objectsById)) return '';` (`objectsById` already exists in scope).
  - `Stage.tsx` `ordered` memo (line 104): replace `!o.hidden` with `!isRenderHidden(o, byId)` where `byId = new Map(project.objects.map((o) => [o.id, o]))` computed in the same memo.
- [ ] **Step 5:** Run the engine + render suites + the preview==export parity test → all PASS.
- [ ] **Step 6: Commit** `feat(slice45c): group-visibility cascade (isRenderHidden) in render + export`.

---

### Task 2: Layers tree — group rows + nested children + expand/collapse

**Files:** `src/ui/components/LayersPanel/LayersPanel.tsx`, `src/ui/components/LayersPanel/LayersPanel.module.css`. Test: `src/ui/components/LayersPanel/LayersPanel.test.tsx`.

- [ ] **Step 1: Failing tests** (`LayersPanel.test.tsx`):
  - a group + 2 children renders the group row + the children nested (the children are NOT top-level: assert the group row appears before its children and children carry a depth/indent marker), with a `disclosure-<groupId>` toggle.
  - collapsing the group (click the disclosure) removes the child rows from the DOM.
  - clicking a child row selects the GROUP (selectedObjectIds == [groupId]).
  - the group eye (`vis-<groupId>`) toggles the group's `hidden`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Build the render list.** In `LayersPanel.tsx`, replace the flat `ordered`/map with a tree:
```tsx
const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
const topLevel = objects.filter((o) => !o.parentId).sort((a, b) => b.zOrder - a.zOrder);
const rows: { obj: SceneObject; depth: number }[] = [];
for (const o of topLevel) {
  rows.push({ obj: o, depth: 0 });
  if (o.isGroup && !collapsed.has(o.id)) {
    for (const c of objects.filter((x) => x.parentId === o.id).sort((a, b) => b.zOrder - a.zOrder)) {
      rows.push({ obj: c, depth: 1 });
    }
  }
}
```
Render `rows` (instead of `ordered`). For each row: keep the existing row JSX (click → select/toggle via `selectObjectOrGroup`/`toggleObjectOrGroup`; name/rename; lock; eye), add `style={{ paddingLeft: depth ? 'calc(var(--space-3) + 16px)' : undefined }}` (or a `styles.child` class) for indentation, and — when `obj.isGroup` — a disclosure toggle button before the name:
```tsx
{obj.isGroup && (
  <button
    data-testid={`disclosure-${obj.id}`}
    aria-label={`${obj.name} ${collapsed.has(obj.id) ? 'expand' : 'collapse'}`}
    className={styles.disclosure}
    onClick={(e) => { e.stopPropagation(); setCollapsed((s) => { const n = new Set(s); n.has(obj.id) ? n.delete(obj.id) : n.add(obj.id); return n; }); }}
  >
    {collapsed.has(obj.id) ? '▸' : '▾'}
  </button>
)}
```
(Type `SceneObject` is needed — import it from the engine.)
- [ ] **Step 4: CSS.** Add to `LayersPanel.module.css`: `.disclosure { background: none; border: none; cursor: pointer; color: var(--color-text-dim); padding: 0; width: 14px; }` and (optional) `.child { ... }`.
- [ ] **Step 5: Run** the Layers suite → PASS. Confirm the existing Layers tests (front-first order, rename, lock, eye, drag-reorder) still pass — the top-level ordering is unchanged for ungrouped objects.
- [ ] **Step 6: Commit** `feat(slice45c): Layers tree — group rows, nested children, expand/collapse`.

---

### Task 3: e2e + full gate

**Files:** `e2e/layers-tree.spec.ts`.

- [ ] **Step 1:** Write `e2e/layers-tree.spec.ts`: draw 2 rects; select both; Group; the Layers panel shows a group row (`layer-<gid>`) with the two children nested (the two `layer-<childId>` rows present); click `disclosure-<gid>` → the child rows disappear; click it again → they reappear; toggle the group eye (`vis-<gid>`) → both child objects vanish from the Stage (`[data-savig-object]` count drops to 0); toggle back → they reappear. (Resolve the group id via the Layers row, e.g. the row that is NOT one of the two original objects.)
- [ ] **Step 2:** Run `pnpm exec playwright test e2e/layers-tree.spec.ts` → PASS.
- [ ] **Step 3: Full gate** — `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test` → all green.
- [ ] **Step 4: Commit** `test(slice45c): e2e for the Layers tree (nest, collapse, group visibility)`.

---

## Self-Review (post-write)

- **Spec coverage:** cascade helper + 2 render sites (T1) ✓; tree + group rows + nested + expand/collapse + group eye + child-click-selects-group (T2) ✓; e2e (T3) ✓.
- **Type consistency:** `isRenderHidden(obj, Map<string,SceneObject>)` used identically at both render sites; the LayersPanel render-list `{ obj, depth }` shape; `SceneObject` imported where the new code needs it.
- **Parity:** the cascade is at both render/element sites; `computeFrame` unchanged; the existing parity test is unaffected (run it in T1 step 5).
- **No data change:** expand/collapse is local `useState`; nothing persists.
- **Deferred (spec §4):** drag-reparent; group lock cascade; granular child selection / enter-group; nested groups in the tree.
