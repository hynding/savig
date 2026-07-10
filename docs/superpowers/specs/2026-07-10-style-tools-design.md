# Style Tools: Copy/Paste Style + Eyedropper — Design

**Date:** 2026-07-10 · **Status:** Approved (program roadmap #1; decisions documented per pre-approved
autonomous flow) · **Roadmap:** docs/superpowers/specs/2026-07-10-art-tools-roadmap.md

## Goal

Move a vector object's complete look between objects without re-authoring it: **Copy Style /
Paste Style** commands (multi-select paste), an **Eyedropper stage tool** (click a source object to
restyle the selection), and **native pixel-pick buttons** in the Inspector's fill/stroke rows
(Chromium `EyeDropper` API, feature-detected).

## Decisions (with rationale)

1. **What a "style" is:** the source object's asset `VectorStyle` verbatim — `fill`, `stroke`,
   `strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `strokeDasharray`, `strokeDashoffset`,
   `fillGradient`, `strokeGradient`. NOT captured: object-level animation (`colorTracks`,
   `gradientTracks`, `dashOffsetTrack`, `trim`) and `tint` — style ≠ animation.
2. **Paste is WYSIWYG, one undo step:** pasting sets the target's asset style to the captured
   style AND clears the target's `colorTracks`/`gradientTracks`/`dashOffsetTrack` (an animated
   fill would otherwise override the pasted static fill and the paste would look like a no-op).
   Precedent: `setVectorGradient(undefined)` already clears static+track together. `trim` is left
   untouched (it's shape animation, not paint). Because pasting a dash pattern onto a trimmed
   object would create the both-set conflict, paste **skips `strokeDasharray`/`strokeDashoffset`
   when the target has `trim`** (dash-wins guard stays unreachable; hint semantics unchanged).
3. **Paste targets every selected vector object** (`selectedObjectIds`), skipping non-vectors
   (groups, instances, text, svg) silently; a paste that lands on zero vector targets is a no-op
   (no history entry). All routed through the active-scene seam.
4. **Eyedropper is one-shot and selection-preserving:** new `ToolMode 'eyedropper'` (chord `i`,
   Tools category, palette icon). With a selection, clicking a vector object on the Stage applies
   that object's style to the selection using the exact paste semantics above, then reverts
   `activeTool` to `'select'`. Clicking empty canvas or a non-vector reverts the tool without a
   commit. With no selection, the click COPIES the clicked object's style to the style clipboard
   (so eyedropper→click→select target→paste also works), then reverts.
5. **Pixel pick lives in the Inspector, not the tool:** "pick" buttons beside the fill and stroke
   inputs call `new window.EyeDropper().open()` and commit the sRGBHex via the existing
   autoKey-aware `setVectorColor(property, value)`. Buttons render only when
   `'EyeDropper' in window` (feature-detect; hidden in Firefox/Safari/jsdom). AbortError
   (user-cancelled pick) is swallowed. This avoids a second stage mode and keeps the risky API at
   one seam.
6. **Style clipboard is transient store state** (`styleClipboard: VectorStyle | null`), like
   `keyframeClipboard`: not serialized, not in history, deep-copied on capture so later edits to
   the source don't mutate it.

## Model / store (packages/editor-state)

- `styleClipboard: VectorStyle | null` in transient state (reset defaults; NOT in
  NO_KEYFRAME_SELECTION — it's a clipboard, not a selection).
- `copyStyle(): void` — captures from the single `selectedObjectId`'s vector asset
  (`structuredClone` the style); no-op for non-vector.
- `pasteStyle(): void` — decision-2/3 semantics; one `commit` covering all touched assets+objects.
- `applyStyleFrom(sourceObjectId: string): void` — eyedropper core: capture from source, then
  paste-to-selection in ONE commit (or copy-only when selection is empty, per decision 4). Shared
  helper with copy/paste so the semantics can't drift.

## UI (apps/react + ui-core)

- Registry commands: `edit.copyStyle` (`mod+alt+c`, when: single vector selected),
  `edit.pasteStyle` (`mod+alt+v`, when: `styleClipboard` && selection), `tool.eyedropper`
  (`i`, via the existing `tool()` helper). Chord matcher already supports `alt`.
- ToolPalette: eyedropper entry + icon in `ToolbarIcons.tsx`.
- Stage: in the object pointer-press path, `activeTool === 'eyedropper'` → `applyStyleFrom(id)` +
  `setActiveTool('select')`; empty-canvas press with eyedropper → revert tool only. No drag
  behavior, no marquee.
- Inspector: pick buttons (`aria-label="pick fill color"` / `"pick stroke color"`) beside the
  existing fill/stroke inputs; render gated on feature detection; commit via `setVectorColor`.

## Testing

- Store unit (`store.style.test.ts`): capture contents incl. deep-copy isolation; paste multi-select
  (vector + group mixed → only vector restyled); WYSIWYG track clearing; trim-target skips dash
  fields; zero-target paste adds no history entry; applyStyleFrom both modes (selection /
  no-selection→clipboard); single-undo restores everything; symbol-scope routing.
- Component: Inspector pick buttons hidden without `window.EyeDropper`, shown + commit path with a
  stubbed `EyeDropper` (resolve `{ sRGBHex: '#123456' }` → `setVectorColor` effect asserted);
  AbortError swallowed.
- E2E (`e2e/style-tools.spec.ts`): draw two rects with different fills → copy style on A
  (palette command) → select B → paste style → B's stage shape fill attribute equals A's. Eyedropper:
  select B, press `i`, click A → B restyled and tool back to select (toolbar aria-pressed).
- Registry integrity test updates (mutually-exclusive chords: `mod+alt+c/v` don't collide with
  `mod+c/v` because alt participates in matching).

## Out of scope

Pasting onto text assets; style clipboard persistence across sessions; partial paste (fill-only);
eyedropper sampling of gradients at a pixel (object-pick carries gradients already); DSL/MCP layer
(pure editor ergonomics — agents already have `set_*` style tools via core builders).
