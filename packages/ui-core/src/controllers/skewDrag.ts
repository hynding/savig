// Framework-neutral skew-handle drag controller (spec 2026-11-18-skew-distort, slice 2). The
// Stage shows a skew handle just outside each edge midpoint of the selected object; dragging the
// top/bottom handle shears along X, the left/right handle along Y, with the opposite edge fixed
// (Alt: about the anchor; Shift: 15° steps). `move` returns a preview descriptor the adapter
// applies (node transform + handle overlay + angle HUD); `end` commits one undo step.
import { buildTransform, normalizeRepeat } from '@savig/engine';
import type { AnimatableProperty, LocalRect, RenderState } from '@savig/engine';
import { applySkewHandleDrag, type SkewHandleId } from '@savig/interaction';
import { selectEditProject } from '@savig/editor-state';
import type { ControllerStore } from './store';
import type { GetPoint } from './coords';
import { skewOf, type ContainerPreview, type NodeTransform } from './transformPreview';

export interface SkewSnapshot {
  objId: string;
  handle: SkewHandleId;
  bbox: LocalRect;
  anchorX: number;
  anchorY: number;
  state: RenderState;
}

export interface SkewPreview {
  nodeTransforms: NodeTransform[];
  containerPreviews: ContainerPreview[];
  /** The skew/rotate overlays' transform (they follow the object). */
  handleTransform: string;
  hud: { x: number; y: number; label: string; snapped: boolean } | null;
}

export interface SkewMoveResult {
  consumed: boolean;
  preview?: SkewPreview;
}

export function makeSkewDragController(store: ControllerStore) {
  let snap: SkewSnapshot | null = null;
  let last: { skewX: number; skewY: number; x: number; y: number } | null = null;

  const begin = (snapshot: SkewSnapshot) => {
    snap = snapshot;
    last = null;
  };

  const move = (getLocal: GetPoint, shiftKey: boolean, altKey: boolean): SkewMoveResult => {
    const sk = snap;
    if (!sk) return { consumed: false };
    const p = getLocal();
    if (!p) return { consumed: true };
    const st = sk.state;
    const r = applySkewHandleDrag({
      handle: sk.handle,
      bbox: sk.bbox,
      anchorX: sk.anchorX,
      anchorY: sk.anchorY,
      scaleX: st.scaleX,
      scaleY: st.scaleY,
      rotationDeg: st.rotation,
      skewX: st.skewX ?? 0,
      skewY: st.skewY ?? 0,
      baseX: st.x,
      baseY: st.y,
      pointerX: p.x,
      pointerY: p.y,
      snap: shiftKey,
      fromAnchor: altKey,
    });
    last = r;
    const next = { ...st, ...r };
    const transform = buildTransform(next, sk.anchorX, sk.anchorY);
    const obj = selectEditProject(store.getState()).objects.find((o) => o.id === sk.objId);
    const horizontal = sk.handle === 'n' || sk.handle === 's';
    const angle = Math.round((horizontal ? r.skewX : r.skewY) * 10) / 10;
    const hud = { x: p.x, y: p.y, label: `${horizontal ? 'skew X' : 'skew Y'} ${angle}°`, snapped: shiftKey };
    const base = { x: r.x, y: r.y, scaleX: st.scaleX, scaleY: st.scaleY, rotation: st.rotation, opacity: st.opacity, ...skewOf(r) };
    const repeated = !!(obj && obj.repeat && normalizeRepeat(obj.repeat));
    return {
      consumed: true,
      preview: {
        nodeTransforms: repeated ? [] : [{ id: sk.objId, transform }],
        containerPreviews: repeated ? [{ kind: 'group', objId: sk.objId, base }] : [],
        handleTransform: transform,
        hud,
      },
    };
  };

  const end = (): { consumed: boolean } => {
    const sk = snap;
    if (!sk) return { consumed: false };
    snap = null;
    const r = last;
    last = null;
    if (r) {
      const s = store.getState();
      s.selectObject(sk.objId);
      const st = sk.state;
      const updates: Partial<Record<AnimatableProperty, number>> = { skewX: r.skewX, skewY: r.skewY };
      // Only key x/y when the fixed point moved the base (a shear about the anchor leaves it).
      if (Math.abs(r.x - st.x) > 1e-9 || Math.abs(r.y - st.y) > 1e-9) Object.assign(updates, { x: r.x, y: r.y });
      s.setProperties(updates);
    }
    return { consumed: true };
  };

  const active = () => snap !== null;

  return { begin, move, end, active };
}

export type SkewDragController = ReturnType<typeof makeSkewDragController>;
