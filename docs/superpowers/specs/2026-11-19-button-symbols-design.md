# Button symbols — design

Roadmap 10, item 1. Flash/Animate buttons are symbols with four frames: Up, Over, Down and Hit.
SaViG had clip symbols and an interactive session (pointer behaviors, preview mode, the exported
runtime), but no way for a symbol to react to the pointer by itself.

## Model
- `SymbolAsset.button?: true` makes a symbol a button. Absent = an ordinary clip symbol (parity).
- `SceneObject.buttonStates?: ButtonState[]` (`'up' | 'over' | 'down' | 'hit'`) on an object inside
  a button symbol picks the states it shows in. A group's states cover its subtree; an object's own
  states win over its group's. Absent = Up, Over and Down (`DEFAULT_BUTTON_STATES`).
- States are tags on objects, not frames: the symbol keeps one time-based timeline, so content in
  any state can still animate (an Over glow can pulse).
- **Hit** content is never drawn: when its state isn't showing it renders at zero opacity, so it
  still catches the pointer and widens the clickable area. v1 keeps visible content clickable too
  (the hit area is visible content plus hit shapes), unlike Flash where only the Hit frame counts.

## Rendering (slice 1)
- `flattenInstances(project, t, { buttonStates })`: inside a button instance each object resolves
  `buttonVisibility(states, current)`: shown, hit (opacity factor 0) or hidden (`exposed: false`).
  Exposure inside a button is always explicit (`true`/`false`) so a painter writes `visible` back
  when a state returns. The skeleton (set of leaves) is the same in every state. Leaves carry
  `buttonOf` (the innermost button instance's render id).
- The current state comes from the caller, keyed by instance render id; unlisted = Up. Every static
  render and export passes nothing, so SVG/raster/GIF/video/Lottie/CSS show the Up state.
- `computeFrame` / `applyProjectFrame` take `FrameOptions { buttonStates }`.
- A button symbol is never `isStaticSymbol`, so exports never collapse it into a shared `<use>`.

## Interaction (slice 1)
- `InteractiveSession.buttonStates()`: for each button instance (`buttonInstanceIds`, top-level
  instances in any scene), Over while it is in the hover chain, Down while hovered and pressed.
  `pointerdown` records pressed buttons, `pointerup` (anywhere) clears them; dragging a press off
  the button shows Up until the pointer returns (Flash's default). State changes fire `onChange`.
- The exported runtime arms the session when any button instance exists (not only with behaviors),
  passes the states to every frame, listens for `pointerup` on the document, and gives button
  leaves `cursor: pointer`. The editor preview does the same through `applyFrame`.
- v1 limit: a button nested inside another symbol stays in Up (pointer chains collapse to the
  outermost instance).

## Authoring (slice 1)
- Inspector, symbol instance panel: a **button** checkbox (`setSymbolButton`, one undo step).
- Inspector, inside a button symbol: **Button states** checkboxes Up / Over / Down / Hit for the
  selected object or group (`setButtonStates`, normalized; the default set clears the field).

## Slice 2: author buttons on the Stage
- **Create Button** (Inspector, single and multi panels) and the palette command
  `arrange.createButton` ("Convert to button"): `createSymbol({ button: true })` names the symbol
  and instance "Button"; members keep the default Up/Over/Down states.
- While editing a button, the edit breadcrumb carries a state strip (All / Up / Over / Down / Hit,
  `button-state-strip`). It sets the transient `buttonPreviewState` (cleared on entering or leaving
  a symbol; ignored outside a button). The editor's `applyFrame` passes
  `rootButtonState: buttonPreviewState ?? 'all'` whenever the edited symbol is a button, so the
  root list paints as button content: Up/Over/Down show that state, Hit shows only the hit shapes
  (drawn normally so you can see the area), All shows everything with explicit exposure.
- The library marks button symbols with a "button" badge.

## Slice 3: agents and files
- core `setSymbolButton` / `setButtonStates`, DSL `button` symbols and `states:`, describe,
  validate (`button-state-unknown`, states outside a button), MCP `set_button_states`.
