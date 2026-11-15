# Lottie export — slice 3 plan

Spec: `specs/2026-11-15-lottie-export-design.md` (Masks, images, scenes, camera).

1. `SampleContext` (view, key prefix, camera, scene opacity, end-hold exposure) so one sampler
   serves single- and multi-scene projects.
2. Image leaves → `ty: 2` layers + embedded image assets; anchor resolved as the SVG render does.
3. Masks: collect each mask's content per frame into a `mask_N` precomp; each masked layer gets a
   `td` precomp layer right above it and `tt` from the mask style.
4. Scenes via `sceneAtTime`: crossfade opacity, dip overlay layer; cameras baked per frame.
5. Reference interpreter: `ip`/`op`, image layers, precomps, track mattes. Round-trip fixtures for
   alpha / inverted / luminance masks, an image, three scenes with crossfade + dip (every frame),
   and an animated camera.
