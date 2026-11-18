// Framework-neutral 3D Rotation tool drag controller (spec 2026-11-18-3d-rotation, slice 2).
// Dragging across a selected object turns it in depth: horizontal travel turns it about its
// vertical axis (rotationY), vertical travel tips it about its horizontal axis (rotationX).
// Shift locks to the axis that moved most and snaps to 15°. `move` returns a preview descriptor
// the adapter applies (node transform or container preview + readout); `end` commits one step.
import { buildTransform } from '@savig/engine';
import type { AnimatableProperty, RenderState } from '@savig/engine';
import { selectEditProject } from '@savig/editor-state';
import type { ControllerStore } from './store';
import { pushPreview, skewOf, type ContainerPreview, type NodeTransform } from './transformPreview';

/** Degrees of turn per screen pixel of drag. */
export const ROTATE_3D_DEG_PER_PX = 0.5;
export const ROTATE_3D_SNAP_STEP = 15;

export interface Rotate3DSnapshot {
  objId: string;
  /** Pointer at press, in client (screen) pixels: the turn follows screen travel, not zoom. */
  startClientX: number;
  startClientY: number;
  anchorX: number;
  anchorY: number;
  state: RenderState;
}

export interface Rotate3DPreview {
  nodeTransforms: NodeTransform[];
  containerPreviews: ContainerPreview[];
  /** The object's transform for the tool overlay that follows it. */
  overlayTransform: string;
  label: string;
}

/** The angles a drag of (dx, dy) screen pixels gives, from the start angles. */
export function rotate3DFromDrag(
  start: { rotationX: number; rotationY: number },
  dx: number,
  dy: number,
  lock: boolean,
): { rotationX: number; rotationY: number } {
  let ry = start.rotationY + dx * ROTATE_3D_DEG_PER_PX;
  // Dragging up tips the top away (positive X).
  let rx = start.rotationX - dy * ROTATE_3D_DEG_PER_PX;
  if (lock) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      rx = start.rotationX;
      ry = Math.round(ry / ROTATE_3D_SNAP_STEP) * ROTATE_3D_SNAP_STEP;
    } else {
      ry = start.rotationY;
      rx = Math.round(rx / ROTATE_3D_SNAP_STEP) * ROTATE_3D_SNAP_STEP;
    }
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return { rotationX: round(rx), rotationY: round(ry) };
}

export function makeRotate3DDragController(store: ControllerStore) {
  let snap: Rotate3DSnapshot | null = null;
  let last: { rotationX: number; rotationY: number } | null = null;

  const begin = (snapshot: Rotate3DSnapshot) => {
    snap = snapshot;
    last = null;
  };

  const move = (clientX: number, clientY: number, shiftKey: boolean): { consumed: boolean; preview?: Rotate3DPreview } => {
    const sn = snap;
    if (!sn) return { consumed: false };
    const st = sn.state;
    const r = rotate3DFromDrag({ rotationX: st.rotationX ?? 0, rotationY: st.rotationY ?? 0 }, clientX - sn.startClientX, clientY - sn.startClientY, shiftKey);
    last = r;
    const next = { ...st, ...r };
    const transform = buildTransform(next, sn.anchorX, sn.anchorY);
    const proj = selectEditProject(store.getState());
    const obj = proj.objects.find((o) => o.id === sn.objId);
    const nodeTransforms: NodeTransform[] = [];
    const containerPreviews: ContainerPreview[] = [];
    if (obj) {
      const base = { x: st.x, y: st.y, scaleX: st.scaleX, scaleY: st.scaleY, rotation: st.rotation, opacity: st.opacity, ...skewOf(next) };
      pushPreview(obj, proj.assets, sn.objId, transform, base, nodeTransforms, containerPreviews);
    }
    return {
      consumed: true,
      preview: { nodeTransforms, containerPreviews, overlayTransform: transform, label: `3D X ${r.rotationX}° · Y ${r.rotationY}°` },
    };
  };

  const end = (): { consumed: boolean } => {
    const sn = snap;
    if (!sn) return { consumed: false };
    snap = null;
    const r = last;
    last = null;
    if (r) {
      const updates: Partial<Record<AnimatableProperty, number>> = {};
      if (Math.abs(r.rotationX - (sn.state.rotationX ?? 0)) > 1e-9) updates.rotationX = r.rotationX;
      if (Math.abs(r.rotationY - (sn.state.rotationY ?? 0)) > 1e-9) updates.rotationY = r.rotationY;
      if (Object.keys(updates).length > 0) {
        const s = store.getState();
        s.selectObject(sn.objId);
        s.setProperties(updates);
      }
    }
    return { consumed: true };
  };

  return { begin, move, end, active: () => snap !== null };
}

export type Rotate3DDragController = ReturnType<typeof makeRotate3DDragController>;
