# Paint bucket and eraser — design

Roadmap 4, item 2 (Steve approved 2026-11-15). Two vector painting tools that work on the
ink the user sees, not on path data they would otherwise have to edit node by node.

## Paint bucket (slice 1)

**Tool.** `bucket`, key **K**, palette entry "Paint Bucket". The options bar shows one colour
input ("Bucket color", default `#ff9933`). The tool stays active between clicks so several
regions can be filled in a row. Allowed while editing a symbol.

**What a click does** (`paintBucketTarget` in `engine/geom/paintBucket.ts`):

1. Candidates are the vector leaves of the active scene as `flattenInstances` draws them at the
   playhead: hidden objects, guides, mask content, live boolean results, symbol internals and
   repeater copies are left out (an instance or image is not vector ink).
2. Each candidate's world-space ink is two multipolygons: its fill (outline plus compound rings,
   even-odd) and its stroke outline (`outlineStroke`, independent of the fill so a two-point
   line still counts).
3. Walking from the top, a stroke hit means the click is on a line: nothing is filled and a toast
   says to click inside an area. The first fill hit is the target shape T.
4. The ink drawn above T is unioned. The free area is a padded bounding box minus that ink,
   clipped to T's fill when there is a T. The piece holding the click is the region.
5. No T and the region reaches the padded box edge: the area is open (toast, no edit).
6. The region is (within 0.5%) all of T's fill: nothing cuts T, so **T is recoloured**.
   Otherwise the region becomes **a new fill shape**.

**Recolour.** With auto-key on (or when the fill is already animated) the colour is keyed at
the playhead, like the Inspector's fill field; otherwise the static fill changes. A fill
gradient (static or animated) is cleared, since the bucket paints a solid colour. If another
object shares T's asset, the asset is forked first so only the clicked shape changes.

**New fill.** A path asset (`fill` = bucket colour, no stroke) whose rings are the region,
placed as T's sibling just above T (same group and frame key, mapped into the group's space),
or at the bottom of the scene when there is no T. Siblings at or above that slot move up one,
so the fill shows under the line art that closed it.

**Locked.** A locked T (or one inside a locked group) is refused with a toast.

**Agent surfaces.** Core `paintBucket(project, {x, y, color, time?, keyAt?, easing?, id?})`
returns `{project, kind: 'recolor' | 'fill', id}` and throws on a line, an open area, a locked
shape or a bad colour. MCP `paint_bucket` wraps it.

## Eraser (slice 2)

**Tool.** `eraser`, key **X**, with a size option. Dragging collects a polyline; on release it
is outlined with round caps at the eraser size and subtracted from every unlocked vector leaf
it touches, in each object's local space. Stroke-only shapes are first converted to filled
outlines; rects and ellipses become paths; an object erased away completely is deleted.
Morphing (shape-keyed) objects are skipped with a toast. One undo step per drag. Core
`erase` and MCP `erase` take the polyline and size.

## Out of scope

Bitmap pixels (images are not erased or filled), gap tolerance for nearly closed line art, and
filling across symbol instances.
