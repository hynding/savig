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
        if (!kfSelected) s.cut(); // cut-keyframe deferred: X is a no-op while a keyframe is selected
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
          else if (s.selectedProgressKeyframe) s.removeSelectedProgressKeyframe();
          else if (s.selectedGradientKeyframe) s.removeSelectedGradientKeyframe();
          else if (s.selectedColorKeyframe) s.removeSelectedColorKeyframe();
          else if (s.selectedDashKeyframe) s.removeSelectedDashKeyframe();
          else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
          else if (s.selectedKeyframe) s.removeSelectedKeyframe();
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
