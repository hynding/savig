import { useRef, useState } from 'react';
import { clampCameraZoom, panCameraBy, type CameraPose } from '@savig/engine';
import type { Point } from '@savig/interaction';
import { useEditor } from '../../store/store';

type ToLocal = (clientX: number, clientY: number) => Point | null;

/** Wheel zooms settle into one undo step once the wheel has been still this long. */
const WHEEL_SETTLE_MS = 250;

/** The axes of `next` that differ from `from` (what a gesture actually changed). */
function changedAxes(from: CameraPose, next: CameraPose): Partial<CameraPose> {
  const out: Partial<CameraPose> = {};
  for (const k of ['x', 'y', 'zoom', 'rotation'] as const) if (Math.abs(next[k] - from[k]) > 1e-9) out[k] = next[k];
  return out;
}

/** Camera tool (spec 2026-11-18-camera-tool). The Stage shows the picture through the camera;
 *  dragging pans it (the picture follows the pointer), Shift-drag turns it around the frame centre,
 *  and the wheel zooms. While a gesture runs the pose lives in `draft` (drawn live); letting go
 *  commits the changed axes once through `setCameraPose` (auto-key rules apply). */
export function useCameraTool(width: number, height: number) {
  const [draft, setDraft] = useState<CameraPose | null>(null);
  // The frame centre is read when a drag moves; keep it current across stage resizes.
  const dims = useRef({ width, height });
  dims.current = { width, height };
  const drag = useRef<{ start: Point; startPose: CameraPose; rotate: boolean; pose: CameraPose } | null>(null);
  const wheel = useRef<{ startPose: CameraPose; pose: CameraPose; timer: ReturnType<typeof setTimeout> } | null>(null);

  const commit = (from: CameraPose, to: CameraPose) => {
    const patch = changedAxes(from, to);
    if (Object.keys(patch).length > 0) useEditor.getState().setCameraPose(patch);
  };
  const flushWheel = () => {
    const w = wheel.current;
    if (!w) return;
    clearTimeout(w.timer);
    wheel.current = null;
    commit(w.startPose, w.pose);
    setDraft(null);
  };

  const angle = (p: Point) => (Math.atan2(p.y - dims.current.height / 2, p.x - dims.current.width / 2) * 180) / Math.PI;

  return {
    draft,
    begin: (start: Point, pose: CameraPose, rotate: boolean) => {
      flushWheel();
      drag.current = { start, startPose: pose, rotate, pose };
      setDraft(pose);
    },
    move: (e: PointerEvent, toLocal: ToLocal): boolean => {
      const d = drag.current;
      if (!d) return false;
      const p = toLocal(e.clientX, e.clientY);
      if (!p) return true;
      let next: CameraPose;
      if (d.rotate) {
        let delta = angle(p) - angle(d.start);
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        if (e.shiftKey && e.altKey) delta = Math.round(delta / 15) * 15;
        next = { ...d.startPose, rotation: d.startPose.rotation + delta };
      } else {
        next = panCameraBy(d.startPose, p.x - d.start.x, p.y - d.start.y);
      }
      d.pose = next;
      setDraft(next);
      return true;
    },
    end: (): boolean => {
      const d = drag.current;
      if (!d) return false;
      drag.current = null;
      commit(d.startPose, d.pose);
      setDraft(null);
      return true;
    },
    /** Wheel zoom about the frame centre; consecutive notches settle into one step. */
    wheel: (deltaY: number, pose: CameraPose) => {
      const w = wheel.current;
      const cur = w ? w.pose : pose;
      const next = { ...cur, zoom: clampCameraZoom(cur.zoom * Math.exp(-deltaY * 0.0015)) };
      if (w) clearTimeout(w.timer);
      wheel.current = { startPose: w ? w.startPose : pose, pose: next, timer: setTimeout(flushWheel, WHEEL_SETTLE_MS) };
      setDraft(next);
    },
    active: () => drag.current !== null,
  };
}
