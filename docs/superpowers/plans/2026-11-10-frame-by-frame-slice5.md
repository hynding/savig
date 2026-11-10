# Frame-by-Frame — Slice 5 (Exports) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax; boxes are left unchecked in-file by convention.

**Goal:** Frame-by-frame animation plays in every export. The animated SVG (SMIL, script-free)
swaps drawings frame-exactly. Raster, GIF and video already follow through `computeFrame` and
`applyProjectFrame`, and now have tests that lock that in.

**Spec:** `docs/superpowers/specs/2026-11-07-frame-by-frame-design.md`, §Render & export and
§Testing (Export).

## Global constraints
- Objects outside frame layers emit nothing new, so the output is byte-identical for projects
  without frame layers.
- Visibility uses the shared discrete `keyTimes` grid (`discreteAttrs`), so each swap lands
  exactly on its frame.

### Task 1: SMIL visibility (`packages/services/src/export/animatedSvg.ts`)
- [ ] `frameLayerVisibility(frames, objectId)` returns the per-sample `visibility` series. It is
      null when the object is not frame-controlled or the series is constant.
- [ ] Each frame-layer leaf wrapper gets one `<animate attributeName="visibility"
      calcMode="discrete">`. Leaves inside a symbol instance in a key toggle too, because they
      carry `exposed`.
- [ ] **End hold.** The final sample sits exactly at the timeline's end, and a key's half-open
      span `[start, end)` excludes that instant. A non-looping export would therefore freeze on
      a blank frame. To avoid that, the final sample repeats the previous frame's value, so the
      animation stops on its last drawing, as Flash does.

### Task 2: Tests
- [ ] `services/export/frameLayers.test.ts`: frame-exact series, `discreteAttrs`, no animate
      outside layers, the end hold, and symbol instance leaves.
- [ ] `apps/react/.../export/frameSource.test.ts`: the video/GIF frame baker swaps drawings
      per frame.
- [ ] `e2e/frame-by-frame-export.spec.ts`: a real browser SMIL seek (computed `visibility`)
      checking A, then B, then blank, then C, and frozen on C after the end.
- [ ] Update the FBF row in INDEX.

## Known follow-up
- The runtime player and the editor still paint the exact end instant (`t = duration`) as
  blank, because the span excludes `end`. A non-looping player bundle therefore stops on an
  empty frame. The fix is an end-hold rule shared by `computeFrame` callers at
  `t >= duration`, which needs its own small change and a runtime bundle rebuild.
