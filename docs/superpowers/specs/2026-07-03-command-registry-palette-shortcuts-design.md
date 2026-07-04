# Command Registry → Command Palette + Shortcuts Sheet — Design

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation
**Parent brainstorm:** "help/tutorials to utilize all features" — this is the first slice (the always-available *reference layer*). Follow-on slices (template gallery, first-run tour, exposing MCP-only features) are out of scope here.

## Problem

The app is feature-rich but has near-zero discoverability: no command palette, no shortcuts
cheat-sheet, and keyboard shortcuts live only in `packages/ui-core/src/controllers/keymap.ts` with
nothing surfacing them. Users cannot discover or quickly reach features.

## Goal

A neutral **command registry** as the single source of truth, feeding three consumers:
1. the **keymap** (keyboard dispatch, derived from the registry),
2. a **command palette** (Cmd/Ctrl+K — search + run any command, with its shortcut shown),
3. a **shortcuts sheet** (`?` — a scannable reference grouped by category).

Add a feature once → it is bound, searchable, and documented.

## Decisions (from brainstorming)

- **Unify:** the registry is the source of truth; `keymap.ts` derives its bindings from registry entries.
- **Availability:** the palette shows *all* commands; unavailable ones are greyed with a reason (maximizes discovery).
- **Coverage:** comprehensive (~40–60 curated commands across all categories).
- Command palette and shortcuts sheet are both in v1. Tooltip migration, fuzzy ranking,
  recent/frequent, and a Svelte UI are out of scope (the neutral pieces are ready for Svelte later).

## Architecture

Follows the repo's neutral-core / view-model / thin-framework-UI split.

### 1. The command registry (`packages/ui-core/src/commands/registry.ts`)

```ts
export type CommandCategory =
  | 'Tools' | 'Edit' | 'Arrange' | 'Boolean' | 'Animation'
  | 'Symbols' | 'Scenes' | 'View' | 'File';

/** Neutral key descriptor. `mod` = meta OR ctrl. Matching is EXACT on modifiers and
 *  case-insensitive on `key` (Shift makes a letter's `key` uppercase). `key` uses DOM
 *  KeyboardEvent.key values ('v', 'z', ']', 'ArrowLeft', ' '); `keys` lists alternates
 *  (e.g. Delete/Backspace). */
export interface KeyChord {
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  key?: string;
  keys?: string[];
}

/** Context a command runs against. `state` is the live store snapshot; `host` is the app-provided
 *  boundary for browser/UI effects a neutral store action cannot perform (file pickers, overlays). */
export interface CommandContext {
  state: EditorState;
  host: CommandHost;
}

export interface Command {
  id: string;                                 // 'arrange.alignLeft'
  title: string;                              // 'Align left'
  category: CommandCategory;
  chord?: KeyChord;                           // absent = palette-only (no shortcut)
  run: (ctx: CommandContext, e?: KeyEvent) => void;
  when?: (s: EditorState) => boolean;         // availability; absent = always enabled
  unavailableHint?: string;                   // 'Select 2+ objects'
  keywords?: string[];                        // extra search terms
  preventDefault?: boolean;                   // preserves per-binding preventDefault behavior
}

export const COMMANDS: Command[];
```

Most commands are store-only: `run: (ctx) => ctx.state.alignSelected('left')`. Context-multiplexed
shortcuts become **separate entries sharing a chord** with differing `when`, ordered specific-first:
- `edit.copyKeyframe` (`when: kfSelected`) before `edit.copyObject` — Cmd+C resolves by state; both
  appear in the palette.
- `edit.deleteNode` → `edit.deleteKeyframe` → `edit.deleteObject` (chord `{keys:['Delete','Backspace']}`).
- Nudge/boolean read modifiers from the passed `KeyEvent` (`e.shiftKey` → 10px step; `e.altKey` → live boolean).

The Ctrl+Shift+I DevTools-shadow note travels with the `boolean.intersect` entry (browser eats the
key; the Inspector Intersect button remains the fallback).

### 2. The host boundary (`packages/ui-core/src/commands/host.ts`)

File Open/Save/Export and overlay open/close are **not** store actions — in the React app they are
async functions calling browser file-picker APIs + services (`FileToolbar.tsx`). A neutral
store-only `run` cannot perform them, so they go through an app-implemented interface:

```ts
export interface CommandHost {
  newProject(): void;        // (also available as ctx.state.newProject; host wraps for symmetry)
  openProject(): void;       // async internally; browser file picker
  saveProject(): void;
  exportProject(): void;
  openPalette(): void;
  openShortcuts(): void;
  closeOverlay(): void;
}
```

`apps/react` implements `CommandHost` (wrapping the existing `FileToolbar` handlers + overlay state).
Svelte can implement the same interface later. Neutral code holds no browser APIs.

### 3. Keymap derives from the registry (`packages/ui-core/src/controllers/keymap.ts`)

`makeKeymapController(store, host)` collapses to a generic matcher:

```ts
const handleKey = (e: KeyEvent): boolean => {
  const state = store.getState();
  const cmd = COMMANDS.find((c) => c.chord && chordMatches(c.chord, e) && (!c.when || c.when(state)));
  if (!cmd) return false;
  cmd.run({ state, host }, e);
  return cmd.preventDefault ?? false;
};
```

`chordMatches(chord, e)`: exact modifier match (`(chord.mod ?? false) === (e.metaKey || e.ctrlKey)`,
same for shift/alt) and case-insensitive key membership (`chord.key`/`chord.keys` vs `e.key`).

**Behavior change (intentional, documented):** because the current `switch` runs unconditionally
after the mod-combo early-returns, bare-letter tool shortcuts fire while a modifier is held —
**Cmd+S → Star tool, Cmd+B → Brush, Cmd+R → Rect** (with no `preventDefault`, so the browser action
also fires). Exact-modifier matching fixes this: tool chords have `mod` absent/false and no longer
match modifier-held events. The parity test asserts the *fixed* behavior for these mod+letter cases
and preserves every genuine binding.

### 4. View-models (`packages/ui-core/src/viewmodels/`)

- `commandPalette.ts` — `commandPaletteViewModel(state, query, isMac): PaletteResult[]`:
  ```ts
  interface PaletteResult {
    id: string; title: string; category: CommandCategory;
    shortcutLabel?: string;      // '⌘Z' | 'Ctrl+Z', from formatChord(chord, isMac)
    enabled: boolean;            // from when(state)
    unavailableHint?: string;
  }
  ```
  Filters by title/keywords/category substring; enabled sorted first, disabled greyed in place.
- `shortcutsSheet.ts` — `shortcutsSheetViewModel(isMac): { category; items: { title; shortcutLabel }[] }[]`:
  chord-bearing commands grouped by category.
- `formatChord(chord, isMac)` — neutral label helper with a key→symbol map (`Space`, `→`, `⌫`,
  `⌘`/`Ctrl`, `⇧`, `⌥`). `isMac` is supplied by the app; the VM stays platform-agnostic.

### 5. Shared availability predicates (`packages/ui-core/src/commands/predicates.ts`)

`canAlign`/`canDistribute`/`canBool` etc. currently live inside `inspectorViewModel`. Extract them
into shared neutral predicates (they use `selectActiveObjects` + the lock-cascade helpers) so the
registry's `when` and the Inspector consume one copy — no drift.

### 6. React UIs (thin, `apps/react/src/ui/components/`)

- `CommandPalette/` — Cmd/Ctrl+K overlay: search input, result list (arrow/Enter/Esc nav), runs
  `command.run({ state, host }, undefined)`; disabled results show the hint and do not run.
  A11y: `role=dialog` + listbox/option, `aria-activedescendant`, focus trap.
- `ShortcutsSheet/` — `?` overlay (and a visible "?" button, since `?` is layout-dependent):
  scannable columns by category.
- Overlay open/close is app-local view state; `CommandHost.openPalette/openShortcuts/closeOverlay`
  toggle it. Both reuse existing overlay styling.

## Data Flow

```
key event → useKeyboard (React, isEditable guard) → keymap.handleKey
              → matcher picks first chord-matching, when-passing Command → cmd.run({state, host}, e)

Cmd/Ctrl+K / ? / "?" button → host.openPalette()/openShortcuts() → overlay opens
  palette: query → commandPaletteViewModel → list; Enter → cmd.run({state, host})
  sheet:   shortcutsSheetViewModel → grouped reference
```

When an overlay is open, its focused input makes `isEditable` suppress the window keymap handler, so
typing/arrows/Escape belong to the overlay.

## Testing

- **Keymap parity table test** (the safety net, written FIRST): every current keyboard behavior maps
  to the same store action — *plus* the documented mod+letter fixes (Cmd+S/B/R no longer select tools).
- **`chordMatches`** units: exact modifier match, case-insensitivity, `keys` alternates.
- **Registry-integrity test**: no two commands whose `when` can both be true share a chord (guards
  against silent shadowing).
- **Palette VM**: query filtering, `enabled` from `when`, enabled-first sort, `shortcutLabel` mac + non-mac.
- **Sheet VM**: grouping, only chord-bearing commands, labels.
- **Component (React)**: Cmd+K opens + filters + Enter runs (observe a store effect); a disabled
  command shows its hint and does not run; `?` opens the sheet.
- **e2e**: Cmd+K → search "align" → (with 2 objects selected) run "Align left" → assert effect;
  `?` → a known shortcut (e.g. Undo ⌘Z) is listed.

## Notes & Warnings

- **Intentional behavior change:** the mod+letter quirk fix (§3) alters Cmd+S/Cmd+B/Cmd+R. Called out
  so it is a conscious change, not a surprise regression.
- **Predicate extraction** touches the Inspector's lock-cascade path; the Inspector's existing tests
  guard against regressions there.
- **Tool commands are mode-switches** ("Rectangle tool" sets the tool; the user still draws) — labeled
  as such so the palette does not imply one-shot creation.
- **`?` is keyboard-layout-dependent** (Shift+/ on US); the visible "?" button is the reliable path.
- **Registry population is the bulk of the effort** — mostly data entry wiring existing store
  actions. It can be delivered category-by-category if the plan needs smaller tasks.

## Out of Scope (YAGNI) / Follow-ups

- **Optional now, recommended:** a real `Cmd+S → Save` command (trivial once the Star-tool quirk is fixed).
- Tooltip system migration (the registry can feed it later).
- Fuzzy ranking, recent/frequent, per-command icons.
- A palette over MCP tools.
- Svelte palette/sheet UI (neutral registry/VMs/host-interface are ready for it).
- Other brainstorm slices: template gallery UI, first-run tour, exposing MCP-only features (camera, GIF/PNG/SVG export).
