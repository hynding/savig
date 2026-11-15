# Blend modes — design

Roadmap 4, item 3 (Steve approved 2026-11-15). Flash-style layer blend modes for any object.

## Model

`SceneObject.blendMode?: BlendMode`, one of the CSS/SVG `mix-blend-mode` values: multiply,
screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference,
exclusion, hue, saturation, color, luminosity. Absent means normal; 'normal' is never stored.
Static (not animatable), like Flash's. On a group, the subtree is composited first and the
result blended as one; on a symbol instance's internals it applies per instance.

No format bump (like mask modes): an older build draws a blended object normally. The loader's
`sanitizeBlend` drops any value that is not a known mode, so nothing unknown reaches a `style`.

## Rendering

Blend is one more wrapper kind in the shared wrap chain that masks and filters use
(`WrapRef { kind: 'blend', id: savig-blend-<path>, mode }`). Per node the order is, outermost
first: blend, mask, filter — CSS order for one element (filter, then mask, then blend with the
backdrop). Every renderer that walks wrap chains writes `<g style="mix-blend-mode:…">` around
the run: the Stage, the static/animated/CSS SVG exports (`WrapperStack`), the HTML bundle and
the resvg raster (PNG/GIF/video/thumbnails). Projects without blend or filters keep identical
leaves (the wrap chain is only kept when a filter or blend is in it).

## Editor (slice 1)

Inspector "Blend" dropdown (aria-label "Blend mode") on objects and groups; store
`setBlendMode(mode | null, ids?)`, one undo step, locked objects skipped.

## Agent surfaces (slice 2)

DSL `blend` field on any object or frame layer (the DSL has no plain groups; `set_blend_mode`
takes group ids), 'normal' accepted and not stored; describe prints `blend=<mode>`; validate
errors on an unknown mode (`blend-unknown`) and warns on a blend inside mask content
(`blend-in-mask`, no effect there); core `setBlendMode(project, ids, mode | 'normal' | null)`;
MCP `set_blend_mode`.
