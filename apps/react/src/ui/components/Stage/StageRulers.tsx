// Rulers and guides (spec 2026-11-19-rulers-guides). Rulers run along the Stage's top and left
// edges in root Stage units; drag out of one to make a guide, drag a guide to move it, drag it off
// the Stage to remove it. Guides draw in an overlay above the Stage, so they stay one pixel wide at
// every zoom and never touch the scene's own SVG.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { RulerGuide } from '@savig/engine';
import { useEditor } from '../../store/store';
import { selectActiveAssetId } from '../../store/selectors';
import { rulerTicks, stageViewMap, type StageViewMap } from './rulerMath';
import styles from './Stage.module.css';

/** Ruler thickness in px (the Stage pads itself by this much while rulers show). */
export const RULER_PX = 18;

interface GuideDrag {
  /** Index of the guide being moved; null while dragging a new guide out of a ruler. */
  index: number | null;
  axis: 'x' | 'y';
  pos: number;
  /** The pointer is off the Stage: letting go removes the guide (or makes none). */
  off: boolean;
}

const EMPTY: RulerGuide[] = [];

export function StageRulers() {
  const rulersVisible = useEditor((s) => s.rulersVisible);
  const guidesVisible = useEditor((s) => s.guidesVisible);
  const guidesLocked = useEditor((s) => s.guidesLocked);
  const guides = useEditor((s) => s.history.present.guides ?? EMPTY);
  const width = useEditor((s) => s.history.present.meta.width);
  const height = useEditor((s) => s.history.present.meta.height);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const atRoot = useEditor((s) => selectActiveAssetId(s) === null);
  const activeTool = useEditor((s) => s.activeTool);
  const previewMode = useEditor((s) => s.previewMode);

  const areaRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rulersVisible]);

  const map = stageViewMap(size, { width, height }, pan, zoom);
  const mapRef = useRef<StageViewMap>(map);
  mapRef.current = map;

  const [drag, setDrag] = useState<GuideDrag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const startDrag = (e: ReactPointerEvent, axis: 'x' | 'y', index: number | null) => {
    if (e.button !== 0 || previewMode) return;
    e.preventDefault();
    e.stopPropagation();
    const at = (clientX: number, clientY: number): GuideDrag => {
      const el = areaRef.current!;
      const r = el.getBoundingClientRect();
      const m = mapRef.current;
      const lx = clientX - r.left;
      const ly = clientY - r.top;
      const off = lx < 0 || ly < 0 || lx > r.width || ly > r.height;
      return { index, axis, pos: Math.round(axis === 'x' ? (lx - m.ox) / m.k : (ly - m.oy) / m.k), off };
    };
    let cur = at(e.clientX, e.clientY);
    // A new guide starts on the ruler, which is off the drawing area; it appears once it's pulled on.
    setDrag(cur);
    const onMove = (ev: PointerEvent) => {
      cur = at(ev.clientX, ev.clientY);
      setDrag(cur);
    };
    const onUp = () => {
      done();
      const st = useEditor.getState();
      if (cur.index === null) {
        if (!cur.off) st.addGuide(cur.axis, cur.pos);
      } else if (cur.off) st.removeGuide(cur.index);
      else st.moveGuide(cur.index, cur.pos);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') done();
    };
    const done = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      cleanup.current = null;
      setDrag(null);
    };
    cleanup.current?.();
    cleanup.current = done;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
  };

  const showGuides = guidesVisible && atRoot && !previewMode;
  const draggable = showGuides && !guidesLocked && activeTool === 'select';
  const inset = rulersVisible ? RULER_PX : 0;
  const top = rulersVisible ? rulerTicks(size.w, map.ox, map.k) : null;
  const left = rulersVisible ? rulerTicks(size.h, map.oy, map.k) : null;
  const lineAt = (g: { axis: 'x' | 'y'; pos: number }) => (g.axis === 'x' ? map.ox + g.pos * map.k : map.oy + g.pos * map.k);

  return (
    <>
      {rulersVisible && top && left && (
        <>
          <div className={styles.rulerCorner} aria-hidden="true" />
          <div
            className={`${styles.ruler} ${styles.rulerTop}`}
            data-testid="ruler-top"
            title="Drag down to make a horizontal guide"
            onPointerDown={(e) => startDrag(e, 'y', null)}
          >
            <svg width="100%" height={RULER_PX} aria-hidden="true">
              {top.minor.map((px) => (
                <line key={`m${px}`} x1={px} x2={px} y1={RULER_PX - 4} y2={RULER_PX} />
              ))}
              {top.major.map((t) => (
                <g key={`M${t.px}`}>
                  <line x1={t.px} x2={t.px} y1={2} y2={RULER_PX} />
                  <text x={t.px + 3} y={10}>{t.value}</text>
                </g>
              ))}
            </svg>
          </div>
          <div
            className={`${styles.ruler} ${styles.rulerLeft}`}
            data-testid="ruler-left"
            title="Drag right to make a vertical guide"
            onPointerDown={(e) => startDrag(e, 'x', null)}
          >
            <svg width={RULER_PX} height="100%" aria-hidden="true">
              {left.minor.map((px) => (
                <line key={`m${px}`} y1={px} y2={px} x1={RULER_PX - 4} x2={RULER_PX} />
              ))}
              {left.major.map((t) => (
                <g key={`M${t.px}`}>
                  <line y1={t.px} y2={t.px} x1={2} x2={RULER_PX} />
                  <text x={10} y={t.px + 3} transform={`rotate(-90 10 ${t.px + 3})`}>{t.value}</text>
                </g>
              ))}
            </svg>
          </div>
        </>
      )}
      <div ref={areaRef} className={styles.guideArea} style={{ top: inset, left: inset }} data-testid="guide-area">
        {showGuides && (guides.length > 0 || drag) && (
          <svg className={styles.guideSvg} width="100%" height="100%">
            {guides.map((g, i) => {
              if (drag?.index === i) return null;
              const p = lineAt(g);
              const [x1, y1, x2, y2] = g.axis === 'x' ? [p, 0, p, size.h] : [0, p, size.w, p];
              return (
                <g key={i} data-testid={`guide-${g.axis}-${i}`} data-pos={g.pos}>
                  <line className={styles.guideLine} x1={x1} y1={y1} x2={x2} y2={y2} />
                  {draggable && (
                    <line
                      className={styles.guideHit}
                      data-testid={`guide-hit-${i}`}
                      style={{ cursor: g.axis === 'x' ? 'col-resize' : 'row-resize' }}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      onPointerDown={(e) => startDrag(e, g.axis, i)}
                    >
                      <title>{`${g.axis === 'x' ? 'x' : 'y'} = ${g.pos}. Drag to move, off the Stage to remove.`}</title>
                    </line>
                  )}
                </g>
              );
            })}
            {drag && !drag.off && (() => {
              const p = lineAt(drag);
              const [x1, y1, x2, y2] = drag.axis === 'x' ? [p, 0, p, size.h] : [0, p, size.w, p];
              return (
                <g data-testid="guide-drag" data-pos={drag.pos}>
                  <line className={styles.guideLine} x1={x1} y1={y1} x2={x2} y2={y2} />
                  <text className={styles.guideLabel} x={drag.axis === 'x' ? p + 4 : 4} y={drag.axis === 'x' ? 14 : p - 4}>
                    {drag.pos}
                  </text>
                </g>
              );
            })()}
          </svg>
        )}
      </div>
    </>
  );
}
