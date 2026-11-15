# Lottie export — slice 2 plan

Spec: `specs/2026-11-15-lottie-export-design.md` (Gradients, trim, dashes).

1. `Paint` = solid | gradient (local-box start/end, stops); `paintItem` writes `fl`/`st` or
   `gf`/`gs` with a fixed stop count and optional alpha stops; radial on non-square / focal warns.
2. Layers become a stroke group (paths, optional `tm`, stroke, transform) above a fill group.
3. Dashes: normalized pattern × flattened length → `d`/`g`/`o` channels; dashes beat trim.
4. Tests: round trip for linear/radial gradient fills (animated, alpha) + gradient stroke; trim
   and dash values checked numerically (resvg ignores pathLength); fill under a trim still matches.
