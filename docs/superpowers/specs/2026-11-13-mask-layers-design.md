# Mask Layers — Design

**Date:** 2026-11-13
**Status:** approved for slicing (next studio feature after frame-by-frame)

## Goal

Flash/Animate's **mask layer**: a shape (or group, or symbol instance) that is not drawn itself but
whose filled area *reveals* the objects linked beneath it. Animate the mask and you get the classic
reveals, wipes, spotlights, "text filling in", iris transitions. Nothing in SaViG does this today
(symbol `clip` only clips a symbol to its own content box).

What a user can do when this ships:

1. Select a shape and some objects below it → **Create Mask** (Ctrl/⌘+Alt+M). The topmost selected
   object becomes the mask; the rest become masked by it.
2. Animate the mask like any object (move, scale, morph, frame-by-frame) — the reveal follows.
3. See the mask outline on the Stage (editor-only ghost, like live-boolean operand ghosts) so it can
   be selected and dragged even though it isn't drawn.
4. Hide the mask (eye toggle) → its objects show unmasked. **Release Mask** unlinks everything.
5. Export: animated SVG (runtime and SMIL), raster/GIF/video and the MCP `render_frame` all show the
   same thing the Stage does.
6. An agent can do all of it through the DSL / MCP / a `reveal` macro.

## Approach decision

| Option | Verdict |
|---|---|
| **A. Explicit link: `isMask` on the mask object, `maskedBy` on each masked object** | ✅ Chosen. Works for leaves, groups (incl. frame layers) and symbol instances on either side; matches Flash's "linked layers" and Illustrator's clipping-mask mental model; no z-order inference. |
| B. Implicit: a mask masks every object below it until the next mask | Rejected: reordering silently changes masking; hard to reason about inside groups/symbols. |
| C. "Mask group": a group whose first child is the mask | Rejected: forces regrouping (breaks existing animation on the masked objects' parents) and can't mask objects that live in different groups. |

**SVG primitive:** `<mask maskUnits="userSpaceOnUse" mask-type="alpha">` (the presentation attribute: resvg ignores the `style` form). Alpha (not luminance)
because Flash masks use the shape's *area*, ignoring its color. A bonus: gradient stops with opacity
and `opacity` on the mask give soft-edged masks for free.

## Model (engine `types.ts`)

```ts
interface SceneObject {
  /** This object is a MASK: it is never drawn; its rendered area (alpha) reveals every object whose
   *  `maskedBy` names it. Leaf, group (whole subtree is mask content) or symbol instance. */
  isMask?: boolean;
  /** Id of an `isMask` object in the SAME scene list (root scene, a Scene, or a symbol's objects)
   *  that masks this object — for a group container, its whole subtree. */
  maskedBy?: string;
}
```

Rules (all enforced at render time; `validate` warns, never throws):

- A `maskedBy` is **honoured** iff the target exists in the same object list, has `isMask`, is not
  render-hidden (self or ancestor group hidden), and is not the object itself / one of its ancestors.
  Otherwise the object renders **unmasked** (graceful, like a dangling `frameKeyId`).
- Masks **stack** through the hierarchy: a group masked by M1 containing a child masked by M2 gives
  the child the chain `[M1, M2]` (outermost first). A masked symbol instance's internals can carry
  their own masks; the instance's mask wraps outside them.
- **Mask content** = the leaves of the `isMask` object's subtree (the topmost `isMask` in the chain
  names the mask). Content leaves ignore their own `maskedBy` and any clip/tint context (v1).
- An empty mask (e.g. an unexposed frame-layer key, or a fully transparent fill) hides its objects
  completely — that is correct mask semantics, not a bug.
- A mask with no masked objects is still not drawn (editor shows its ghost).

## Engine

`flattenInstances` stays the single walker. Two new optional `InstanceLeaf` fields:

- `maskChain?: string[]` — def ids of the masks applying to a drawn leaf, outermost first.
- `maskOf?: string` — present on a **mask-content** leaf: the def id of the mask it draws into.

Def id = `savig-mask-<renderPrefix><maskObjectId>` (the instance path keeps two instances of one
symbol with internal masks distinct). Mask-content leaves are still full leaves (same transform,
opacity, exposure, localTime) so `computeFrame` animates them exactly like body leaves — the runtime,
SMIL sampler and raster baker all find them by `data-savig-object`, wherever they sit in the DOM.

Parity: a project with no `isMask`/`maskedBy` anywhere produces leaves with neither field →
byte-identical output.

New `packages/engine/src/mask.ts`: `resolveMaskTarget(obj, objectsById)` (the honoured `isMask`
object or null), `maskContentRoot(obj, objectsById)` (topmost `isMask` in the ancestor chain or
null), `maskDefId(prefix, maskId)`.

## Render & export (one seam, every target)

- `renderSceneBody` routes `maskOf` leaves into `<mask id=… maskUnits="userSpaceOnUse"
  x/y/width/height="huge" mask-type="alpha">…</mask>` defs (rendered with the same
  `renderLeaf`, so ids/gradients/textPaths behave), and wraps drawn leaves in
  `<g mask="url(#id)">` runs. Mask wrappers sit **outside** the existing tint/clip wrappers
  (alpha multiplications commute, so order is visually irrelevant). Runs are emitted with a small
  open-wrapper stack so nested chains nest correctly and non-contiguous objects simply reference the
  same mask twice.
- The static-symbol `<use>` optimization skips masked instances and symbols that contain masks.
- Multi-scene: mask def ids get the `"<sceneId>:"` prefix like clip/tint ids.
- Stage (React) renders the same mask defs (JSX, never innerHTML) and the same wrapper runs, so
  preview == export.
- Runtime / SMIL / raster: no new code paths beyond the above — mask content carries
  `data-savig-object` and is updated/sampled like any other node. Tests prove each.
- resvg supports `<mask>` + `mask-type`, so raster/GIF/video are faithful.

## Editor (slice 2)

- Store: `createMask()` (topmost selected → `isMask`; others → `maskedBy`; one undo step; refuses if
  < 2 selected or the would-be mask is locked), `releaseMask(maskId)` (clears `isMask` and every
  `maskedBy` pointing at it), `setMaskedBy(objectId, maskId | null)`, `toggleIsMask(id)`. All
  scene/symbol-scope aware (active scene objects, like the FBF verbs).
- Stage: mask ghosts — a dashed accent outline of each mask's content (world space, current frame);
  clickable to select; dragging moves the mask (the reveal follows live). Selection outline/handles
  work on a selected mask like any object.
- Layers panel: mask rows get a mask icon; masked rows are indented under their mask with a link
  glyph; context menu / inspector buttons "Create mask", "Release mask", "Unmask".
- Inspector: for a masked object, a "Masked by ⟨name⟩" row with an Unmask button; for a mask, the
  count of masked objects and Release.
- Commands: `mask.create` (Ctrl/⌘+Alt+M), `mask.release`, palette entries, shortcuts sheet.

## DSL / MCP / macros (slice 3)

- DSL: `mask: true` on an object, `maskedBy: "<id>"`.
- MCP: `create_mask { maskId, targetIds }`, `release_mask { maskId }`; `describe` lists masks and
  their targets.
- Macro `reveal({ targetIds, shape: 'wipe-left' | 'wipe-up' | 'iris' | 'spotlight', start, duration })`
  builds an animated mask in one call.
- Template: "Text wipe reveal" in the gallery.

## Persistence

Format **v9** (stamp-only migration from v8; old files have neither key). The bump makes older builds
refuse a v9 file rather than draw masks as ordinary visible shapes. Load-time sanitize drops a
non-string `maskedBy` and a non-boolean `isMask`.

## Testing

- Engine: chain resolution (dangling, not-a-mask, hidden mask, self, ancestor), group masks, stacked
  masks, masked instance + inner masks, mask-content leaves (group mask, FBF mask), parity (no
  fields → identical leaves).
- Render: mask def + wrapper markup, nested wrappers, non-contiguous targets, multi-scene prefixing,
  static-symbol optimization bypass, escaping of ids.
- Runtime/SMIL/raster: mask content animates (runtime attr update, SMIL `<animateTransform>` lands
  inside the `<mask>`, PNG pixel test: revealed vs hidden pixel).
- Stage component test + Playwright e2e (slice 2): create, animate, hide, release, undo.

## Slices (each independently green)

1. **Model + engine + render seam**: types, `mask.ts`, `flattenInstances`, validate, migrate v9 +
   sanitize, `renderSceneBody`, Stage preview rendering, runtime/SMIL/raster proof tests.
2. **Editor**: store verbs, commands + shortcut, Stage ghosts, Layers panel, Inspector, e2e.
3. **Agent parity**: DSL, MCP tools, describe, `reveal` macro, template, INDEX.

## Deferred (explicitly out of scope)

- Luminance masks (`mask-type: luminance`) as an option.
- Masks referencing objects in another scene/symbol scope.
- Clip/tint applied to mask *content*; masking mask content (mask of a mask).
- Inverted masks ("reveal outside the shape").
