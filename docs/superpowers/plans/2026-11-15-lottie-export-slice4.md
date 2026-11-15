# Lottie export — slice 4 plan

Spec: `specs/2026-11-15-lottie-export-design.md` (Surfaces).

1. ui-core: `CommandHost.exportLottie()` and command `file.exportLottie` (File, palette).
2. React: `fileOps.exportLottie` saves `<name>.json` (`application/json`); warnings → one info toast.
3. `@savig/core` re-exports `exportLottie` and its types.
4. MCP `export_lottie`: JSON text plus a warnings list.
5. Tests: registry routes to the host; fileOps writes animated JSON; MCP returns JSON and warns on
   text; core re-export identity. INDEX → COMPLETE.
