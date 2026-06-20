import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { buildTransform, geometryToSvgAttrs, sampleObject } from '../../../engine';
import { useEditor } from '../../store/store';
import { applyFrame } from '../../playback/applyFrame';
import { buildDefs } from './buildDefs';
import { rectFromDrag, type Point } from './drawGeometry';
import styles from './Stage.module.css';

const MIN_DRAW_SIZE = 3;

interface DragState {
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  /** Latest dragged position, committed once on pointer-up. */
  curX: number;
  curY: number;
  moved: boolean;
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
  const assetsById = useMemo(
    () => new Map(project.assets.map((a) => [a.id, a] as const)),
    [project.assets],
  );
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
  const contentRef = useRef<SVGGElement | null>(null);
  const drawRef = useRef<{ start: Point; end: Point | null } | null>(null);
  const previewRef = useRef<SVGRectElement | null>(null);

  // Maps client (screen) coords to stage-local coords through the content group's
  // CTM, so draw/handle math accounts for viewBox scaling, pan, and zoom.
  const clientToLocal = (clientX: number, clientY: number): Point | null => {
    const g = contentRef.current;
    const ctm = g?.getScreenCTM();
    const svg = g?.ownerSVGElement;
    if (!g || !ctm || !svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = useEditor.getState();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    s.setZoom(s.zoom * factor);
  };

  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    const s = useEditor.getState();
    if (e.button === 1) {
      panRef.current = { x: e.clientX, y: e.clientY, panX: s.pan.x, panY: s.pan.y };
      return;
    }
    if (s.activeTool !== 'select') {
      const start = clientToLocal(e.clientX, e.clientY);
      if (start) drawRef.current = { start, end: null };
      return;
    }
    selectObject(null);
  };

  const onObjectPointerDown = (id: string, e: ReactPointerEvent) => {
    e.stopPropagation();
    selectObject(id);
    // Only begin a move-drag when auto-key is on (editing is otherwise blocked).
    if (!useEditor.getState().autoKey) return;
    const obj = useEditor.getState().history.present.objects.find((o) => o.id === id);
    if (!obj) return;
    const origin = sampleObject(obj, useEditor.getState().time);
    dragRef.current = {
      id, startX: e.clientX, startY: e.clientY,
      originX: origin.x, originY: origin.y, curX: origin.x, curY: origin.y, moved: false,
    };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const draw = drawRef.current;
      if (draw) {
        const cur = clientToLocal(e.clientX, e.clientY);
        if (cur) {
          draw.end = cur;
          const rect = previewRef.current;
          if (rect) {
            rect.setAttribute('x', String(Math.min(draw.start.x, cur.x)));
            rect.setAttribute('y', String(Math.min(draw.start.y, cur.y)));
            rect.setAttribute('width', String(Math.abs(cur.x - draw.start.x)));
            rect.setAttribute('height', String(Math.abs(cur.y - draw.start.y)));
            rect.setAttribute('visibility', 'visible');
          }
        }
        return;
      }
      const p = panRef.current;
      if (p) {
        useEditor.getState().setPan({ x: p.panX + (e.clientX - p.x), y: p.panY + (e.clientY - p.y) });
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const z = useEditor.getState().zoom ?? 1;
      d.curX = d.originX + (e.clientX - d.startX) / z;
      d.curY = d.originY + (e.clientY - d.startY) / z;
      d.moved = true;
      // Live preview only: write the transform imperatively to the node, without
      // committing — the single history entry is pushed once on pointer-up so a
      // whole drag is one undo step.
      const obj = useEditor.getState().history.present.objects.find((o) => o.id === d.id);
      const node = nodes.get(d.id);
      if (obj && node) {
        const sampled = sampleObject(obj, useEditor.getState().time);
        node.setAttribute('transform', buildTransform({ ...sampled, x: d.curX, y: d.curY }, obj.anchorX, obj.anchorY));
      }
    };
    const onUp = () => {
      const draw = drawRef.current;
      if (draw) {
        drawRef.current = null;
        if (previewRef.current) previewRef.current.setAttribute('visibility', 'hidden');
        const s = useEditor.getState();
        if (draw.end && s.activeTool !== 'select') {
          const bounds = rectFromDrag(draw.start, draw.end, MIN_DRAW_SIZE);
          if (bounds) s.addVectorShape(s.activeTool, bounds);
        }
        return;
      }
      const d = dragRef.current;
      if (d && d.moved) {
        useEditor.getState().selectObject(d.id);
        useEditor.getState().setProperties({ x: d.curX, y: d.curY });
      }
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
        <g ref={contentRef} transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          <defs dangerouslySetInnerHTML={{ __html: defs }} />
          <rect
            ref={previewRef}
            data-testid="draw-preview"
            visibility="hidden"
            fill="none"
            stroke="var(--color-accent)"
            strokeDasharray="4 2"
            pointerEvents="none"
          />
          {ordered.map((o) => {
            const asset = assetsById.get(o.assetId);
            if (asset?.kind === 'vector') {
              const geometry = sampleObject(o, time).geometry ?? {};
              // Render the shape as a real React element so all attribute values
              // (incl. style.fill/stroke, which may come from a loaded .savig) are
              // escaped by React — no dangerouslySetInnerHTML. Geometry still flows
              // through the shared geometryToSvgAttrs so it matches export/runtime.
              const geomAttrs = geometryToSvgAttrs(asset.shapeType, geometry);
              const ShapeTag = asset.shapeType === 'rect' ? 'rect' : 'ellipse';
              return (
                <g
                  key={o.id}
                  ref={register(o.id)}
                  data-testid={`object-${o.id}`}
                  data-savig-object={o.id}
                  data-selected={o.id === selectedId}
                  className={styles.object}
                  onPointerDown={(e) => onObjectPointerDown(o.id, e)}
                >
                  <ShapeTag
                    {...geomAttrs}
                    fill={asset.style.fill}
                    stroke={asset.style.stroke}
                    strokeWidth={asset.style.strokeWidth}
                  />
                </g>
              );
            }
            return (
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
            );
          })}
        </g>
      </svg>
    </div>
  );
}
