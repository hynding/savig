# Filters & Color Effects — Slice 3 (Agent Parity) Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking; boxes are left
> unchecked in-file by convention (see INDEX).

**Goal:** agents author filters as fluently as the editor: headless builders, DSL fields that
round-trip, MCP tools, `describe` output and a template.

**Spec:** `docs/superpowers/specs/2026-11-13-filters-design.md` §DSL / MCP.

### Task 1: Core builders (`packages/core/src/filters.ts`)
- [ ] `addFilter(project, objectId, { kind, id?, params?, color?, enabled? }) → { project, filterId }`,
      `setFilter`, `removeFilter` (drops tracks), `setFilterKeyframe`, `animateFilter` (replaces a
      param track). Pure, root-scene, fail loud on unknown objects/filters/kinds/params/colors.

### Task 2: DSL
- [ ] `filters: [{ kind, id?, color?, enabled?, <param>: number, animate?: { <param>: [{ t, value, easing? }] } }]`
      on shapes, text and `frames` layers. Decompile emits non-default params/colors only and tracks
      as `animate`; `compileShort(decompileProject(p))` reproduces `p`.

### Task 3: describe + MCP + template
- [ ] describe: `filters: <kind>:<id> (off) [param@[times]]`.
- [ ] MCP: `add_filter`, `set_filter`, `remove_filter`, `animate_filter`; `load_dsl` documents `filters`.
- [ ] Template `glowing-title` (drop shadow + pulsing glow on a title, backdrop blur sharpening,
      a moon whose colour warms).
- [ ] Tests: `core/src/filters.test.ts`, MCP tools tests.
