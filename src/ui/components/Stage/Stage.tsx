import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { sampleObject } from '../../../engine';
import { useEditor } from '../../store/store';
import { applyFrame } from '../../playback/applyFrame';
import { buildDefs } from './buildDefs';
import styles from './Stage.module.css';

interface DragState {
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

export function Stage({ nodes }: { nodes: Map<string, SVGGraphicsElement> }) {
  const project = useEditor((s) => s.history.present);
  const time = useEditor((s) => s.time);
  const selectedId = useEditor((s) => s.selectedObjectId);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const { selectObject } = useEditor.getState();

  const usedIds = useMemo(
    () => Array.from(new Set(project.objects.map((o) => o.assetId))).sort(),
    [project.objects],
  );
  const defs = useMemo(() => buildDefs(project.assets, usedIds), [project.assets, usedIds]);
  const ordered = useMemo(
    () => [...project.objects].sort((a, b) => a.zOrder - b.zOrder),
    [project.objects],
  );

  // Imperatively paint the current frame whenever doc/time changes (paused path).
  useEffect(() => {
    applyFrame(nodes, project, time);
  }, [project, time, nodes]);

  // Cache one ref callback per object id so its identity is stable across
  // renders — otherwise React would null-then-reset the ref every render,
  // briefly dropping the node from the playback map.
  const refCallbacks = useRef(new Map<string, (el: SVGGraphicsElement | null) => void>());
  const register = (id: string) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (el: SVGGraphicsElement | null) => {
        if (el) nodes.set(id, el);
        else nodes.delete(id);
      };
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };

  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const onWheel = (e: React.WheelEvent) => {
    const s = useEditor.getState();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    s.setZoom(s.zoom * factor);
  };

  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    if (e.button === 1) {
      const s = useEditor.getState();
      panRef.current = { x: e.clientX, y: e.clientY, panX: s.pan.x, panY: s.pan.y };
    } else {
      selectObject(null);
    }
  };

  const onObjectPointerDown = (id: string, e: ReactPointerEvent) => {
    e.stopPropagation();
    selectObject(id);
    const obj = useEditor.getState().history.present.objects.find((o) => o.id === id);
    if (!obj) return;
    const origin = sampleObject(obj, useEditor.getState().time);
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, originX: origin.x, originY: origin.y };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = panRef.current;
      if (p) {
        useEditor.getState().setPan({ x: p.panX + (e.clientX - p.x), y: p.panY + (e.clientY - p.y) });
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const z = useEditor.getState().zoom ?? 1;
      const { setProperty, selectObject: sel } = useEditor.getState();
      sel(d.id);
      setProperty('x', d.originX + (e.clientX - d.startX) / z);
      setProperty('y', d.originY + (e.clientY - d.startY) / z);
    };
    const onUp = () => {
      dragRef.current = null;
      panRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div className={styles.root}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${project.meta.width} ${project.meta.height}`}
        onPointerDown={onBackgroundPointerDown}
        onWheel={onWheel}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          <defs dangerouslySetInnerHTML={{ __html: defs }} />
          {ordered.map((o) => (
            <use
              key={o.id}
              ref={register(o.id)}
              data-testid={`object-${o.id}`}
              data-savig-object={o.id}
              data-selected={o.id === selectedId}
              className={styles.object}
              href={`#savig-asset-${o.assetId}`}
              onPointerDown={(e) => onObjectPointerDown(o.id, e)}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
