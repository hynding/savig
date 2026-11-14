# Bone Skinning — Slice 3 (agent parity)

Spec: `specs/2026-11-14-bone-skinning-design.md` §Agents.

## Tasks

1. **Engine:** `bindSkinOp(objects, assets, objectId, boneIds, time)` — the whole bind edit
   (validation, rect/ellipse → path, densify, skin) shared by the store and core.
2. **Core:** `bindSkin(project, objectId, boneIds, { time?, atRest? })` (fails loud) and
   `unbindSkin`. `atRest` binds against every bone at rotation 0.
3. **DSL:** `skin?: string[]` on shapes; `compileSceneObjects` compiles a scene, then binds every
   requested skin at rest (needs an id; top-level only). Decompile emits `skin` on paths.
4. **describe** `skin → …`; **MCP** `bind_skin` / `unbind_skin`; `load_dsl` docs.
5. **Template** `swaying-tail`.
6. **Tests:** core skinning + DSL round trip + describe; MCP tools; templates suite.
