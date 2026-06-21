import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditor } from '../../store/store';
import { usePathTools } from './usePathTools';

beforeEach(() => useEditor.getState().newProject());

describe('pen authoring', () => {
  it('builds a draft across clicks and commits an open path on finish', () => {
    useEditor.getState().setActiveTool('pen');
    const { result } = renderHook(() => usePathTools());

    act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, false));
    act(() => result.current.onPenPointerDown({ x: 10, y: 0 }, false));
    expect(result.current.draft?.nodes).toHaveLength(2);

    act(() => result.current.finishPen(false));
    const proj = useEditor.getState().history.present;
    expect(proj.objects).toHaveLength(1);
    const asset = proj.assets.find((a) => a.kind === 'vector' && a.shapeType === 'path')!;
    expect(asset.kind === 'vector' && asset.path!.closed).toBe(false);
    expect(asset.kind === 'vector' && asset.path!.nodes).toHaveLength(2);
    expect(result.current.draft).toBeNull();
    expect(useEditor.getState().activeTool).toBe('node');
  });

  it('closes the path when finishPen(true)', () => {
    useEditor.getState().setActiveTool('pen');
    const { result } = renderHook(() => usePathTools());
    act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, false));
    act(() => result.current.onPenPointerDown({ x: 10, y: 0 }, false));
    act(() => result.current.onPenPointerDown({ x: 10, y: 10 }, false));
    act(() => result.current.finishPen(true));
    const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector' && a.shapeType === 'path')!;
    expect(asset.kind === 'vector' && asset.path!.closed).toBe(true);
  });

  it('cancelPen discards the draft without creating anything', () => {
    useEditor.getState().setActiveTool('pen');
    const { result } = renderHook(() => usePathTools());
    act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, false));
    act(() => result.current.cancelPen());
    expect(result.current.draft).toBeNull();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
  });

  it('a cancel request (Escape) clears the draft and the penDrafting flag', () => {
    useEditor.getState().setActiveTool('pen');
    const { result } = renderHook(() => usePathTools());
    act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, false));
    expect(useEditor.getState().penDrafting).toBe(true);
    act(() => useEditor.getState().requestCancelPen());
    expect(result.current.draft).toBeNull();
    expect(useEditor.getState().penDrafting).toBe(false);
  });

  it('ignores a finish with fewer than 2 nodes', () => {
    useEditor.getState().setActiveTool('pen');
    const { result } = renderHook(() => usePathTools());
    act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, false));
    act(() => result.current.finishPen(false));
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
    expect(result.current.draft).toBeNull();
  });

  it('click-drag adds mirrored handles to the placed node', () => {
    useEditor.getState().setActiveTool('pen');
    const { result } = renderHook(() => usePathTools());
    act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, true));
    act(() => result.current.onPenDrag({ x: 3, y: 0 }));
    act(() => result.current.onPenPointerUp());
    expect(result.current.draft?.nodes[0].out).toEqual({ x: 3, y: 0 });
    expect(result.current.draft?.nodes[0].in).toEqual({ x: -3, y: 0 });
  });
});

describe('node editing', () => {
  function seedPath() {
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }],
      closed: false,
    });
  }

  it('dragging an anchor commits exactly one undo step on pointer-up', () => {
    seedPath();
    const { result } = renderHook(() => usePathTools());
    const before = useEditor.getState().history.past.length;

    act(() => result.current.onNodePointerDown({ x: 0, y: 0 }));
    act(() => result.current.onNodeDrag({ x: 5, y: 5 }));
    act(() => result.current.onNodeDrag({ x: 8, y: 8 }));
    act(() => result.current.onNodePointerUp());

    const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector' && a.shapeType === 'path')!;
    expect(asset.kind === 'vector' && asset.path!.nodes[0].anchor).toEqual({ x: 8, y: 8 });
    expect(useEditor.getState().history.past.length).toBe(before + 1);
  });

  it('selects the grabbed node', () => {
    seedPath();
    const { result } = renderHook(() => usePathTools());
    act(() => result.current.onNodePointerDown({ x: 20, y: 0 }));
    expect(useEditor.getState().selectedNodeIndex).toBe(1);
  });
});
