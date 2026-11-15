# Motion presets — slice 2 plan

Spec: `specs/2026-11-15-motion-presets-design.md`.

1. engine: preset types move to `types.ts`; `Project.motionPresets?`; `presetFromObject` (window =
   first..last transform key; offset for x/y/rotation, factor for scale/opacity unless the start
   value is 0, then absolute; per-key easing kept); `isMotionPreset`.
2. services `sanitizeMotionPresets` on load (malformed and duplicate ids dropped; empty removed).
3. editor-state `saveMotionPreset(name)`, `renameMotionPreset`, `deleteMotionPreset` (each one undo
   step); `applyMotionPreset` also finds project presets.
4. Presets popover "My presets": apply, rename (✎ or double-click; Enter/blur commits, Escape
   cancels), delete (×), and "Save selection's motion" with a name field.
5. core `saveMotionPreset`, `motionPreset` finds project presets, `withScene` carries
   `motionPresets`; MCP `save_motion_preset`, `list_motion_presets` lists them.
6. Tests: capture modes, exact round trip at the same time and relative reuse elsewhere, null
   cases, validation; sanitize + load; store verbs + undo; MCP; multi-scene core; component; e2e.
