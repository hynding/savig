# Paint bucket — slice 1 plan

Spec: `specs/2026-11-15-paint-bucket-eraser-design.md`.

1. Engine: export the boolean helpers (`vectorEffectivePath`, `vectorLocalOutline`,
   `objectPointToWorld`) and `invMapPoint`; add `geom/paintBucket.ts` with `objectWorldInk`,
   `pointInMultiPolygon`, `paintBucketTarget`, `applyPaintBucket`; unit tests for closed line
   art, open areas, line hits, recolour vs fill, hidden/guide exclusion, z placement, group
   mapping, keying, lock refusal and shared-asset forking.
2. Editor state: `ToolMode 'bucket'` (allowed in symbol edit), `bucketColor` +
   `setBucketColor` (hex only), `paintBucketAt(x, y)` as one commit with toasts for line /
   open / locked clicks.
3. UI: `tool.bucket` command on K, palette button + icon, "Paint bucket options" bar with the
   colour input, Stage background and object presses route to `paintBucketAt`.
4. Agent: core `paintBucket`, MCP `paint_bucket`.
5. Tests: store, view-model, registry, core (raster), MCP, e2e `paint-bucket.spec.ts`.
6. Regenerate the runtime bundle; full unit + Playwright run.
