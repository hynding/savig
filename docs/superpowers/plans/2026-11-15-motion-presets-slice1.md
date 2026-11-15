# Motion presets — slice 1 plan

Spec: `specs/2026-11-15-motion-presets-design.md`.

1. engine `presets.ts`: types, `BUILTIN_MOTION_PRESETS` (19), `findMotionPreset`, `applyMotionPreset`.
2. editor-state `applyMotionPreset(presetId, { duration? })` over the selection (one commit; locked
   skipped; returns the count).
3. ui-core: `animation.preset.<id>` palette commands; timeline VM `hasSelection`; intents.
4. React `Timeline/MotionPresets.tsx`: header button + fixed-position popover (the Timeline panel
   clips), duration override, toast.
5. core `motionPreset`, MCP `list_motion_presets` / `apply_motion_preset`.
6. Tests: library well-formed; entrance/exit/emphasis pose invariants for every built-in; relative
   values; window replacement + frame snapping; raw spin; store verb; popover; palette; MCP; e2e.
