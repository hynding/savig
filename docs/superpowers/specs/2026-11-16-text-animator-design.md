# Per-character text animation — design

Roadmap 7, item 2. Letters (or words) of a text object animate one after another: typewriter,
fade up, drop in, scatter, fade out.

## Model
`SceneObject.textAnimator?: TextAnimator`, only meaningful on a text object:

```ts
{ by: 'char' | 'word'; start; stagger; duration; easing?; order?: 'forward'|'reverse'|'center'|'random';
  seed?; direction?: 'in' | 'out'; from: { opacity?; dx?; dy?; rotation? } }
```

Units: `textUnits` splits characters by code point, or words keeping their trailing whitespace
(units always join back to the content). Unit `i` starts at `start + rank(i) * stagger` and eases
over `duration` (0 = snap) between `from` and rest (opacity 1, no offset, no rotation); `out`
reverses it. `rank` comes from `order` (`center` pairs units equally far from the middle;
`random` is seeded). Absent = one plain text run (byte-identical output).

Presets (`TEXT_ANIMATOR_PRESETS`): typewriter, fadeUp, dropIn, wordsUp, scatter, fadeOut.

## Rendering
One `<tspan data-savig-unit>` per unit. `dx`/`dy` on a tspan shift it and everything after it, so
the attributes carry the difference from the previous unit's offset; each unit ends up displaced by
exactly its own offset. `rotate` turns each glyph about its origin; opacity is `fill-opacity` +
`stroke-opacity`. `textAnimatorMarkup` (export string), Stage JSX and `applyFrameToNodes`
(`FrameItem.textUnits`) all write the same attrs from `sampleTextAnimator` + `textUnitAttrs`.
Works inside a bound `<textPath>` too.

## Exports
Raster (PNG/GIF/video) and HTML runtime follow the frame engine. SMIL animates each tspan's
dx/dy/rotate/fill-opacity/stroke-opacity. CSS animates fill-/stroke-opacity; dx/dy/rotate are not
CSS properties on a tspan, so they hold the LAST frame (the settled pose). Lottie already leaves
text out (warning).

## Duration
`computeProjectDuration` (root, automatic mode) extends to the animator's end. v1 limit: a text
animator inside a symbol does not extend the symbol's intrinsic duration.

## Surfaces
- Slice 1: engine (`textAnimator.ts`), Stage/runtime/renderDocument/SMIL/CSS, sanitizer, validate
  (`text-animator-invalid`, `text-animator-not-text`), describe, DSL `textAnimation` on text
  (preset or full animator; round-trips), core `setTextAnimation`, MCP `set_text_animation`.
- Slice 2: Inspector "Text animation" section on text (preset picker, by/order/direction, start /
  stagger / duration / easing, from fields, remove), e2e.
