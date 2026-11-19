// Trace Bitmap (spec 2026-11-18-trace-bitmap): turn the selected picture into filled vector
// regions. The options mirror Animate's dialog: color count, minimum area, curve fit, corners.
import { useEffect, useRef, useState } from 'react';
import { store } from '@savig/editor-state';
import { useEditor } from '../../store/store';
import { TRACE_DEFAULTS, type ImageAsset, type TraceCorners, type TraceCurveFit, type TracedRegion } from '@savig/engine';
import { traceImageAsset } from './traceImage';
import styles from './Inspector.module.css';

const CURVE_FITS: { value: TraceCurveFit; label: string }[] = [
  { value: 'pixels', label: 'Pixels' },
  { value: 'tight', label: 'Tight' },
  { value: 'normal', label: 'Normal' },
  { value: 'smooth', label: 'Smooth' },
];
const CORNERS: { value: TraceCorners; label: string }[] = [
  { value: 'many', label: 'Many corners' },
  { value: 'normal', label: 'Normal' },
  { value: 'few', label: 'Few corners' },
];

export function TraceBitmapSection({
  asset,
  objectId,
  onTrace,
}: {
  asset: ImageAsset;
  objectId: string;
  onTrace: (objectId: string, regions: TracedRegion[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [colors, setColors] = useState(TRACE_DEFAULTS.colors);
  const [minArea, setMinArea] = useState(TRACE_DEFAULTS.minArea);
  const [curveFit, setCurveFit] = useState<TraceCurveFit>(TRACE_DEFAULTS.curveFit);
  const [corners, setCorners] = useState<TraceCorners>(TRACE_DEFAULTS.corners);
  // The "Trace Bitmap…" palette command bumps traceBitmapRequest: open the options and bring them
  // into view. The request present at mount is not a new one (it may predate this picture).
  const request = useEditor((s) => s.traceBitmapRequest);
  const seenRequest = useRef(request);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (request === seenRequest.current) return;
    seenRequest.current = request;
    setOpen(true);
  }, [request]);
  useEffect(() => {
    if (open) rootRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  const run = async () => {
    setBusy(true);
    try {
      const regions = await traceImageAsset(asset, { colors, minArea, curveFit, corners });
      onTrace(objectId, regions);
      setOpen(false);
    } catch (err) {
      store.getState().pushToast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className={styles.row}>
        <button data-testid="trace-bitmap-open" title="Turn this picture into filled vector shapes" onClick={() => setOpen(true)}>
          Trace Bitmap…
        </button>
      </div>
    );
  }
  const clampInt = (v: string, lo: number, hi: number, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  return (
    <div data-testid="trace-bitmap" ref={rootRef}>
      <div className={styles.group}>Trace Bitmap</div>
      <div className={styles.row}>
        <label htmlFor="trace-colors" title="Most colors to keep (2–64)">colors</label>
        <input id="trace-colors" type="number" min={2} max={64} value={colors} onChange={(e) => setColors(clampInt(e.target.value, 2, 64, colors))} />
      </div>
      <div className={styles.row}>
        <label htmlFor="trace-min-area" title="Smaller specks (in pixels) merge into their neighbors">min area</label>
        <input id="trace-min-area" type="number" min={0} max={10000} value={minArea} onChange={(e) => setMinArea(clampInt(e.target.value, 0, 10000, minArea))} />
      </div>
      <div className={styles.row}>
        <label htmlFor="trace-curve-fit">curve fit</label>
        <select id="trace-curve-fit" value={curveFit} onChange={(e) => setCurveFit(e.target.value as TraceCurveFit)}>
          {CURVE_FITS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className={styles.row}>
        <label htmlFor="trace-corners">corners</label>
        <select id="trace-corners" value={corners} onChange={(e) => setCorners(e.target.value as TraceCorners)}>
          {CORNERS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className={styles.row}>
        <button data-testid="trace-bitmap-run" disabled={busy} onClick={() => void run()}>
          {busy ? 'Tracing…' : 'Trace'}
        </button>
        <button disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
