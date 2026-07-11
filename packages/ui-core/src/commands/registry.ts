import type { EditorState } from '@savig/editor-state';
import type { Command, KeyEvent } from './types';
import { chordMatches } from './chord';
import { canAlign, canDistribute, canBool, canGroup, canUngroup, canCreateSymbol, canOutlineStroke, canShapeBuilder, canBlend, hasSelection, vectorSelected } from './predicates';
import { toggleShapeBuilder } from './intents';

// --- shared availability helpers -----------------------------------------------------------------

const kfSelected = (s: EditorState): boolean =>
  !!(
    s.selectedKeyframe ||
    s.selectedShapeKeyframe ||
    s.selectedColorKeyframe ||
    s.selectedGradientKeyframe ||
    s.selectedDashKeyframe ||
    s.selectedTrimKeyframe ||
    s.selectedProgressKeyframe
  );

/** The Node tool is active with a node selected — the Delete target takes precedence over kf/object. */
const nodeTargeted = (s: EditorState): boolean => s.activeTool === 'node' && s.selectedNodeIndex != null;

const tool = (id: string, title: string, mode: string, key: string): Command => ({
  id,
  title,
  category: 'Tools',
  // ignoreShift: holding Shift while pressing the letter (uppercase e.key) still selects the tool,
  // matching the old dual-case (`case 'v': case 'V':`) switch.
  chord: { key, ignoreShift: true },
  run: (ctx) => ctx.state.setActiveTool(mode as EditorState['activeTool']),
  keywords: ['tool'],
});

// Entries sharing a chord (Copy/Cut/Paste/Delete) use MUTUALLY EXCLUSIVE `when` predicates, so the
// keymap matcher resolves exactly one and the registry-integrity test holds. Ordering is
// specific-first for readability; correctness comes from the exclusive predicates.
export const COMMANDS: Command[] = [
  // --- Tools ---
  tool('tool.select', 'Select tool', 'select', 'v'),
  tool('tool.pen', 'Pen tool', 'pen', 'p'),
  tool('tool.node', 'Node tool', 'node', 'n'),
  tool('tool.rect', 'Rectangle tool', 'rect', 'r'),
  tool('tool.ellipse', 'Ellipse tool', 'ellipse', 'e'),
  tool('tool.polygon', 'Polygon tool', 'polygon', 'g'),
  tool('tool.star', 'Star tool', 'star', 's'),
  tool('tool.line', 'Line tool', 'line', 'l'),
  tool('tool.brush', 'Brush tool', 'brush', 'b'),
  tool('tool.motion', 'Motion path tool', 'motion', 'm'),
  tool('tool.eyedropper', 'Eyedropper tool', 'eyedropper', 'i'),
  tool('tool.scissors', 'Scissors tool', 'scissors', 'c'),

  // --- Edit ---
  { id: 'edit.undo', title: 'Undo', category: 'Edit', chord: { mod: true, key: 'z' }, preventDefault: true, run: (c) => c.state.undo() },
  { id: 'edit.redo', title: 'Redo', category: 'Edit', chord: { mod: true, shift: true, key: 'z' }, preventDefault: true, run: (c) => c.state.redo() },
  { id: 'edit.duplicate', title: 'Duplicate', category: 'Edit', chord: { mod: true, key: 'd' }, preventDefault: true, when: hasSelection, unavailableHint: 'Select an object', run: (c) => c.state.duplicateSelected() },
  { id: 'edit.copyKeyframe', title: 'Copy keyframe', category: 'Edit', chord: { mod: true, key: 'c' }, preventDefault: true, when: kfSelected, unavailableHint: 'Select a keyframe', run: (c) => c.state.copyKeyframe() },
  { id: 'edit.copyObject', title: 'Copy', category: 'Edit', chord: { mod: true, key: 'c' }, preventDefault: true, when: (s) => hasSelection(s) && !kfSelected(s), unavailableHint: 'Select an object', run: (c) => c.state.copySelected() },
  { id: 'edit.cutKeyframe', title: 'Cut keyframe', category: 'Edit', chord: { mod: true, key: 'x' }, preventDefault: true, when: kfSelected, unavailableHint: 'Select a keyframe', run: (c) => c.state.cutKeyframe() },
  { id: 'edit.cutObject', title: 'Cut', category: 'Edit', chord: { mod: true, key: 'x' }, preventDefault: true, when: (s) => hasSelection(s) && !kfSelected(s), unavailableHint: 'Select an object', run: (c) => c.state.cut() },
  { id: 'edit.pasteKeyframe', title: 'Paste keyframe', category: 'Edit', chord: { mod: true, key: 'v' }, preventDefault: true, when: (s) => !!s.keyframeClipboard, unavailableHint: 'Copy a keyframe first', run: (c) => c.state.pasteKeyframe() },
  { id: 'edit.pasteObject', title: 'Paste', category: 'Edit', chord: { mod: true, key: 'v' }, preventDefault: true, when: (s) => !s.keyframeClipboard && !!s.clipboard, unavailableHint: 'Copy an object first', run: (c) => c.state.paste() },
  { id: 'edit.deleteNode', title: 'Delete node', category: 'Edit', chord: { keys: ['Delete', 'Backspace'] }, when: nodeTargeted, unavailableHint: 'Select a path node', run: (c) => c.state.deleteSelectedNode() },
  { id: 'edit.deleteKeyframe', title: 'Delete keyframe', category: 'Edit', chord: { keys: ['Delete', 'Backspace'] }, when: (s) => !nodeTargeted(s) && kfSelected(s), unavailableHint: 'Select a keyframe', run: (c) => c.state.deleteSelectedKeyframe() },
  { id: 'edit.deleteObject', title: 'Delete', category: 'Edit', chord: { keys: ['Delete', 'Backspace'] }, when: (s) => !nodeTargeted(s) && !kfSelected(s) && !!s.selectedObjectId, unavailableHint: 'Select an object', run: (c) => c.state.deleteSelectedObject() },
  { id: 'edit.copyStyle', title: 'Copy style', category: 'Edit', chord: { mod: true, alt: true, key: 'c' }, preventDefault: true, when: vectorSelected, unavailableHint: 'Select a vector object', run: (c) => c.state.copyStyle() },
  { id: 'edit.pasteStyle', title: 'Paste style', category: 'Edit', chord: { mod: true, alt: true, key: 'v' }, preventDefault: true, when: (s) => !!s.styleClipboard && hasSelection(s), unavailableHint: 'Copy a style first', run: (c) => c.state.pasteStyle() },
  { id: 'edit.bringForward', title: 'Bring forward', category: 'Edit', chord: { mod: true, keys: [']', '}'] }, preventDefault: true, when: hasSelection, unavailableHint: 'Select an object', run: (c) => c.state.reorderSelected('forward') },
  { id: 'edit.bringToFront', title: 'Bring to front', category: 'Edit', chord: { mod: true, shift: true, keys: [']', '}'] }, preventDefault: true, when: hasSelection, unavailableHint: 'Select an object', run: (c) => c.state.reorderSelected('front') },
  { id: 'edit.sendBackward', title: 'Send backward', category: 'Edit', chord: { mod: true, keys: ['[', '{'] }, preventDefault: true, when: hasSelection, unavailableHint: 'Select an object', run: (c) => c.state.reorderSelected('backward') },
  { id: 'edit.sendToBack', title: 'Send to back', category: 'Edit', chord: { mod: true, shift: true, keys: ['[', '{'] }, preventDefault: true, when: hasSelection, unavailableHint: 'Select an object', run: (c) => c.state.reorderSelected('back') },

  // --- Arrange ---
  ...(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((edge): Command => ({
    id: `arrange.align.${edge}`,
    title: `Align ${edge}`,
    category: 'Arrange',
    when: canAlign,
    unavailableHint: 'Select 2+ objects',
    keywords: ['align'],
    run: (c) => c.state.alignSelected(edge),
  })),
  { id: 'arrange.distribute.h', title: 'Distribute horizontally', category: 'Arrange', when: canDistribute, unavailableHint: 'Select 3+ objects', run: (c) => c.state.distributeSelected('h') },
  { id: 'arrange.distribute.v', title: 'Distribute vertically', category: 'Arrange', when: canDistribute, unavailableHint: 'Select 3+ objects', run: (c) => c.state.distributeSelected('v') },
  { id: 'arrange.distributeCenters.h', title: 'Distribute horizontal centers', category: 'Arrange', when: canDistribute, unavailableHint: 'Select 3+ objects', run: (c) => c.state.distributeCentersSelected('h') },
  { id: 'arrange.distributeCenters.v', title: 'Distribute vertical centers', category: 'Arrange', when: canDistribute, unavailableHint: 'Select 3+ objects', run: (c) => c.state.distributeCentersSelected('v') },
  ...(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((edge): Command => ({
    id: `arrange.alignCanvas.${edge}`,
    title: `Align ${edge} to canvas`,
    category: 'Arrange',
    when: hasSelection,
    unavailableHint: 'Select an object',
    keywords: ['align', 'canvas', 'artboard'],
    run: (c) => c.state.alignToCanvas(edge),
  })),
  { id: 'arrange.centerOnCanvas', title: 'Center on canvas', category: 'Arrange', when: hasSelection, unavailableHint: 'Select an object', run: (c) => c.state.centerOnCanvas() },
  { id: 'arrange.group', title: 'Group', category: 'Arrange', chord: { mod: true, key: 'g' }, preventDefault: true, when: canGroup, unavailableHint: 'Select 2+ objects', run: (c) => c.state.groupSelected() },
  { id: 'arrange.ungroup', title: 'Ungroup', category: 'Arrange', chord: { mod: true, shift: true, key: 'g' }, preventDefault: true, when: canUngroup, unavailableHint: 'Select a group', run: (c) => c.state.ungroupSelected() },
  { id: 'arrange.createSymbol', title: 'Create symbol', category: 'Symbols', when: canCreateSymbol, unavailableHint: 'Select an unlocked object', run: (c) => c.state.createSymbol() },

  // --- Boolean (base + Alt = live/animated variant, which becomes discoverable in the palette) ---
  ...(['union', 'subtract', 'intersect', 'exclude'] as const).flatMap((op, i): Command[] => {
    const letter = ['u', 's', 'i', 'e'][i];
    const Title = op[0].toUpperCase() + op.slice(1);
    return [
      // NOTE: Ctrl+Shift+I (Intersect) is the browser DevTools toggle on Windows/Linux — the OS eats
      // it before the page sees it, so its shortcut is shadowed there; the palette entry is the fallback.
      { id: `boolean.${op}`, title: Title, category: 'Boolean', chord: { mod: true, shift: true, key: letter }, preventDefault: true, when: canBool, unavailableHint: 'Select 2+ shapes', run: (c) => c.state.booleanOp(op, { live: false }) },
      { id: `boolean.${op}.live`, title: `${Title} (animated)`, category: 'Boolean', chord: { mod: true, shift: true, alt: true, key: letter }, preventDefault: true, when: canBool, unavailableHint: 'Select 2+ shapes', keywords: ['live'], run: (c) => c.state.booleanOp(op, { live: true }) },
    ];
  }),

  // --- Path (M6 outline-stroke) ---
  { id: 'path.outlineStroke', title: 'Outline stroke', category: 'Path', when: canOutlineStroke, unavailableHint: 'Select a path with a stroke', run: (c) => c.state.outlineStroke() },

  // --- Path (art-tools #7 Shape Builder) --- toggle: enter when eligible, exit when already active
  // (the `when` ORs in the live flag so the command stays available to EXIT even off its own entry
  // gate — mirrors the design doc's "the command again (toggle)" exit path).
  { id: 'path.shapeBuilder', title: 'Shape Builder', category: 'Path', when: (s) => canShapeBuilder(s) || !!s.shapeBuilder, unavailableHint: 'Select 2-6 plain closed shapes', run: (c) => toggleShapeBuilder(c.state) },

  // --- Path (art-tools #9 Blend) ---
  { id: 'path.blend', title: 'Blend', category: 'Path', when: canBlend, unavailableHint: 'Select 2 vector paths', run: (c) => c.state.blendSelected(3) },

  // --- Animation ---
  { id: 'anim.playPause', title: 'Play / pause', category: 'Animation', chord: { key: ' ', anyMod: true }, preventDefault: true, run: (c) => c.state.setPlaying(!c.state.playing) },
  { id: 'anim.stepBack', title: 'Previous frame', category: 'Animation', chord: { key: ',' }, run: (c) => c.state.stepFrame(-1) },
  { id: 'anim.stepFwd', title: 'Next frame', category: 'Animation', chord: { key: '.' }, run: (c) => c.state.stepFrame(1) },
  { id: 'anim.toggleAutoKey', title: 'Toggle auto-key', category: 'Animation', run: (c) => c.state.toggleAutoKey() },
  ...([['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]] as const).map(
    ([k, dx, dy]): Command => ({
      id: `anim.nudge.${k}`,
      title: `Nudge ${k.replace('Arrow', '').toLowerCase()}`,
      category: 'Animation',
      // anyMod: arrows dispatched on key alone in the old keymap — so Alt/Cmd+Arrow still nudges and
      // still blocks the browser back-navigation gesture. Shift = 10px step (read from the event).
      chord: { key: k, anyMod: true },
      preventDefault: true,
      when: hasSelection,
      unavailableHint: 'Select an object',
      keywords: ['move', 'arrow'],
      run: (c, e) => {
        const step = e?.shiftKey ? 10 : 1;
        c.state.nudgeSelected(dx * step, dy * step);
      },
    }),
  ),

  // --- View ---
  { id: 'view.onionSkin', title: 'Toggle onion skin', category: 'View', chord: { key: 'o', ignoreShift: true }, run: (c) => c.state.toggleOnionSkin() },
  { id: 'view.snap', title: 'Toggle snapping', category: 'View', run: (c) => c.state.toggleSnap() },
  { id: 'view.grid', title: 'Toggle grid', category: 'View', run: (c) => c.state.toggleGrid() },
  { id: 'view.frame', title: 'Toggle stage frame', category: 'View', keywords: ['artboard', 'bounds', 'stage', 'size'], run: (c) => c.state.toggleFrame() },
  { id: 'view.commandPalette', title: 'Command palette', category: 'View', chord: { mod: true, key: 'k' }, preventDefault: true, run: (c) => c.host.openPalette() },
  { id: 'view.shortcuts', title: 'Keyboard shortcuts', category: 'View', chord: { shift: true, key: '?' }, run: (c) => c.host.openShortcuts() },
  { id: 'help.gettingStarted', title: 'Getting started', category: 'View', keywords: ['help', 'onboarding', 'checklist', 'tutorial'], run: (c) => c.host.openGettingStarted() },

  // --- File ---
  { id: 'file.new', title: 'New project', category: 'File', run: (c) => c.host.newProject() },
  { id: 'file.templates', title: 'New from template…', category: 'File', keywords: ['gallery', 'example'], run: (c) => c.host.openTemplates() },
  { id: 'file.open', title: 'Open project…', category: 'File', run: (c) => c.host.openProject() },
  { id: 'file.save', title: 'Save project', category: 'File', chord: { mod: true, key: 's' }, preventDefault: true, run: (c) => c.host.saveProject() },
  { id: 'file.export', title: 'Export bundle (.zip)…', category: 'File', keywords: ['export', 'zip', 'bundle'], run: (c) => c.host.exportProject() },
  { id: 'file.exportSvg', title: 'Export SVG snapshot', category: 'File', keywords: ['export', 'svg', 'vector', 'still'], run: (c) => c.host.exportSvg() },
];

/** First registry command whose chord matches the event AND whose `when` (if any) passes. */
export function findMatchingCommand(state: EditorState, e: KeyEvent): Command | undefined {
  return COMMANDS.find((c) => !!c.chord && chordMatches(c.chord, e) && (!c.when || c.when(state)));
}
