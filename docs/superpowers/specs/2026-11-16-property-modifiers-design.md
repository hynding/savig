# Property modifiers (wiggle, loop, ping-pong) — design

Roadmap 6, item 2. Procedural motion on a property with no hand-placed keys.

## Model
`SceneObject.modifiers?: Partial<Record<AnimatableProperty, PropertyModifier>>` with
`PropertyModifier = { wiggle?: { amplitude, frequency, seed? }; loop?: 'cycle' | 'pingpong' }`.
Modifiable properties: x, y, scaleX, scaleY, rotation, opacity, width, height, radiusX, radiusY,
cornerRadius (`MODIFIABLE_PROPERTIES`). Absent = no modifiers (byte-identical output).

- **Loop** remaps time after the last key: `cycle` restarts the first..last key span, `pingpong`
  plays it back and forth. Before the first key the curve holds as usual. Needs two keys at
  different times (validate warns otherwise).
- **Wiggle** adds `amplitude · noise(time · frequency)` on top of the keyed (and looped) value or the
  static base. Noise is Catmull-Rom through hashed lattice values (continuous, continuous slope,
  clamped to ±1), seeded by `seed` and salted by property name so x and y differ.

## Where it applies
Inside `sampleObject`, so the editor Stage, the HTML runtime (bundle regenerated), SMIL/CSS
animated SVG, Lottie, PNG/GIF raster and video all play modifiers with no exporter changes. The
exporters sample per frame over the project duration; modifiers do not extend an auto duration
(a keyless wiggle needs a manual duration or other animation).

## Editing
`applyObjectTransform` (the single writer for drags, nudges and Inspector fields) subtracts the
wiggle at the playhead, so a value the user sets by eye lands where they put it and the wiggle keeps
riding on top.

## Surfaces
- Slice 1: engine (`modifiers.ts`), load sanitizer, `validateProject` (`modifier-invalid`,
  `modifier-loop-no-keys`), `describe`, DSL `modifiers` field (round-trips), core `setModifier`,
  MCP `set_modifier`, export tests.
- Slice 2: Inspector "Modifiers" section (add per property, wiggle amount / speed / seed, loop
  mode, remove), store verbs with undo, timeline badge, e2e.
