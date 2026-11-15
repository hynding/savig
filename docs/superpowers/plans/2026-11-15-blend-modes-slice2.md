# Blend modes — slice 2 plan

Spec: `specs/2026-11-15-blend-modes-design.md` (Agent surfaces).

1. Core `blend.ts`: `setBlendMode(project, ids, mode)` — unknown mode / id throws; normal or null clears.
2. DSL: `blend` on `ShortObjectCommon`, applied and emitted through the mask-fields seam (objects
   and frame layers); round-trips; 'normal' compiles to absent.
3. describe `blend=<mode>`; validate `blend-unknown` (error), `blend-in-mask` (warn).
4. MCP `set_blend_mode`; `load_dsl` description mentions `blend`.
5. Tests: core/DSL/describe/validate, MCP.
