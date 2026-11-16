# Personal preset library and preset packs — design

Roadmap 6, item 3. Before this, saved motion presets lived in `Project.motionPresets`, so a preset
saved in one project was missing from the next.

## Library
- Editor state `presetLibrary: MotionPreset[]`, outside the project and its undo history.
- `saveMotionPreset` saves to the library. Rename and delete act on the library copy first, then
  (undoably) on a preset stored in the project. `applyMotionPreset` looks in the project, then the
  library, then the built-ins.
- Storage: `@savig/services` `createPresetLibraryStore` keeps `{ version: 1, presets }` in
  `localStorage['savig-preset-library']`. It is best-effort: missing, full or blocked storage
  means an empty or unsaved library, and a failed save shows a toast. The app hook `usePresetLibrary`
  loads it on start, saves on every change, and reloads on the `storage` event, so other tabs stay
  in sync.
- Older project files keep their `motionPresets`. The Presets popover lists those under My presets
  with an "add to my library" button (⇪).

## Packs
- Format: `{ format: 'savig-preset-pack', version: 1, name?, presets: MotionPreset[] }`
  (`createPresetPack`). `readPresetPack` also accepts a bare array or a single preset, skips
  malformed entries, and throws when nothing usable is there.
- `mergePresets` skips exact duplicates (same name, duration and tracks). An id that is already
  taken, or that names a built-in, gets a fresh `custom-…` id.
- The popover has **Export pack…**, which saves `savig-presets.json`, and **Import pack…**, which
  merges a file into the library and reports how many presets were added.
- Agent parity: core `exportPresetPack(project)` / `importPresetPack(project, json)` on project
  presets, and MCP `export_preset_pack` / `import_preset_pack`.

## Tests
Engine pack read and merge; storage round trip and failure modes; store verbs (library vs project,
undo for project presets, import/export); the app hook (load, save, cross-tab reload without
write-back); the popover (import, duplicates, bad file, add-to-library); MCP; e2e (save, export,
reload into a fresh page, delete, import).
