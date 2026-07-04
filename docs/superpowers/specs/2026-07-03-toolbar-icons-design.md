# Toolbar Icon Buttons (text → tooltip) — Design

**Date:** 2026-07-03 · **Status:** Approved (user), pre-implementation

## Problem / motivation
The tool palette (10 tools) and file actions (New/Open/Save/Export) are wide text buttons. This
wastes toolbar width and — as found in the template-gallery slice — the packed toolbar is
horizontally overflow-brittle: adding any wide element shifts the tool strip and breaks
coordinate-based drag/snap e2e tests. Converting these to compact icon buttons reclaims ~400px and
removes that constraint, while reading as a standard editor tool strip.

## Decisions (from brainstorming)
- **Scope:** the 10 tool-palette buttons **and** the 4 FileToolbar actions (New/Open/Save/Export).
- **Tooltip:** native `title` + `aria-label`. **`aria-label` keeps the current plain text** (so every
  existing `getByRole('button', { name })` selector + screen readers keep working); `title` carries
  the hover tooltip including the shortcut.
- **Shortcut in tooltip:** yes, derived from the command registry (single source of truth) so it can
  never drift. Shown only in `title`, not in `aria-label`.

## Audit (done)
No e2e or component test asserts on the *visible text* of a tool/file button — all use
`getByRole('button', { name })` (resolves via `aria-label`). So keeping `aria-label` = the current
text has ~zero test blast radius. `ToolPalette.test.tsx` / `FileToolbar.test.tsx` need no changes.

## Design

### 1. Neutral helper — `packages/ui-core/src/commands/`
`commandShortcutLabel(commandId: string, isMac: boolean): string | undefined` — finds the command in
`COMMANDS` and returns `formatChord(chord, isMac)` if it has a chord, else `undefined`. Reuses the
registry + formatter so button hints stay in sync with actual bindings.

### 2. Icons — `apps/react/src/ui/components/Toolbar/ToolbarIcons.tsx`
An `Icon` component (`<Icon name="rect" />`) mapping each of the 14 names
(`select|pen|node|rect|ellipse|polygon|star|line|brush|motion` + `new|open|save|export`) to a small
inline SVG glyph. Icons use `currentColor` (theme-aware, inherit button color), ~16px, `aria-hidden`
(the button's `aria-label` is the accessible name). Simple, recognizable glyphs authored by hand — no
icon-library dependency.

### 3. `ToolPalette.tsx`
Each button: child `<Icon name={t.id} />`; `aria-label={t.label}` (unchanged name); `title` =
``${t.label}${shortcut ? ` (${shortcut})` : ''}`` where `shortcut = commandShortcutLabel(`tool.${t.id}`, isMac)`.
`aria-pressed` unchanged.

### 4. `FileToolbar.tsx`
New/Open/Save/Export become icon buttons with `aria-label` = current text and `title` incl. shortcut
(only Save has one → `⌘S`/`Ctrl+S`; the others resolve to `undefined`). The Templates 🎬 / `?` / Theme
trailing buttons are already compact glyphs and are out of scope.

### 5. Platform util — `apps/react/src/ui/platform.ts`
Extract the `isMac` check currently duplicated in `CommandPalette.tsx` / `ShortcutsSheet.tsx` into one
`export const isMac = …`; those two files + the new toolbar code import it.

### 6. CSS
Square icon buttons (fixed size, centered glyph) in `ToolPalette.module.css` / `FileToolbar.module.css`;
`aria-pressed` active state for tools; hover affordance.

## Data flow
`registry chord` → `commandShortcutLabel(id, isMac)` → button `title`. `aria-label` = plain name.

## Testing
- **Unit (ui-core):** `commandShortcutLabel` — `tool.rect`→`R`, `file.save`→`⌘S` (mac) / `Ctrl+S`
  (non-mac), `file.new`→`undefined`, unknown id→`undefined`.
- **Component:** ToolPalette buttons keep their `aria-label`s, render an `<svg>` glyph, and `title`
  includes the shortcut (e.g. `Rectangle (R)`); `aria-pressed` still toggles. FileToolbar: aria-labels
  New/Open/Save/Export preserved; Save's `title` includes `⌘S`/`Ctrl+S`.
- **e2e:** regression only — the full suite must stay green (aria-labels unchanged). No new e2e.

## Out of scope (YAGNI)
- A generalized `<Tooltip>` component (native `title` chosen).
- Icon-ifying transport (`⏮▶⏭`) / align (`⊡…`) / trailing 🎬·?·Theme (already glyphs).
- Any icon-library dependency.
