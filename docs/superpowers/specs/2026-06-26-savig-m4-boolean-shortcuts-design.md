# Savig M4 — Boolean-Op Keyboard Shortcuts (slice 46 follow-up)

**Date:** 2026-06-26
**Milestone:** M4
**Status:** design — a small, bounded UX gap from slice 46 (boolean ops were buttons-only).

---

## 1. Motivation

The four boolean path ops (union / subtract / intersect / exclude) ship as Inspector buttons only.
Keyboard shortcuts make them fast for repeated use, matching the existing shortcut set (group, dup,
reorder, clipboard).

## 2. Architecture

The store action `booleanOp(op: BoolOp)` already **self-gates**: `if (eligible.length < 2) return`
(eligible = selected non-group vector objects) and `if (rings.length === 0) return`. So a keyboard
handler can call it unconditionally — it is a safe no-op when the selection is ineligible, never a
silent partial op. No eligibility logic is duplicated into the keyboard layer.

Add four branches to `useKeyboard`'s `onKey`, in the `mod` (Cmd/Ctrl) + Shift group, BEFORE the
non-modifier tool-key `switch` (so e.g. Cmd+Shift+S never falls through to `case 's' → star tool`):

```ts
if (mod && e.shiftKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); s.booleanOp('union'); return; }
if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); s.booleanOp('subtract'); return; }
if (mod && e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); s.booleanOp('intersect'); return; }
if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); s.booleanOp('exclude'); return; }
```

### Key choice

`Cmd/Ctrl+Shift+` `U`nion / `S`ubtract / `I`ntersect / `E`xclude — mnemonic first letters. Collision
review against the existing handlers: the taken `mod` combos are `Z D G C X V [ ]` and `Shift+Z`
(redo), `Shift+G` (ungroup), `Shift+[ ]` (front/back) — none use U/S/I/E, so no in-app clash. The
tool single-keys (`s`,`e`,…) live in the no-modifier `switch` and are shadowed by the early `return`.

**Caveat (documented):** `Cmd/Ctrl+Shift+I` is the browser devtools shortcut in Chrome/Edge/Firefox;
`preventDefault` may not reliably suppress it, so Intersect may be shadowed in some browsers — the
Inspector button remains the fallback. The other three are unaffected.

## 3. Guards (already in `onKey`)

- `isEditable(e.target)` early-returns when typing in an input/textarea — so the shortcuts don't fire
  while editing a field. (Inherited; no change.)
- The boolean branches sit alongside the other `mod` shortcuts, after the `isEditable` guard.

## 4. Scope vs deferred

**In:** the four keyboard branches; tests.

**Out:** changing `booleanOp` (unchanged — already self-gating); re-binding intersect to dodge
devtools (documented caveat instead); on-screen shortcut hints.

## 5. Parity & regression-safety

- No engine/store change → `booleanOp` behaves identically whether invoked by button or key →
  preview==export untouched.
- Regression-safe: the new branches only match `mod+Shift+U/S/I/E`, which previously fell through to
  the tool-`switch` (e.g. Cmd+Shift+E → ellipse tool). That fall-through was an unintended quirk;
  intercepting it is the fix, not a regression (a modifier+tool-letter was never a documented tool
  shortcut). A test pins that a plain `e`/`s` (no modifier) still selects the tool.

## 6. Testing strategy

`src/ui/hooks/useKeyboard.test.ts` (mirrors the existing Cmd+D / Cmd+] tests):
- With ≥2 eligible vector objects selected, `keydown Cmd+Shift+U` calls `booleanOp('union')` (assert
  via the resulting single merged path object, or spy the action) — and likewise S/I/E map to
  subtract/intersect/exclude.
- A plain `s` (no modifier) still sets the star tool (regression: the boolean branch requires `mod`).
- Cmd+Shift+U while typing in an input (`isEditable`) does nothing.
