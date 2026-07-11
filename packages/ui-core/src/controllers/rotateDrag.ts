// Framework-neutral rotate-handle drag controller (slice 5, group C) — single object + multi-
// select group rotate. Extracted from `Stage/useRotateDrag.ts`. The store is INJECTED (W2); both
// snapshots live in closures. `move` takes the raw pointer (the SINGLE rotate measures its angle
// from client coords) plus a lazy `getLocal` thunk (stage-local, for the GROUP angle + both HUD
// positions) and RETURNS a preview descriptor (node transforms + container previews + the single
// rotate-handle overlay transform + the angle HUD) the adapter applies (W5); `end` commits the
// last previewed rotation.
//
// Asymmetry preserved from the original: the GROUP branch previews leaf/group/instance members
// (full pushPreview); the SINGLE branch only writes the object's own node (a no-op for a group/
// instance — they got no subtree preview) plus moves the handle overlay.
import { buildTransform, normalizeRepeat, sampleObject } from '@savig/engine';
import type { RenderState } from '@savig/engine';
import { rotationFromDrag, snapAngle, ANGLE_SNAP_STEP, ANGLE_SNAP_DEG, type Pt } from '@savig/interaction';
import { selectEditProject } from '@savig/editor-state';
import type { ControllerStore } from './store';
import type { GetPoint } from './coords';
import { pushPreview, type ContainerPreview, type NodeTransform } from './transformPreview';

export type SingleSnapshot = {
  objId: string;
  pivot: Pt;
  start: Pt;
  startRotation: number;
  anchorX: number;
  anchorY: number;
  state: RenderState;
  last: number | undefined;
};
export type GroupItem = { id: string; ox: number; oy: number; orot: number; ax: number; ay: number };
export type GroupSnapshot = { center: Pt; start: Pt; items: GroupItem[]; theta: number; moved: boolean };

export interface RotateHud {
  x: number;
  y: number;
  label: string;
  snapped: boolean;
}

export interface RotatePreview {
  nodeTransforms: NodeTransform[];
  containerPreviews: ContainerPreview[];
  /** SINGLE rotate: the rotate-handle overlay's transform. Absent for the group branch. */
  handleTransform?: string;
  /** The angle readout to show. Present = set it; absent = leave it as-is (single with no point). */
  hud?: RotateHud;
}

export interface RotateMoveResult {
  consumed: boolean;
  preview?: RotatePreview;
}

export function makeRotateDragController(store: ControllerStore) {
  let single: SingleSnapshot | null = null;
  let group: GroupSnapshot | null = null;

  const beginSingle = (snapshot: SingleSnapshot) => {
    single = snapshot;
  };
  const beginGroup = (snapshot: GroupSnapshot) => {
    group = snapshot;
  };

  const move = (clientX: number, clientY: number, getLocal: GetPoint, bypass: boolean): RotateMoveResult => {
    const snapActive = store.getState().snapEnabled && !bypass;
    const gr = group;
    if (gr) {
      const cur = getLocal();
      if (!cur) return { consumed: true };
      let theta = rotationFromDrag(gr.center, gr.start, cur, 0); // degrees swept about the centre
      let snapped = false;
      if (snapActive) {
        const r = snapAngle(theta, ANGLE_SNAP_STEP, ANGLE_SNAP_DEG); // magnetic 45° steps
        theta = r.angle;
        snapped = r.snapped;
      }
      gr.theta = theta;
      gr.moved = true;
      // Group rotate is a DELTA about the centre → show the signed sweep, normalized to (−180,180].
      const sweep = ((Math.round(theta) % 360) + 360) % 360;
      const hud: RotateHud = { x: cur.x, y: cur.y, label: `${sweep > 180 ? sweep - 360 : sweep}°`, snapped };
      const rad = (theta * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const proj = selectEditProject(store.getState());
      const time = store.getState().time;
      const nodeTransforms: NodeTransform[] = [];
      const containerPreviews: ContainerPreview[] = [];
      for (const it of gr.items) {
        const obj = proj.objects.find((o) => o.id === it.id);
        if (!obj) continue;
        const dx = it.ax + it.ox - gr.center.x; // object anchor point relative to the group centre
        const dy = it.ay + it.oy - gr.center.y;
        const nx = gr.center.x + (c * dx - s * dy) - it.ax;
        const ny = gr.center.y + (s * dx + c * dy) - it.ay;
        const sampled = sampleObject(obj, time);
        const xf = buildTransform({ ...sampled, x: nx, y: ny, rotation: it.orot + theta }, it.ax, it.ay);
        const base = { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: it.orot + theta, opacity: sampled.opacity };
        pushPreview(obj, proj.assets, it.id, xf, base, nodeTransforms, containerPreviews);
      }
      return { consumed: true, preview: { nodeTransforms, containerPreviews, hud } };
    }

    const rot = single;
    if (rot) {
      let next = rotationFromDrag(rot.pivot, rot.start, { x: clientX, y: clientY }, rot.startRotation);
      let snapped = false;
      if (snapActive) {
        const r = snapAngle(next, ANGLE_SNAP_STEP, ANGLE_SNAP_DEG); // magnetic 45° snap
        next = r.angle;
        snapped = r.snapped;
      }
      rot.last = next;
      const previewTransform = buildTransform({ ...rot.state, rotation: next }, rot.anchorX, rot.anchorY);
      // Single rotate writes only its OWN node (no-op via the adapter for a group/instance) + the
      // handle overlay; there is no subtree preview here (preserved from the original) — EXCEPT a
      // repeated leaf (review fix): its `@k` copies are separate nodes this single write never
      // reaches, so route it through the group container bucket (mirrors objectDrag/pushPreview).
      const obj = selectEditProject(store.getState()).objects.find((o) => o.id === rot.objId);
      const preview: RotatePreview =
        obj && obj.repeat && normalizeRepeat(obj.repeat)
          ? {
              nodeTransforms: [],
              containerPreviews: [{
                kind: 'group',
                objId: rot.objId,
                base: { x: rot.state.x, y: rot.state.y, scaleX: rot.state.scaleX, scaleY: rot.state.scaleY, rotation: next, opacity: rot.state.opacity },
              }],
              handleTransform: previewTransform,
            }
          : {
              nodeTransforms: [{ id: rot.objId, transform: previewTransform }],
              containerPreviews: [],
              handleTransform: previewTransform,
            };
      // Single rotate is ABSOLUTE → show the orientation normalized to [0,360). Only when a
      // stage-local point is available (matching the original's `if (hud)` guard).
      const hudPt = getLocal();
      if (hudPt) {
        preview.hud = { x: hudPt.x, y: hudPt.y, label: `${((Math.round(next) % 360) + 360) % 360}°`, snapped };
      }
      return { consumed: true, preview };
    }
    return { consumed: false };
  };

  const end = (): { consumed: boolean } => {
    const grUp = group;
    if (grUp) {
      group = null;
      if (grUp.moved) {
        const rad = (grUp.theta * Math.PI) / 180;
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const updates = grUp.items.map((it) => {
          const dx = it.ax + it.ox - grUp.center.x;
          const dy = it.ay + it.oy - grUp.center.y;
          return {
            id: it.id,
            x: grUp.center.x + (c * dx - s * dy) - it.ax,
            y: grUp.center.y + (s * dx + c * dy) - it.ay,
            rotation: it.orot + grUp.theta,
          };
        });
        store.getState().setObjectsTransforms(updates);
      }
      return { consumed: true };
    }
    const rotUp = single;
    if (rotUp) {
      single = null;
      if (rotUp.last !== undefined) {
        store.getState().selectObject(rotUp.objId);
        store.getState().setProperty('rotation', rotUp.last);
      }
      return { consumed: true };
    }
    return { consumed: false };
  };

  return { beginSingle, beginGroup, move, end };
}

export type RotateDragController = ReturnType<typeof makeRotateDragController>;
