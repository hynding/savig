# Command Registry + Palette + Shortcuts Sheet — Implementation Plan

> **For agentic workers:** implement task-by-task with TDD; each task ends green + committed.

**Goal:** A neutral command registry (single source of truth) feeding keymap dispatch, a Cmd/Ctrl+K command palette, and a `?` shortcuts sheet.

**Architecture:** Neutral registry + host interface + view-models in `@savig/ui-core`; `keymap.ts` refactored to a generic matcher over the registry; thin React overlays + host impl in `apps/react`.

**Spec:** docs/superpowers/specs/2026-07-03-command-registry-palette-shortcuts-design.md

## Global Constraints

- TS strict; no `any`. Neutral packages never import from `apps/*` or browser APIs.
- `run(ctx, e?)` where `ctx = { state: EditorState; host: CommandHost }`. `when(state)` is state-only.
- `chordMatches`: exact modifier match (`mod` = meta‖ctrl), case-insensitive key.
- Tests: `npx vitest run <pattern>` from root; e2e `npx playwright test <pattern>` (kill stale vite first).
- Keymap refactor must preserve every genuine binding; the only intended behavior changes are the
  mod+letter quirk fixes (Cmd+S/B/R no longer select tools) and the new Cmd+S→Save.

---

### Task 1: Command types + chordMatches + formatChord

**Files:** Create `packages/ui-core/src/commands/types.ts`, `packages/ui-core/src/commands/chord.ts`; Test `packages/ui-core/src/commands/chord.test.ts`. Export from `packages/ui-core/src/index.ts`.

**Produces:** `KeyChord`, `KeyEvent`, `CommandCategory`, `CommandContext`, `CommandHost`, `Command` (types); `chordMatches(chord, e): boolean`; `formatChord(chord, isMac): string`.

- [ ] **Step 1 — failing tests** (`chord.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { chordMatches, formatChord } from './chord';
const ev = (o: Partial<import('./types').KeyEvent> & { key: string }) =>
  ({ shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...o });

describe('chordMatches', () => {
  it('exact modifier match: mod chord needs meta OR ctrl', () => {
    expect(chordMatches({ mod: true, key: 'z' }, ev({ key: 'z', metaKey: true }))).toBe(true);
    expect(chordMatches({ mod: true, key: 'z' }, ev({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(chordMatches({ mod: true, key: 'z' }, ev({ key: 'z' }))).toBe(false);
  });
  it('a no-mod chord must NOT fire under a modifier (the quirk fix)', () => {
    expect(chordMatches({ key: 's' }, ev({ key: 's' }))).toBe(true);
    expect(chordMatches({ key: 's' }, ev({ key: 's', metaKey: true }))).toBe(false);
  });
  it('case-insensitive key + shift exactness', () => {
    expect(chordMatches({ key: 'v' }, ev({ key: 'V' }))).toBe(true);
    expect(chordMatches({ mod: true, shift: true, key: 'u' }, ev({ key: 'U', metaKey: true, shiftKey: true }))).toBe(true);
    expect(chordMatches({ key: 'v' }, ev({ key: 'v', shiftKey: true }))).toBe(false);
  });
  it('keys[] alternates (Delete/Backspace)', () => {
    expect(chordMatches({ keys: ['Delete', 'Backspace'] }, ev({ key: 'Backspace' }))).toBe(true);
  });
});

describe('formatChord', () => {
  it('mac uses symbols; non-mac uses words', () => {
    expect(formatChord({ mod: true, key: 'z' }, true)).toBe('⌘Z');
    expect(formatChord({ mod: true, key: 'z' }, false)).toBe('Ctrl+Z');
    expect(formatChord({ mod: true, shift: true, key: 's' }, true)).toBe('⌘⇧S');
    expect(formatChord({ key: ' ' }, false)).toBe('Space');
    expect(formatChord({ keys: ['Delete', 'Backspace'] }, true)).toBe('⌦');
  });
});
```
- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — `types.ts`:** define `KeyEvent` (moved from keymap), `KeyChord`, `CommandCategory` (the 9 categories), `CommandContext`, `CommandHost` (newProject/openProject/saveProject/exportProject/openPalette/openShortcuts/closeOverlay — all `(): void`), and `Command` per the spec. Import `EditorState` type from `@savig/editor-state`.
- [ ] **Step 4 — `chord.ts`:** `chordMatches` (exact `(chord.mod ?? false) === (e.metaKey||e.ctrlKey)`, same for shift/alt; key via lowercase compare over `[chord.key, ...(chord.keys??[])]`). `formatChord`: build modifier prefix (mac `⌘⇧⌥⌃`, else `Ctrl+ Shift+ Alt+`), map special keys (`' '`→Space, `ArrowLeft/Right/Up/Down`→arrows, `Delete`→`⌦`, `Backspace`→`⌫`), else uppercase the letter; join.
- [ ] **Step 5 — run, expect pass. Export from index.ts. Commit** `feat(ui-core): command types + chordMatches + formatChord`.

---

### Task 2: Shared availability predicates

**Files:** Create `packages/ui-core/src/commands/predicates.ts`; Test `packages/ui-core/src/commands/predicates.test.ts`. Refactor `inspectorViewModel` (multi-select branch) to call them.

**Produces:** `canAlign(s)`, `canDistribute(s)`, `canBool(s)`, `canGroup(s)`, `canCreateSymbol(s)`, `hasSelection(s)`, `hasMultiSelection(s)` — all `(s: EditorState) => boolean`, matching the current inspector VM semantics (movable count via lock cascade; boolean eligibility via vector-leaf/svg operand).

- [ ] **Step 1 — failing tests:** port the inspector VM's multi-select assertions (2 rects → canAlign true, canDistribute false; 3 → canDistribute true; 2 vectors → canBool true; locked-ancestor gates canCreateSymbol) but call the new predicates directly against the store.
- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement** by lifting the exact logic currently in `inspectorViewModel`'s multi branch (movableCount/eligibleForBool/hasVectorLeaf/isSvgOperand) into pure functions over `selectActiveObjects(s)` + `buildLockIndex`.
- [ ] **Step 4 — refactor `inspectorViewModel`** to call the shared predicates (behavior identical). Run the full inspector test suite — must stay green.
- [ ] **Step 5 — run, expect pass. Commit** `refactor(ui-core): extract shared command-availability predicates`.

---

### Task 3: Command registry + registry-integrity test

**Files:** Create `packages/ui-core/src/commands/registry.ts`; Test `packages/ui-core/src/commands/registry.test.ts`. Export `COMMANDS` + `findMatchingCommand` from index.

**Produces:** `COMMANDS: Command[]` (~45–55 entries) and `findMatchingCommand(state, e): Command | undefined` (first entry whose `chord` matches and `when` passes).

Command inventory (id · title · category · chord · when · run):
- **Tools:** `tool.select`(Select tool·V), pen·P, node·N, rect·R, ellipse·E, polygon·G, star·S, line·L, brush·B, motion·M — `run: ctx.state.setActiveTool(x)`; `view.onionSkin`(O·toggleOnionSkin).
- **Edit:** undo(⌘Z), redo(⌘⇧Z), `edit.duplicate`(⌘D·when hasSelection), `edit.copyKeyframe`(⌘C·when kfSelected), `edit.copyObject`(⌘C·when hasSelection·after copyKeyframe), cut variants (⌘X), paste variants (⌘V·when clipboard), `edit.deleteNode`(Delete/Backspace·when node+index), `edit.deleteKeyframe`(·when kfSelected), `edit.deleteObject`(·when selectedObjectId), reorder front/forward(⌘]/⌘⇧]) + back/backward(⌘[).
- **Arrange:** align left/hcenter/right/top/vcenter/bottom (when canAlign), distribute h/v + centers + spacing (when canDistribute), alignToCanvas ×6, centerOnCanvas, group(⌘G·when canGroup), ungroup(⌘⇧G), createSymbol(when canCreateSymbol).
- **Boolean:** union(⌘⇧U), subtract(⌘⇧S), intersect(⌘⇧I — keep DevTools-shadow comment), exclude(⌘⇧E) — `when canBool`, `run: ctx.state.booleanOp(op, { live: e?.altKey })`.
- **Animation:** play/pause(Space·setPlaying(!playing)), stepFrame -1(`,`)/+1(`.`), toggleAutoKey.
- **View:** toggleSnap, toggleGrid, `view.shortcuts`(?·run ctx.host.openShortcuts), `view.commandPalette`(⌘K·run ctx.host.openPalette).
- **File:** `file.new`(run ctx.host.newProject), `file.open`(run ctx.host.openProject), `file.save`(⌘S·run ctx.host.saveProject·preventDefault), `file.export`(run ctx.host.exportProject).
- `preventDefault: true` on all mod-combos + Space + arrows + `file.save`, matching the old keymap; bare tool keys / `,` `.` / Delete stay `preventDefault` false — EXCEPT model per the parity test.

- [ ] **Step 1 — failing test** (`registry.test.ts`): (a) integrity — no two commands whose `when` can both be true share a chord (compute over the list; for each chord group, assert not all-simultaneously-enabled overlap — pragmatically: entries sharing a chord must have mutually-exclusive or ordered `when`, assert each shared-chord group is documented by ordering); (b) `findMatchingCommand` picks `edit.copyKeyframe` when a keyframe is selected else `edit.copyObject`.
- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement** `COMMANDS` + `findMatchingCommand`. Wire each `run` to the existing store action / host method.
- [ ] **Step 4 — run, expect pass. Commit** `feat(ui-core): command registry + matcher`.

---

### Task 4: Keymap derives from the registry (+ parity)

**Files:** Modify `packages/ui-core/src/controllers/keymap.ts`; extend `packages/ui-core/src/controllers/keymap.test.ts`.

**Consumes:** `findMatchingCommand`, `CommandHost`. **Produces:** `makeKeymapController(store, host)` whose `handleKey` = match → `run({state,host}, e)` → return `preventDefault`.

- [ ] **Step 1 — extend keymap.test.ts (parity + fixes):** keep all existing cases (adapt to `makeKeymapController(store, stubHost)`); ADD: `Cmd+S` does NOT set the star tool and DOES call host.saveProject; `Cmd+B`/`Cmd+R` do NOT change the tool; boolean `live` via altKey; Delete precedence node→kf→object. `stubHost` records calls.
- [ ] **Step 2 — run, expect fail** (old keymap still selects star on Cmd+S).
- [ ] **Step 3 — rewrite `handleKey`** to the generic matcher (spec §3). Move `KeyEvent` import to `../commands/types`. Keep the intersect DevTools comment near the registry entry (already there).
- [ ] **Step 4 — run full ui-core suite, expect green. Commit** `refactor(ui-core): keymap dispatches via the command registry`.

---

### Task 5: Palette + Sheet view-models

**Files:** Create `packages/ui-core/src/viewmodels/commandPalette.ts`, `shortcutsSheet.ts`; Tests alongside. Export from index.

**Produces:** `commandPaletteViewModel(state, query, isMac): PaletteResult[]`; `shortcutsSheetViewModel(isMac): { category; items:{title;shortcutLabel}[] }[]`.

- [ ] **Step 1 — failing tests:** palette — empty query lists all (enabled-first); query `'align'` filters to align commands; a command with failing `when` has `enabled:false` + its `unavailableHint`; `shortcutLabel` respects isMac. Sheet — groups by category, only chord-bearing commands, labels formatted.
- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement:** palette filters by title/keywords/category substring (case-insensitive), maps each to `{id,title,category,shortcutLabel:chord&&formatChord,enabled:!when||when(state),unavailableHint}` and stable-sorts enabled-first; sheet filters `chord`-bearing, groups by category order, formats labels.
- [ ] **Step 4 — run, expect pass. Commit** `feat(ui-core): command palette + shortcuts sheet view-models`.

---

### Task 6: React fileOps + CommandHost + App wiring

**Files:** Create `apps/react/src/ui/fileOps.ts`, `apps/react/src/ui/commandHost.ts`; Modify `FileToolbar.tsx`, `App.tsx`, `hooks/useKeyboard.ts`, `hooks/useKeyboard.test.ts`.

**Produces:** `fileOps` (`openProject/saveProject/exportProject`), `makeCommandHost(overlayApi)` returning a `CommandHost`, `useKeyboard(host)`, and App-level overlay state + mounted overlays.

- [ ] **Step 1 — extract fileOps:** move `onOpen`/`onSave`/`onExport` bodies from `FileToolbar.tsx` into `fileOps.ts` as async functions using `useEditor.getState()`; `FileToolbar` imports and calls them (its buttons unchanged). Run FileToolbar/e2e export test — green.
- [ ] **Step 2 — commandHost.ts:** `makeCommandHost({ openPalette, openShortcuts, closeOverlay }): CommandHost` wiring newProject→`useEditor.getState().newProject()`, open/save/export→fileOps, and the three overlay callbacks.
- [ ] **Step 3 — useKeyboard(host):** change signature to accept host, pass to `makeKeymapController(useEditor, host)`; update `useKeyboard.test.ts` with a stub host.
- [ ] **Step 4 — App.tsx:** `useState` for `overlay: 'palette'|'shortcuts'|null`; build host via `makeCommandHost`; `useKeyboard(host)`; mount `<CommandPalette>`/`<ShortcutsSheet>` when active (components land in Tasks 7–8 — until then, render null placeholders so the app compiles).
- [ ] **Step 5 — run affected tests, typecheck. Commit** `feat(app-react): fileOps extraction + CommandHost + keyboard wiring`.

---

### Task 7: Command palette component

**Files:** Create `apps/react/src/ui/components/CommandPalette/CommandPalette.tsx` (+ `.module.css`); Test `CommandPalette.test.tsx`.

- [ ] **Step 1 — failing tests:** rendering with overlay open shows a search input (`role=dialog`, aria-label "Command palette"); typing `align` filters; ArrowDown+Enter runs the highlighted command (observe a store effect after selecting 2 objects, e.g. Align left); a disabled command shows its hint and Enter does not run it; Escape calls `host.closeOverlay`.
- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement:** consumes `commandPaletteViewModel(useEditor.getState(), query, isMac)`; controlled query state; keyboard nav (Up/Down/Enter/Esc) with `aria-activedescendant`; on Enter runs `command.run({ state: useEditor.getState(), host }, undefined)` then `host.closeOverlay()`; focus trap on the input. `isMac` from `navigator.platform`. Wire into App (replace the Task 6 placeholder).
- [ ] **Step 4 — run, expect pass. Commit** `feat(app-react): command palette overlay`.

---

### Task 8: Shortcuts sheet component

**Files:** Create `apps/react/src/ui/components/ShortcutsSheet/ShortcutsSheet.tsx` (+ css); Test `ShortcutsSheet.test.tsx`. Add a visible "?" button (e.g. in FileToolbar) calling `host.openShortcuts`.

- [ ] **Step 1 — failing tests:** open sheet renders category headings and a known binding row (Undo → ⌘Z / Ctrl+Z per isMac); Escape closes; the "?" button opens it.
- [ ] **Step 2 — run, expect fail.**
- [ ] **Step 3 — implement:** consumes `shortcutsSheetViewModel(isMac)`; columns by category; `role=dialog`; Escape → `host.closeOverlay`. Add the "?" button.
- [ ] **Step 4 — run, expect pass. Commit** `feat(app-react): shortcuts sheet overlay`.

---

### Task 9: e2e

**Files:** Create `e2e/command-palette.spec.ts`.

- [ ] **Step 1 — spec:** goto `/`; press Control+K → palette visible; draw two rects + select both; type `align`, ArrowDown to "Align left", Enter → assert an object moved (x changed) and palette closed; press `?` → sheet shows an "Undo" row; Escape closes.
- [ ] **Step 2 — run `npx playwright test command-palette` (kill stale vite). Expect pass.**
- [ ] **Step 3 — full regression** `npx vitest run` + `npx playwright test`. **Commit** `test(e2e): command palette + shortcuts sheet`.

---

## Self-Review

- Spec coverage: registry→Task 3; host→Tasks 1/6; keymap-derive+quirk fix→Task 4; palette VM/UI→Tasks 5/7; sheet VM/UI→Tasks 5/8; predicates→Task 2; fileOps extraction→Task 6; Cmd+S→Save→Tasks 3/4; a11y→Tasks 7/8; e2e→Task 9. ✓
- Types consistent: `run(ctx,e?)`, `CommandHost` methods, `PaletteResult`, `findMatchingCommand` used identically across tasks. ✓
- No placeholders beyond the intentional Task-6 "render null until Tasks 7–8" (removed in Task 7). ✓
