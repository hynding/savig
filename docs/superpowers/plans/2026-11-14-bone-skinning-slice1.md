# Bone Skinning — Slice 1 (model, engine, render)

Spec: `specs/2026-11-14-bone-skinning-design.md`.

## Tasks

1. **Model.** `SceneObject.skin?: SkinSpec` (`{ bones, binds: Mat2D[], weights }`), type `Mat2D`.
   Format v11 (stamp-only). `sanitizeSkins.ts`, chained outermost in `migrate.ts`.
2. **Engine `skin.ts`.**
   - Affine helpers `matMul`, `matInv`, `matApply`.
   - `densifyPath(path, maxLen = 24)`: de Casteljau subdivision, outline unchanged.
   - `autoSkinWeights(points, segments)`: inverse-fourth-power distance, top two bones, rows sum to 1.
   - `computeSkin(objects, obj, path, boneIds, time)` → densified path + skin (or an error).
   - `skinnedPath(objects, obj, path, time, pose?)`: linear blend skinning; the drawing's own
     transform is cancelled; falls back to the input path on any mismatch.
3. **Render seam.** Runtime `computeFrame` emits the deformed `pathD` (Stage, HTML runtime,
   raster and SMIL sampling read it); `renderDocument` writes frame 0's deformed outline with the
   pivot from the undeformed one. Runtime bundle regenerated.
4. **IK full-reach fix.** `solveIK` straightens the chain root-first when the target is at or
   beyond reach, then refines with CCD.
5. **Tests.** engine `skin.test.ts`, `bones.test.ts` (full reach); services `export/skin.test.ts`
   (runtime, static export parity, SMIL `d` interpolates, unskinned parity) and
   `sanitizeSkins.test.ts` (incl. v10 → v11).
