# Rulers and guides — design

Roadmap 10, item 3. Flash/Animate show rulers along the Stage and let you drag guides out of them;
objects snap to the guides. SaViG had snapping to objects, the artboard and a grid, but no rulers
and no guides you place yourself.

## Model
- `Project.guides?: RulerGuide[]`, where `RulerGuide { axis: 'x' | 'y'; pos }`. Axis `x` is a
  vertical line at x = pos, axis `y` a horizontal line at y = pos, in root Stage pixels (whole
  numbers). Absent = none (parity). Guides are editor chrome: saved with the project, never drawn
  by any export.
- Load: `sanitizeGuides` drops malformed entries and rounds positions.
- View prefs in the store (persistent, not undoable): `rulersVisible` (off), `guidesVisible` (on),
  `guidesLocked` (off).

## Store (`slices/guidesSlice.ts`)
- `addGuide(axis, pos)`, `moveGuide(index, pos)`, `removeGuide(index)`, `clearGuides()`: each one
  undo step; a no-op commits nothing. Moving and removing are refused while guides are locked.
  Adding a guide while guides are hidden shows them again.
- `toggleRulers`, `toggleGuides`, `toggleGuidesLocked`.

## Stage (slice 1)
- `StageRulers` draws the rulers (18px, top and left; the Stage pads itself while they show) and
  an overlay with the guides above the Stage `<svg>`, so guides stay one pixel wide at any zoom.
  The overlay maps Stage units with the same fit the `<svg>` uses (`viewBox` meet, then pan and
  zoom; `rulerMath.ts`).
- Drag down from the top ruler for a horizontal guide, right from the left ruler for a vertical
  one. With the Select tool, drag a guide to move it; drop it off the Stage (back on a ruler) to
  remove it. Escape cancels a guide drag. Locked guides can't be grabbed.
- Guides show only at the root Stage (not while editing a symbol) and not in preview mode.

## Snapping (slice 1)
- `guideSnapTargets(guides)` turns guides into snap targets: a box that is degenerate on the
  guide's axis and NaN on the other, so `computeSnap` snaps edges and centres to the line on that
  axis only and equal-spacing snap never matches it.
- The Stage adds them to every move, scale, resize and node-drag snap (`stageFrameTargets`) while
  guides show at the root. Snapping still follows the Snap toggle, and Cmd/Ctrl still bypasses it.

## Commands
- View: Toggle rulers (Ctrl+Alt+Shift+R), Toggle guides (Ctrl+;), Lock guides, Clear guides.

## Slice 2
- Double-click a guide (Select tool, unlocked) to type its exact position: Enter or leaving the
  field applies it (one undo step), Escape cancels. A guide drag changes nothing until the pointer
  moves, so clicks and double-clicks leave the guide where it is.
- Headless core `addGuide(project, axis, pos)`, `setGuides(project, guides)`, `clearGuides(project)`
  (positions rounded, bad guides throw); describe prints `Guides: x=100, y=50`; MCP `set_guides`
  replaces the list.
