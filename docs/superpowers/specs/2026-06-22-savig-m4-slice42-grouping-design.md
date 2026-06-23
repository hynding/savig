# Savig M4 Slice 42 — Grouping (selection-grouping)

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — M4 headline, phase 1)
**Depends on:** Slices 36–41 (the multi-select + group-transform toolkit)

## 1. Goal

Group selected objects so they select/move/scale/rotate/copy/delete together as a
unit; Ungroup dissolves it. A group is a set of objects sharing a `groupId` —
selecting any member selects the whole group. Objects stay FLAT (no nested
transforms), so every group operation reuses the multi-select/transform machinery
(36–41) for free. This is phase 1 of the M4 grouping headline; a true nested
container (a group with its own stored transform + nested export, for Flash-style
symbols) is a later phase.

## 2. Why this model

Group scale/rotate (40/41) already operate about the group bbox center of
`selectedObjectIds`, so "transform the group" == "transform the multi-selection". The
only NEW behavior is **selection expansion**: clicking one member selects all members.
Therefore grouping needs NO engine/export/runtime change — `groupId` is editor
selection metadata; objects render and export exactly as before.

## 3. Data

`groupId?: string` on `SceneObject` (a NEW field, distinct from the reserved-but-unused
`parentId`). Additive optional → generic serialize, NO migration/version bump (v4).
`duplicateObject` (engine) clears `groupId` on the clone, so paste/duplicate produce
ungrouped copies (no accidental merge with the source group).

## 4. Behavior

- **Group** (`groupSelected`, Cmd+G + Inspector): assign a fresh `groupId` to all
  selected non-locked objects (no-op for < 2). One commit.
- **Ungroup** (`ungroupSelected`, Cmd+Shift+G + Inspector): clear `groupId` from every
  object in the selected groups. One commit.
- **Selection expansion:** clicking/Shift-clicking a grouped object (Stage or Layers),
  and marquee hits, expand to the whole group:
  - `selectObjectOrGroup(id)` → select all of id's group.
  - `toggleObjectOrGroup(id)` → add/remove the whole group.
  - `selectObjectsExpandingGroups(ids)` → expand each hit to its group (marquee).
- **Transform/move/copy/delete a group:** free — the group is selected as a set, so
  slices 37/40/41/36/39 act on all members.

## 5. Scope (YAGNI)

**In:** `groupId`; group/ungroup; selection expansion (Stage + Layers + marquee);
Cmd+G / Cmd+Shift+G; Inspector Group/Ungroup; clear groupId on clone; persistence
round-trip.

**Out (deferred → later M4 phases):** a true nested group container with its own
Transform2D + nested SVG `<g>` export (Flash-style symbols); double-click to enter a
group and select a member; nested groups (groups of groups); regroup-on-paste (cloned
groups become ungrouped this slice); group naming / a group row in the Layers tree.

**Editor + persistence only:** no engine render/export/runtime change (v4).

## 6. Implementation surface

- `src/engine/types.ts`: `groupId?: string` on `SceneObject`.
- `src/engine/duplicate.ts`: clear `groupId` on the clone.
- `src/ui/store/store.ts`: pure `groupMatesOf(objects, id)` + `expandToGroups(objects,
  ids)`; `groupSelected`/`ungroupSelected`; `selectObjectOrGroup`/`toggleObjectOrGroup`/
  `selectObjectsExpandingGroups`. (`newId()` for the fresh groupId.)
- `src/ui/hooks/useKeyboard.ts`: Cmd+G → group, Cmd+Shift+G → ungroup (before the
  single-key tool switch; `mod` already gates it off the 'g' polygon shortcut).
- `src/ui/components/Stage/Stage.tsx`: `onObjectPointerDown` plain → `selectObjectOrGroup`,
  Shift → `toggleObjectOrGroup`; marquee `onUp` → `selectObjectsExpandingGroups(hits)`.
- `src/ui/components/LayersPanel/LayersPanel.tsx`: row click plain → `selectObjectOrGroup`,
  Shift → `toggleObjectOrGroup`.
- `src/ui/components/Inspector/Inspector.tsx`: a **Group** button in the multi-state
  (> 1 selected); an **Ungroup** button when the selection includes a grouped object.

## 7. Testing

**Store (`store.test.ts`):** `groupSelected` assigns one shared fresh groupId to the
selection (≥2; < 2 no-op); `selectObjectOrGroup`/expansion selects all group members;
`toggleObjectOrGroup` adds/removes the whole group; `ungroupSelected` clears groupId
from the group; a clone (duplicate/paste) has no groupId.

**Persistence (`savig.test.ts`):** a project with two grouped objects round-trips
`groupId` (no version bump).

**Keyboard (`useKeyboard.test.ts`):** Cmd+G groups the selection; Cmd+Shift+G ungroups.

**Stage/Layers (`*.test.tsx`):** clicking one grouped object selects all members (Stage
+ Layers); after ungroup, clicking selects only that one.

**e2e (`grouping.spec.ts`):** draw two rects, select both, Cmd+G; click ONE → both show
selection outlines; drag it → both move; Cmd+Shift+G → click one → only one selected.

## 8. Risks

- **Clone merge:** clearing `groupId` on clone is load-bearing — without it, pasting a
  group merges the clones with the source group. Covered by a store test.
- **Selection expansion scope:** only the OBJECT click/marquee paths expand; keyframe
  selection stays single-object (clicking a keyframe of a grouped object focuses one
  object's track, not the group).
- **Locked members:** `groupSelected` skips locked; selecting a group still includes a
  locked member visually (consistent with the rest — bulk ops skip locked).
