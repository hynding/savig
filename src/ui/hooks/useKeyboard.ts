import { useEffect } from 'react';
import { useEditor } from '../store/store';

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const s = useEditor.getState();
      const step = e.shiftKey ? 10 : 1;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
      if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelected();
        else s.groupSelected();
        return;
      }
      // Boolean path ops on a >=2 non-group vector selection (slice 46 follow-up). booleanOp
      // self-gates (no-op when ineligible), so call unconditionally. NOTE: Ctrl+Shift+I is the
      // browser DevTools toggle on Windows/Linux Chrome/Edge and is consumed at the browser process
      // level BEFORE the page sees it — preventDefault cannot reclaim it, so Intersect's shortcut is
      // always shadowed there. The Inspector "Intersect" button is the fallback. (U/S/E are unaffected.)
      if (mod && e.shiftKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); s.booleanOp('union'); return; }
      if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); s.booleanOp('subtract'); return; }
      if (mod && e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); s.booleanOp('intersect'); return; }
      if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); s.booleanOp('exclude'); return; }
      const kfSelected = !!(
        s.selectedKeyframe ||
        s.selectedShapeKeyframe ||
        s.selectedColorKeyframe ||
        s.selectedGradientKeyframe ||
        s.selectedDashKeyframe ||
        s.selectedProgressKeyframe
      );
      if (mod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        if (kfSelected) s.copyKeyframe();
        else s.copySelected();
        return;
      }
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        if (kfSelected) s.cutKeyframe();
        else s.cut();
        return;
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        if (s.keyframeClipboard) s.pasteKeyframe();
        else s.paste();
        return;
      }
      if (mod && (e.key === ']' || e.key === '}')) {
        e.preventDefault();
        s.reorderSelected(e.shiftKey ? 'front' : 'forward');
        return;
      }
      if (mod && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        s.reorderSelected(e.shiftKey ? 'back' : 'backward');
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          s.setPlaying(!s.playing);
          break;
        case 'ArrowLeft': e.preventDefault(); s.nudgeSelected(-step, 0); break;
        case 'ArrowRight': e.preventDefault(); s.nudgeSelected(step, 0); break;
        case 'ArrowUp': e.preventDefault(); s.nudgeSelected(0, -step); break;
        case 'ArrowDown': e.preventDefault(); s.nudgeSelected(0, step); break;
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
