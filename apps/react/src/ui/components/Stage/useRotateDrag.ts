import { useRef, type RefObject } from 'react';
import { buildTransform, sampleObject } from '@savig/engine';
import type { Project, RenderState, SceneObject, Transform2D } from '@savig/engine';
import { useEditor } from '../../store/store';
import { selectEditProject } from '../../store/selectors';
import { isSymbolInstance } from './snapping';
import { rotationFromDrag, snapAngle, ANGLE_SNAP_STEP, ANGLE_SNAP_DEG, type Pt } from './rotateHandle';

/** Stage-runtime values the rotate previews need, captured once where the global pointer effect
 *  is registered (so capture semantics match the prior inline branches exactly). */
export interface RotateDragCtx {
  nodes: Map<string, SVGGraphicsElement>;
  clientToLocal: (clientX: number, clientY: number) => Pt | null;
  setRotateHud: (hud: { x: number; y: number; label: string; snapped: boolean } | null) => void;
  rotateHandleGroupRef: RefObject<SVGGElement | null>;
  previewGroupChildren: (proj: Project, group: SceneObject, time: number, base: Transform2D) => void;
  previewInstanceChildren: (proj: Project, instance: SceneObject, time: number, base: Transform2D) => void;
}

type SingleSnapshot = {
  objId: string;
  pivot: Pt;
  start: Pt;
  startRotation: number;
  anchorX: number;
  anchorY: number;
  state: RenderState;
  last: number | undefined;
};
type GroupItem = { id: string; ox: number; oy: number; orot: number; ax: number; ay: number };
type GroupSnapshot = { center: Pt; start: Pt; items: GroupItem[]; theta: number; moved: boolean };

const snapActiveFor = (e: PointerEvent) => useEditor.getState().snapEnabled && !(e.metaKey || e.ctrlKey);

/** Rotate-handle dragging — single object + multi-selection group rotate. Extracted from
 *  Stage.tsx (no behavior change). Owns both interaction refs; the Stage's pointer-down handlers
 *  compute the snapshot (from their derived memos) and call begin*. `move`/`end` are delegated
 *  from the shared onMove/onUp and return true when a rotate is in progress (single + group are
 *  mutually exclusive with each other and the other drags, so the call position is immaterial). */
export function useRotateDrag() {
  const singleRef = useRef<SingleSnapshot | null>(null);
  const groupRef = useRef<GroupSnapshot | null>(null);

  const beginSingle = (snapshot: SingleSnapshot) => {
    singleRef.current = snapshot;
  };
  const beginGroup = (snapshot: GroupSnapshot) => {
    groupRef.current = snapshot;
  };

  const move = (e: PointerEvent, ctx: RotateDragCtx): boolean => {
    const snapActive = snapActiveFor(e);
    const gr = groupRef.current;
    if (gr) {
      const cur = ctx.clientToLocal(e.clientX, e.clientY);
      if (!cur) return true;
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
      ctx.setRotateHud({ x: cur.x, y: cur.y, label: `${sweep > 180 ? sweep - 360 : sweep}°`, snapped });
      const rad = (theta * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const proj = selectEditProject(useEditor.getState());
      const time = useEditor.getState().time;
      for (const it of gr.items) {
        const obj = proj.objects.find((o) => o.id === it.id);
        if (!obj) continue;
        const dx = it.ax + it.ox - gr.center.x; // object anchor point relative to the group centre
        const dy = it.ay + it.oy - gr.center.y;
        const nx = gr.center.x + (c * dx - s * dy) - it.ax;
        const ny = gr.center.y + (s * dx + c * dy) - it.ay;
        const sampled = sampleObject(obj, time);
        const xf = buildTransform({ ...sampled, x: nx, y: ny, rotation: it.orot + theta }, it.ax, it.ay);
        const node = ctx.nodes.get(it.id);
        if (node) node.setAttribute('transform', xf);
        else if (obj.isGroup)
          ctx.previewGroupChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: it.orot + theta, opacity: sampled.opacity }); // group has no node — preview its subtree
        else if (isSymbolInstance(obj, proj.assets))
          ctx.previewInstanceChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: it.orot + theta, opacity: sampled.opacity }); // instance has no node — preview its leaves
      }
      return true;
    }
    const rot = singleRef.current;
    if (rot) {
      let next = rotationFromDrag(rot.pivot, rot.start, { x: e.clientX, y: e.clientY }, rot.startRotation);
      let snapped = false;
      if (snapActive) {
        const r = snapAngle(next, ANGLE_SNAP_STEP, ANGLE_SNAP_DEG); // magnetic 45° snap
        next = r.angle;
        snapped = r.snapped;
      }
      rot.last = next;
      const previewTransform = buildTransform({ ...rot.state, rotation: next }, rot.anchorX, rot.anchorY);
      const node = ctx.nodes.get(rot.objId);
      if (node) node.setAttribute('transform', previewTransform);
      const group = ctx.rotateHandleGroupRef.current;
      if (group) group.setAttribute('transform', previewTransform);
      // Single rotate is ABSOLUTE → show the orientation normalized to [0,360).
      const hud = ctx.clientToLocal(e.clientX, e.clientY);
      if (hud) ctx.setRotateHud({ x: hud.x, y: hud.y, label: `${((Math.round(next) % 360) + 360) % 360}°`, snapped });
      return true;
    }
    return false;
  };

  const end = (ctx: Pick<RotateDragCtx, 'setRotateHud'>): boolean => {
    const grUp = groupRef.current;
    if (grUp) {
      groupRef.current = null;
      ctx.setRotateHud(null); // clear the angle readout
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
        useEditor.getState().setObjectsTransforms(updates);
      }
      return true;
    }
    const rotUp = singleRef.current;
    if (rotUp) {
      singleRef.current = null;
      ctx.setRotateHud(null); // clear the angle readout
      if (rotUp.last !== undefined) {
        useEditor.getState().selectObject(rotUp.objId);
        useEditor.getState().setProperty('rotation', rotUp.last);
      }
      return true;
    }
    return false;
  };

  return { beginSingle, beginGroup, move, end };
}
