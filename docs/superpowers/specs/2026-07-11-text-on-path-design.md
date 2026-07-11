# Text on Path — Design

**Date:** 2026-07-11 · **Status:** Approved (program roadmap #8; decisions documented per pre-approved
autonomous flow) · **Roadmap:** docs/superpowers/specs/2026-07-10-art-tools-roadmap.md

## Goal

Bind a text object to a path object: the text renders along the path via native `<textPath>`, with
an animatable, pathLength-normalized `startOffset` (marquee/orbit text). The binding follows the
path's LIVE geometry (transform animation, morphs, animated primitive params).

## Decisions (with rationale)

1. **Model:** on the TEXT SceneObject: `textPath?: { pathObjectId: string; startOffset: number }`
   (parity-safe optional; absent = today's plain `<text>` byte-identical). The ANIMATED offset
   rides the generic tracks as a new `AnimatableProperty` member **`'textPathOffset'`**
   (primitives precedent — keyframe ops, timeline scalar row, duration, DSL `animate`, MCP
   `set_keyframe`, and the autoKey-aware `setProperty` all come free; sampling happens at a custom
   seam, not the generic transform loop). Static base = `textPath.startOffset`; track wins.
2. **Coordinate space — world-space def, not a live-element reference:** `<textPath href>`
   semantics w.r.t. the referenced element's transform are murky/browser-variant, and referencing
   the bound path's live element would also inherit its clip/tint wrapper effects. Instead each
   bound text emits its OWN hidden def: `<path id="savig-textpath-<renderId>" d="<worldD>"
   pathLength="1"/>` where `worldD` = the bound path's current-frame PathData mapped through its
   full composed transform chain into scene coordinates (mapPoint machinery). The `<text>` then
   renders with NO own transform (identity `<g>`): glyphs land in scene space along the world
   path — unambiguous, no double-transform, no interference with the bound object's own
   render (its dash/trim `pathLength` semantics untouched — OUR def carries its own
   `pathLength="1"`, making bare-number `startOffset` 0..1).
   **The bound text's OWN base/tracked transform is IGNORED while bound** (motionPath's
   override precedent; documented in the Inspector hint). Detaching restores it.
3. **Cross-object resolution at the project-scope seams** (boolean-operand precedent — NOT inside
   `sampleObject`): `computeFrameForScene` and `renderLeaf` (both hold the scene project) resolve
   `pathObjectId` → the path object's sampled state → `worldD` + interpolated
   `textPathOffset`. New shared engine helper
   `resolveTextPath(project, textObj, time): { worldD: string; startOffset: number } | null`
   (null = dangling/ineligible → plain-text fallback, boolean lazy-degradation precedent; NO
   eager pruning, NO deletion blocking).
4. **Per-frame plumbing:** `FrameItem` gains `textPathD?: string` and `textPathStartOffset?:
   string` (present only when bound); the initial markup emits the def + `<text><textPath
   href startOffset>` structure; `applyFrameToNodes` updates the def's `d` (by id lookup, gradient-
   def precedent) and the `<textPath>`'s `startOffset`. Editor Stage renders the same structure in
   JSX driven by the same helper. Raster/thumbnails inherit the markup; **resvg `<textPath>`
   support is smoke-tested in Task 1 — if unsupported, raster shows plain text at the anchor and
   this ships as a documented limitation** (raster text is already approximate).
5. **Eligibility & binding UX:** bind targets = vector `shapeType: 'path'` objects in the active
   scene (not self-referential — text can't be a path; no cycle risk). Inspector (text objects):
   "Attach to path" `<select>` (swapTargets precedent: VM `pathTargets: {id, name}[]`), a
   `startOffset` NumberField (autoKey-aware via the generic `setProperty('textPathOffset', v)` —
   VERIFY setProperty accepts non-transform members post-primitives; else a thin dedicated
   setter), and a "Detach" button. Store: `bindTextPath(pathObjectId)` /
   `unbindTextPath()` (unbind also strips the `textPathOffset` track — orphan-track duration
   precedent). Gates: selected object is text; target resolves to an eligible path; active-scene
   routed.
6. **Selection/bbox:** text objects already have NO bbox (pre-existing: resolveObjectAnchor
   returns null for text — marquee/snap/align already no-op). Bound text inherits that; the
   only affordance is Layers-panel selection + Inspector. Documented limitation, no new chrome v1.
7. **Out of scope:** text metrics/bbox; side/method/spacing attributes; per-glyph effects;
   binding to rects/ellipses (path only); DSL field for the binding itself (the OFFSET animates
   via the generic DSL `animate.textPathOffset`; the binding is editor UX — agents get a
   `bind_text_path` MCP tool though, cheap and symmetric with swap_symbol if one exists — CHECK;
   if no swap MCP precedent, skip MCP too and document).

## Testing

- Engine unit: `resolveTextPath` (bound → worldD matches hand-transformed nodes + offset
  track-wins; dangling id → null; non-path target → null; morphing bound path → worldD changes
  with time; transform-animated bound path → worldD follows). Duration: `textPathOffset` track
  extends (generic loop pin). Parity: absent binding → renderLeaf/computeFrame output
  byte-identical.
- Runtime unit: FrameItem fields present only when bound; applyFrameToNodes updates def d +
  startOffset (jsdom fixture with the emitted structure).
- Static export: def + textPath structure emitted; ids unique per renderId; fallback markup on
  dangling ref. resvg smoke: rasterize a bound-text doc — record support verdict.
- Store unit: bind/unbind gates + track strip; setProperty('textPathOffset') autoKey path (or the
  dedicated setter); in-symbol scope.
- Component: Inspector picker lists eligible paths only; bind/detach round-trip; offset field
  commits.
- E2E (`e2e/text-on-path.spec.ts`): add text (how does the editor add text? find the flow), draw a
  path, bind via Inspector → the stage text element contains a `<textPath>` whose href resolves;
  keyframe the offset (autoKey) at two playheads → scrub → `startOffset` attribute differs.
  Full gates + @portable.
