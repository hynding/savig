# Add-Text Tool + Text Selection Bbox — Design

**Date:** 2026-07-11 · **Status:** Approved (follow-ups batch 3; decisions documented per the
pre-approved autonomous follow-up flow) · **Goal source:** program follow-up backlog — "add-text
tool + text bbox to make text-on-path user-reachable."

## Goal

Let a user CREATE a text object in the editor (today text exists only via DSL/MCP) and interact
with it as a first-class object — select, marquee-select, move, edit its content/style, and bind it
to a path (text-on-path) — all without touching a config file. Scope is bounded by that goal:
"reachable," not "full rich-text."

## Decisions (with rationale)

1. **Click-to-place, one-shot tool** (not drag-to-size). A new `'text'` `ToolMode`; a single click on
   the canvas creates a text object at that point and reverts to `select` (the eyedropper one-shot
   precedent, NOT the rect/line drag-to-size precedent). Rationale: a text box is defined by glyph
   metrics, not a user-dragged rectangle. Default content `"Text"`, `createTextAsset` defaults
   (fontSize 48, fill #000000). Registered everywhere the tool chain requires: `ToolMode` union,
   `SYMBOL_EDIT_TOOLS` (so text is creatable inside a symbol edit scope), `ToolPalette` entry + a
   `text` glyph in `ToolbarIcons`, and command `tool('tool.text', 'Text tool', 'text', 't')` (`t`
   is free).
2. **Text stays `anchorMode: 'absolute'`** (as `addText`/`createTextAsset` already seed). Consequence:
   the engine's `resolveAnchor` short-circuits on the non-fraction branch and never needs glyph
   geometry; the runtime and export/raster (resvg lays out text internally — proven by existing
   render tests) are entirely unaffected. **Text metrics are an EDITOR-CHROME-ONLY concern.** No
   engine/runtime/services/bundle change is needed for text to render — it already does, generically.
3. **Editor bbox via a pure font-metrics ESTIMATE, not live getBBox plumbing** (the key fork). Add a
   pure `estimateTextBox(content, fontSize, textAnchor): LocalRect` in `packages/interaction` and a
   text branch to `resolveObjectAnchor` (snapping.ts) that returns it. Rationale: `resolveObjectAnchor`
   is called from `ui-core`'s marquee controller (which has NO DOM access) and from Stage overlays; a
   pure estimate keeps `interaction` DOM-free and fully unit-testable, needs zero measured-box
   plumbing, and is adequate because (a) the browser-computed CSS dashed outline on the selected
   `<text>` is pixel-accurate regardless, and (b) the estimate only drives marquee-hit / snap-target /
   align math where approximate bounds are fine. Model: width ≈ Σ per-char advance (a simple
   monospace-ish ratio × fontSize, e.g. 0.6), height ≈ fontSize, x-offset by `textAnchor`
   (start/middle/end), y from `dominant-baseline: text-before-edge` (top-left origin, matching the
   render). **Measured-getBBox refinement is explicit BACKLOG.** Adding the one `resolveObjectAnchor`
   branch lights up `objectAABB`/`entityAABB` → marquee select, snap targets, align/distribute, and
   multi-select group bbox for free (all generic dispatchers, none special-case-exclude text).
4. **v1 interaction scope: select / marquee / move / content-edit / bind.** Text objects get NO
   resize/rotate/scale transform HANDLES in v1 — those overlays (`selectedVector`/`selectedRotatable`/
   `selectedScalable`) have their own per-kind gates and would each need a text branch plus a
   fontSize-vs-transform-scale semantics decision (does dragging a scale handle change `fontSize` or
   apply `scaleX`?). Deferred to backlog. Move-drag already works (id-based, not bbox-based). Click and
   marquee selection work via Decision 3.
5. **Inspector text panel** (new, gated `asset.kind === 'text'`, slotted immediately before the
   existing Text-on-Path block which shares the same gate): edit `content` (text input), `fontSize`
   (NumberField, min 1), `fill` (color), `fontFamily` (text input, optional), `textAnchor` (select
   start/middle/end). Backed by store actions on the active-scene-routed asset, each **lock-gated
   FIRST** (mutating-action rule) — a single `setTextAssetFields(patch: Partial<TextAsset fields>)`
   or per-field setters (implementer's choice; one lock-gated commit per edit). VM exposes the current
   field values in a new `InspectorTextVM`.
6. **Out of scope (backlog):** measured-getBBox precise bounds; resize/rotate/scale handles for text
   (+ the fontSize-vs-scale decision); multiline/wrapped text; web-font loading/embedding; per-glyph
   styling; rich text; a DSL/MCP change (agents already have `add_text`/`addText`).

## Testing

- Interaction unit: `estimateTextBox` (width scales with content length + fontSize; textAnchor
  start/middle/end shift x; empty content → zero/минimal width; height = fontSize). `resolveObjectAnchor`
  returns a box for a text asset (was null); `objectAABB`/`entityAABB` non-null for text; parity —
  non-text kinds unchanged.
- Store unit: `addTextObject(x, y)` creates asset+object (absolute anchor, base at click point,
  default content), selects it, reverts `activeTool` to select, one commit, active-scene routed
  (in-symbol); text field setters mutate the asset, lock-gated (locked → no commit + toast), one
  commit each, autoKey-irrelevant (content/style are static asset fields). Marquee now includes a text
  object whose box intersects the rect (controller test).
- VM/component: `InspectorTextVM` exposes content/fontSize/fill/fontFamily/textAnchor; the Inspector
  text panel renders for a text object, edits dispatch the setters; panel absent for non-text.
- Component (Stage): Text tool active + background click → a text object exists and is selected;
  tool reverted to select.
- E2E (`e2e/text-tool.spec.ts`): select the Text tool (aria-label "Text"), click the canvas → a
  `<text>` appears on the stage and the Inspector shows the content field (selection proof) with
  Select re-pressed; edit content → stage text updates; draw a path, bind via the Text-on-Path
  select → `<textPath>` appears (this is the end-to-end "text-on-path now user-reachable" proof).
  Full gates + @portable.
