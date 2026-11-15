# Lottie export — slice 1 plan

Spec: `specs/2026-11-15-lottie-export-design.md`.

1. `services/export/lottie.ts`: `parseTransform`, `decomposeAffine`, `lottieColor`,
   `numericChannel` (thinning), path/hold channels, `exportLottie(project)` →
   `{ animation, warnings }`; exported from `@savig/services`.
2. Shape layers per leaf: rect/ellipse → cubic paths, compound rings (even-odd), morph, skin,
   boolean; fill/stroke; opacity; blend `bm`; first scene only (warning).
3. Tests: helpers (services), round trip through a reference interpreter vs SaViG raster
   (core/node): animated rects + colour track + blend, skewed child under a scaled group +
   symbol instance, morph + holed path, thinning + warnings.
