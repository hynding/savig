// Framework-neutral keyboard-shortcut controller (slice 5, group D). Extracted from
// `hooks/useKeyboard.ts`. The store is INJECTED (W2). `handleKey` takes a neutral key descriptor
// (no DOM `KeyboardEvent`) and dispatches to store actions, RETURNING whether the caller should
// `preventDefault` (W5 — the controller never touches the event). The `window` listener and the
// `isEditable(e.target)` guard (which inspect the DOM) stay in the app adapter.
import type { ControllerStore } from './store';
import type { KeyEvent } from '../commands/types';

export function makeKeymapController(store: ControllerStore) {
  /** Dispatch a keydown. Returns true if the caller should preventDefault. */
  const handleKey = (e: KeyEvent): boolean => {
    const s = store.getState();
    const step = e.shiftKey ? 10 : 1;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && (e.key === 'z' || e.key === 'Z')) {
      if (e.shiftKey) s.redo();
      else s.undo();
      return true;
    }
    if (mod && (e.key === 'd' || e.key === 'D')) {
      s.duplicateSelected();
      return true;
    }
    if (mod && (e.key === 'g' || e.key === 'G')) {
      if (e.shiftKey) s.ungroupSelected();
      else s.groupSelected();
      return true;
    }
    // Boolean path ops on a >=2 non-group vector selection (slice 46 follow-up). booleanOp
    // self-gates (no-op when ineligible), so call unconditionally. NOTE: Ctrl+Shift+I is the
    // browser DevTools toggle on Windows/Linux Chrome/Edge and is consumed at the browser process
    // level BEFORE the page sees it — preventDefault cannot reclaim it, so Intersect's shortcut is
    // always shadowed there. The Inspector "Intersect" button is the fallback. (U/S/E are unaffected.)
    if (mod && e.shiftKey && (e.key === 'u' || e.key === 'U')) { s.booleanOp('union', { live: e.altKey }); return true; }
    if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) { s.booleanOp('subtract', { live: e.altKey }); return true; }
    if (mod && e.shiftKey && (e.key === 'i' || e.key === 'I')) { s.booleanOp('intersect', { live: e.altKey }); return true; }
    if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) { s.booleanOp('exclude', { live: e.altKey }); return true; }
    const kfSelected = !!(
      s.selectedKeyframe ||
      s.selectedShapeKeyframe ||
      s.selectedColorKeyframe ||
      s.selectedGradientKeyframe ||
      s.selectedDashKeyframe ||
      s.selectedProgressKeyframe
    );
    if (mod && (e.key === 'c' || e.key === 'C')) {
      if (kfSelected) s.copyKeyframe();
      else s.copySelected();
      return true;
    }
    if (mod && (e.key === 'x' || e.key === 'X')) {
      if (kfSelected) s.cutKeyframe();
      else s.cut();
      return true;
    }
    if (mod && (e.key === 'v' || e.key === 'V')) {
      if (s.keyframeClipboard) s.pasteKeyframe();
      else s.paste();
      return true;
    }
    if (mod && (e.key === ']' || e.key === '}')) {
      s.reorderSelected(e.shiftKey ? 'front' : 'forward');
      return true;
    }
    if (mod && (e.key === '[' || e.key === '{')) {
      s.reorderSelected(e.shiftKey ? 'back' : 'backward');
      return true;
    }
    switch (e.key) {
      case ' ':
        s.setPlaying(!s.playing);
        return true;
      case 'ArrowLeft': s.nudgeSelected(-step, 0); return true;
      case 'ArrowRight': s.nudgeSelected(step, 0); return true;
      case 'ArrowUp': s.nudgeSelected(0, -step); return true;
      case 'ArrowDown': s.nudgeSelected(0, step); return true;
      case ',': s.stepFrame(-1); break;
      case '.': s.stepFrame(1); break;
      case 'Delete':
      case 'Backspace':
        if (s.activeTool === 'node' && s.selectedNodeIndex != null) s.deleteSelectedNode();
        else if (kfSelected) s.deleteSelectedKeyframe();
        else if (s.selectedObjectId) s.deleteSelectedObject();
        break;
      case 'v': case 'V': s.setActiveTool('select'); break;
      case 'p': case 'P': s.setActiveTool('pen'); break;
      case 'n': case 'N': s.setActiveTool('node'); break;
      case 'r': case 'R': s.setActiveTool('rect'); break;
      case 'e': case 'E': s.setActiveTool('ellipse'); break;
      case 'm': case 'M': s.setActiveTool('motion'); break;
      case 'g': case 'G': s.setActiveTool('polygon'); break;
      case 's': case 'S': s.setActiveTool('star'); break;
      case 'l': case 'L': s.setActiveTool('line'); break;
      case 'b': case 'B': s.setActiveTool('brush'); break;
      case 'o': case 'O': s.toggleOnionSkin(); break;
      case 'Escape':
        if (s.editPath.length > 0 && !s.penDrafting) { s.exitSymbol(); break; } // exit a symbol level (slice 47 edit-mode)
        s.requestCancelPen();
        s.setActiveTool('select');
        break;
      default: break;
    }
    return false;
  };

  return { handleKey };
}

export type KeymapController = ReturnType<typeof makeKeymapController>;
