# Filters & Color Effects — Slice 2 (Editor) Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking; boxes are left
> unchecked in-file by convention (see INDEX).

**Goal:** author filters in the editor: add/remove/reorder/toggle filters on the selected object
(leaf, group or symbol instance), edit params with auto-key, see and edit filter keyframes on the
Timeline, and add filters from the command palette.

**Spec:** `docs/superpowers/specs/2026-11-13-filters-design.md` §Editor.

### Task 1: Store (`slices/filterSlice.ts`)
- [ ] `addFilter(kind)`, `removeFilter(id)` (drops its tracks + keyframe selection), `moveFilter(id, ±1)`,
      `toggleFilter(id)`, `setFilterParam(id, param, value)` (clamped; auto-key ON → `filterTracks`
      keyframe at the snapped playhead, OFF → static param), `setFilterColor(id, color)`.
- [ ] `selectedFilterKeyframe` (`{ objectId, key, time }`) wired into `NO_KEYFRAME_SELECTION`,
      copy/paste, retime, easing and `deleteSelectedKeyframe`.
- [ ] Tests: `store.filters.test.ts`.

### Task 2: ui-core
- [ ] Inspector VM: `filters: InspectorFilterVM[]` on single + group (params sampled at the snapped
      playhead, `animated`/`keyedHere`, color for colored kinds, move flags); keyframe kind `'filter'`;
      intents.
- [ ] Timeline VM: `row.filterTracks` lanes (label `<kind>[ #n] <param>`), `selectFilterKeyframe` intent.
- [ ] Commands `filter.add.<kind>` (category `Effects`, `canAddFilter`).
- [ ] Tests in inspector/timeline/registry test files.

### Task 3: React
- [ ] Inspector `FiltersSection` (add menu, cards: enable, ↑ ↓ ✕, params, color); "Delete filter
      keyframe" in the keyframe editor.
- [ ] Timeline filter diamonds (`--color-filter` token), draggable to retime.
- [ ] e2e `e2e/filters.spec.ts`.
