// Bone tool + armature overlay (spec 2026-11-13-bone-tool §Editor). Editor-only chrome drawn in
// the Stage's content space (never exported):
//  - the Bone tool's drag-to-create (a capture rect over the whole canvas; a drag that starts on a
//    bone's tip grows a child bone from it),
//  - Flash-style tapered bone wedges with joint circles (the selected bone highlighted),
//  - tip handles that POSE: drag = IK up the chain, Alt-drag = rotate just that bone (FK). The drag
//    previews through `onPreview` (the Stage re-renders the armature's leaves under the pose) and
//    commits once on release (one undo step).
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { boneJointWorld, boneTipWorld, isBone, rotateBoneToward, snapToFrame, solveIK, type BonePose } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import type { Point } from '@savig/interaction';
import { useEditor } from '../../store/store';

const TIP_PICK_PX = 8;
const MIN_DRAG_PX = 4;

interface Props {
  objects: SceneObject[];
  time: number;
  fps: number;
  zoom: number;
  clientToLocal: (clientX: number, clientY: number) => Point | null;
  /** Live pose preview (null = clear it and repaint the committed state). */
  onPreview: (pose: BonePose | null) => void;
  disabled: boolean;
}

/** Bones are shown while the Bone tool is active or the selection touches an armature. */
function selectionTouchesBones(objects: SceneObject[], ids: string[]): boolean {
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const touches = (o: SceneObject | undefined): boolean => {
    const seen = new Set<string>();
    for (let cur = o; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      seen.add(cur.id);
      if (isBone(cur)) return true;
    }
    // A selected top-level group that CONTAINS bones (an armature root's parent) counts too.
    return !!o && objects.some((c) => isBone(c) && c.parentId === o.id);
  };
  return ids.some((id) => touches(byId.get(id)));
}

export function BoneOverlay({ objects, time, fps, zoom, clientToLocal, onPreview, disabled }: Props) {
  const activeTool = useEditor((s) => s.activeTool);
  const selectedIds = useEditor((s) => s.selectedObjectIds);
  const selectedId = useEditor((s) => s.selectedObjectId);
  const bones = useMemo(() => objects.filter(isBone), [objects]);
  const t = snapToFrame(time, fps);
  const [pose, setPose] = useState<BonePose | null>(null);
  const [draft, setDraft] = useState<{ a: Point; b: Point } | null>(null);
  const drag = useRef<{ kind: 'create'; a: Point; parentId?: string } | { kind: 'pose'; boneId: string; fk: boolean } | null>(null);

  const geometry = useMemo(
    () =>
      bones.map((b) => ({
        id: b.id,
        name: b.name,
        joint: boneJointWorld(objects, b.id, t, pose ?? undefined),
        tip: boneTipWorld(objects, b.id, t, pose ?? undefined),
      })),
    [bones, objects, t, pose],
  );

  const visible = activeTool === 'bone' || (bones.length > 0 && selectionTouchesBones(objects, selectedIds));

  const tipUnder = (p: Point): string | undefined => {
    let best: { id: string; d: number } | undefined;
    for (const g of geometry) {
      const d = Math.hypot(g.tip.x - p.x, g.tip.y - p.y);
      if (d <= TIP_PICK_PX / zoom && (!best || d < best.d)) best = { id: g.id, d };
    }
    return best?.id;
  };

  // Window-level move/up for both gestures (pointer capture is unreliable across the SVG).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const p = clientToLocal(e.clientX, e.clientY);
      if (!p) return;
      if (d.kind === 'create') {
        setDraft({ a: d.a, b: p });
        return;
      }
      const objs = objects;
      const next: BonePose = d.fk || e.altKey ? new Map([[d.boneId, rotateBoneToward(objs, d.boneId, p, t)]]) : solveIK(objs, d.boneId, p, t);
      setPose(next);
      onPreview(next);
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      const p = clientToLocal(e.clientX, e.clientY);
      const s = useEditor.getState();
      if (d.kind === 'create') {
        setDraft(null);
        if (p && Math.hypot(p.x - d.a.x, p.y - d.a.y) * zoom >= MIN_DRAG_PX) s.addBone(d.a, p, d.parentId);
        return;
      }
      setPose(null);
      onPreview(null);
      if (p) s.poseBoneTip(d.boneId, p, { fk: d.fk || e.altKey });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [clientToLocal, objects, onPreview, t, zoom]);

  const onCreateDown = (e: ReactPointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    const p = clientToLocal(e.clientX, e.clientY);
    if (!p) return;
    const parentId = tipUnder(p);
    const a = parentId ? geometry.find((g) => g.id === parentId)!.tip : p;
    drag.current = { kind: 'create', a, parentId };
    setDraft({ a, b: a });
  };

  const onTipDown = (boneId: string, e: ReactPointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    if (activeTool === 'bone') {
      onCreateDown(e);
      return;
    }
    drag.current = { kind: 'pose', boneId, fk: e.altKey };
  };

  const onBoneDown = (boneId: string, e: ReactPointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    if (activeTool === 'bone') {
      onCreateDown(e);
      return;
    }
    const s = useEditor.getState();
    if (e.shiftKey) s.selectObjects(s.selectedObjectIds.includes(boneId) ? s.selectedObjectIds.filter((x) => x !== boneId) : [...s.selectedObjectIds, boneId]);
    else s.selectObject(boneId);
  };

  if (!visible) return null;
  const w = (len: number) => Math.min(len * 0.12, 7 / zoom);
  return (
    <g data-testid="bone-overlay">
      {activeTool === 'bone' && (
        <rect
          data-testid="bone-capture"
          x={-100000}
          y={-100000}
          width={200000}
          height={200000}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
          onPointerDown={onCreateDown}
        />
      )}
      {geometry.map((g) => {
        const len = Math.hypot(g.tip.x - g.joint.x, g.tip.y - g.joint.y);
        const ux = len > 0 ? (g.tip.x - g.joint.x) / len : 1;
        const uy = len > 0 ? (g.tip.y - g.joint.y) / len : 0;
        const r = w(len);
        const sel = selectedIds.includes(g.id) || selectedId === g.id;
        const bx = g.joint.x + ux * r * 1.5;
        const by = g.joint.y + uy * r * 1.5;
        const pts = `${g.joint.x},${g.joint.y} ${bx - uy * r},${by + ux * r} ${g.tip.x},${g.tip.y} ${bx + uy * r},${by - ux * r}`;
        return (
          <g key={g.id} data-testid={`bone-${g.id}`} data-bone-name={g.name}>
            <polygon
              points={pts}
              fill={sel ? 'var(--color-accent)' : 'var(--color-text-dim)'}
              fillOpacity={0.55}
              stroke={sel ? 'var(--color-accent)' : 'var(--color-text)'}
              strokeWidth={1 / zoom}
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => onBoneDown(g.id, e)}
            />
            <circle cx={g.joint.x} cy={g.joint.y} r={r * 0.8} fill="none" stroke="var(--color-text)" strokeWidth={1 / zoom} pointerEvents="none" />
            <circle
              data-testid={`bone-tip-${g.id}`}
              cx={g.tip.x}
              cy={g.tip.y}
              r={4 / zoom}
              fill={sel ? 'var(--color-accent)' : 'var(--color-panel)'}
              stroke="var(--color-text)"
              strokeWidth={1 / zoom}
              style={{ cursor: activeTool === 'bone' ? 'crosshair' : 'move' }}
              onPointerDown={(e) => onTipDown(g.id, e)}
            />
          </g>
        );
      })}
      {draft && (
        <line
          data-testid="bone-draft"
          x1={draft.a.x}
          y1={draft.a.y}
          x2={draft.b.x}
          y2={draft.b.y}
          stroke="var(--color-accent)"
          strokeWidth={2 / zoom}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

/** `objects` with `pose`'s rotations written as static bases (their rotation tracks dropped) —
 *  what the Stage renders during a pose drag. */
export function posedObjects(objects: SceneObject[], pose: BonePose): SceneObject[] {
  return objects.map((o) => {
    const r = pose.get(o.id);
    if (r === undefined) return o;
    const tracks = { ...o.tracks };
    delete tracks.rotation;
    return { ...o, base: { ...o.base, rotation: r }, tracks };
  });
}
