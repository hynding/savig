# Mask Layers — Slice 3 (Agent Parity) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax; boxes are left unchecked in-file by convention.

**Goal:** An agent can build masked animation without the editor: link masks by hand, reveal
objects with one macro call, write masks in the ShortDoc DSL, and see them in `describe`.

**Spec:** `docs/superpowers/specs/2026-11-13-mask-layers-design.md` §DSL / MCP / macros.

### Task 1: Core builders + macro (`packages/core/src/masks.ts`)
- [ ] `createMask`, `releaseMask`, `unmask` (same contract as build.ts: pure, fail loud).
- [ ] `reveal` (wipe from any side / iris), bounds from `operandWorldRings` unless given.

### Task 2: DSL + describe
- [ ] `mask` / `maskedBy` on `ShortObjectCommon` and `ShortFrames`; compile writes them after the
      object exists (forward links allowed); decompile emits them only when set (parity).
- [ ] describe: mask targets, target's mask.

### Task 3: MCP
- [ ] `create_mask`, `release_mask`, `reveal`; `load_dsl` description mentions masks.

### Task 4: Template
- [ ] `wipe-and-iris-reveal`: a title card + text wiped in from the left, then a badge iris.

### Task 5: Tests
- [ ] `core/masks.test.ts`: builders, refusals, wipe raster reveal at the midpoint, iris geometry,
      bounds requirement, DSL compile/round-trip (incl. a frame-layer mask), describe, template.
- [ ] `mcp/tools.test.ts`: each tool, bad input, `get_dsl` → `load_dsl` round-trip.
