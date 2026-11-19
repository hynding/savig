// Options + progress + cancel for browser video export (spec §7). Overlay pattern mirrors
// TemplateGallery; the global keymap is already suppressed while any overlay is open (App.tsx
// passes overlay !== null to useKeyboard). Snapshot semantics (spec §8): project + binaries
// are captured ONCE at Export-click and handed to the orchestrator.
import { useEffect, useRef, useState } from 'react';
import { computeProjectDuration } from '@savig/engine';
import { SPRITE_SHEET_MAX_FPS, WEBM_MAX_FRAMES, planSpriteSheet, saveBytesToDisk } from '@savig/services';
import { useEditor } from '../../store/store';
import { exportVideo, type VideoPhase } from '../../export/videoExport';
import { GIF_MAX_FPS, GIF_MAX_WIDTH, exportGif, gifFps } from '../../export/gifExport';
import { exportSpriteSheet } from '../../export/spriteSheetExport';
import styles from './ExportVideoDialog.module.css';

const PHASE_LABEL: Record<VideoPhase, string> = {
  frames: 'rendering frames…',
  audio: 'mixing audio…',
  encode: 'encoding…',
  finalize: 'finalizing…',
};

export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'sprites';

/** Default sprite cell width: the artboard, scaled down to at most 256px. */
const spriteDefaultWidth = (artboardWidth: number) => Math.min(artboardWidth, 256);

export function ExportVideoDialog({ onClose, initialFormat = 'mp4' }: { onClose: () => void; initialFormat?: ExportFormat }) {
  const meta = useEditor((s) => s.history.present.meta);
  // Reactive (M-5): the >60s / WebM-cap warnings and the duration+frame-count readout must
  // track the live project while the dialog is open, not a one-shot getState() read at render.
  const duration = useEditor((s) => computeProjectDuration(s.history.present));
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  // GIF only: loop forever (the GIF norm) or play once.
  const [loop, setLoop] = useState(true);
  const isGif = format === 'gif';
  // Sprite sheet only (roadmap 11): grid columns (0 = auto, near-square), cell gap, transparency.
  const isSprites = format === 'sprites';
  const [columns, setColumns] = useState(0);
  const [padding, setPadding] = useState(0);
  const [transparent, setTransparent] = useState(true);
  const project = useEditor((s) => s.history.present);
  const [fps, setFps] = useState(meta.fps);
  // Sprite cells default small (game sprites); video/GIF default to the artboard width.
  const [width, setWidth] = useState(initialFormat === 'sprites' ? spriteDefaultWidth(meta.width) : meta.width);
  const [running, setRunning] = useState<{ phase: VideoPhase; fraction: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Display-only fallback (mirrors the start()-time NaN fallback below): an emptied fps field
  // is NaN while the user is mid-edit, but the duration+frame-count readout should keep
  // showing a real number rather than "NaN frames".
  const displayFps = Number.isFinite(fps) ? fps : meta.fps;
  // GIF clamps to whole fps ≤ GIF_MAX_FPS (gifFramePlan), so the readout matches what is encoded.
  const frameCount = Math.max(1, Math.round(duration * (isGif ? gifFps(displayFps) : displayFps)));
  // The sheet plan drives the readout, and its error (too many frames / too big) blocks Export.
  let spritePlan: ReturnType<typeof planSpriteSheet> | null = null;
  let spriteError: string | null = null;
  if (isSprites) {
    try {
      spritePlan = planSpriteSheet(project, { fps: displayFps, frameWidth: Number.isFinite(width) ? width : meta.width, columns, padding });
    } catch (err) {
      spriteError = (err as Error).message;
    }
  }

  const start = async () => {
    const s = useEditor.getState();
    const snapshot = s.history.present; // snapshot (spec §8)
    const binaries = s.binaries;
    // M-4: clearing a number input yields NaN, which survives Math.max/min clamping and would
    // otherwise reach the orchestrator as a broken option — fall back to the project defaults
    // before clamping.
    const rawFps = Number.isFinite(fps) ? fps : meta.fps;
    const rawWidth = Number.isFinite(width) ? width : meta.width;
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning({ phase: 'frames', fraction: 0 });
    try {
      const result = isSprites
        ? await exportSpriteSheet(
            snapshot,
            { fps: rawFps, frameWidth: rawWidth, columns: Number.isFinite(columns) ? columns : 0, padding: Number.isFinite(padding) ? padding : 0, background: transparent ? null : 'white' },
            (fraction) => setRunning({ phase: 'frames', fraction }),
            abort.signal,
          )
        : isGif
        ? await exportGif(
            snapshot,
            { fps: Math.max(1, Math.min(GIF_MAX_FPS, rawFps)), width: Math.max(16, Math.min(GIF_MAX_WIDTH, rawWidth)), loop },
            (fraction) => setRunning({ phase: 'frames', fraction }),
            abort.signal,
          )
        : await exportVideo(
        snapshot, binaries,
        { format, fps: Math.max(1, Math.min(60, rawFps)), width: Math.max(16, Math.min(3840, rawWidth)) },
        (phase, fraction) => setRunning({ phase, fraction }),
        abort.signal,
      );
      if (result) {
        await saveBytesToDisk(result.bytes, result.filename, result.mime);
        onClose();
        return;
      }
      setRunning(null); // cancelled: stay open, form re-enabled
    } catch (err) {
      // ffmpeg.wasm's worker bridge rejects EXEC errors with a plain string (e.toString() in
      // @ffmpeg/ffmpeg's worker.js), not an Error instance — fall back to String(err) so the
      // toast never reads "...failed: undefined".
      const message = err instanceof Error ? err.message : String(err);
      useEditor.getState().pushToast('error', `${isSprites ? 'Sprite sheet' : isGif ? 'GIF' : 'Video'} export failed: ${message}`);
      setRunning(null);
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-label="Export video"
      tabIndex={-1}
      ref={dialogRef}
      onKeyDown={(e) => {
        // Escape closes when idle; while an export is running it does NOTHING (no accidental
        // abort — Cancel is the explicit, visible control for that).
        if (e.key === 'Escape' && !running) onClose();
      }}
    >
      <div className={styles.panel}>
        <h2>{isSprites ? 'Export Sprite Sheet' : isGif ? 'Export GIF' : 'Export Video'}</h2>
        <label>
          Format
          <select aria-label="Format" value={format} disabled={!!running} onChange={(e) => {
            const next = e.target.value as ExportFormat;
            // Untouched width follows the format's default (artboard width vs a small sprite cell).
            if (next === 'sprites' && width === meta.width) setWidth(spriteDefaultWidth(meta.width));
            if (format === 'sprites' && next !== 'sprites' && width === spriteDefaultWidth(meta.width)) setWidth(meta.width);
            setFormat(next);
          }}>
            <option value="mp4">MP4 (H.264)</option>
            <option value="webm" disabled>WebM (VP9)</option>
            <option value="gif">Animated GIF</option>
            <option value="sprites">Sprite sheet (PNG + JSON)</option>
          </select>
        </label>
        {!isGif && !isSprites && (
          <p className={styles.warning} data-testid="webm-disabled-note">
            WebM is temporarily unavailable: the bundled in-browser encoder (ffmpeg.wasm) crashes on real frame
            content. Export MP4 — WebM returns with the server-side encoder.
          </p>
        )}
        <label>
          Frames per second
          <input aria-label="Frames per second" type="number" min={1} max={isGif ? GIF_MAX_FPS : isSprites ? SPRITE_SHEET_MAX_FPS : 60} value={fps} disabled={!!running}
            onChange={(e) => setFps(Number(e.target.value))} />
        </label>
        <label>
          {isSprites ? 'Frame width' : 'Width'}
          <input aria-label="Width" type="number" min={16} max={isGif ? GIF_MAX_WIDTH : 3840} step={2} value={width} disabled={!!running}
            onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        {isSprites && (
          <>
            <label>
              Columns (0 = auto)
              <input aria-label="Columns" type="number" min={0} value={columns} disabled={!!running}
                onChange={(e) => setColumns(Number(e.target.value))} />
            </label>
            <label>
              Padding
              <input aria-label="Padding" type="number" min={0} value={padding} disabled={!!running}
                onChange={(e) => setPadding(Number(e.target.value))} />
            </label>
            <label>
              <input aria-label="Transparent background" type="checkbox" checked={transparent} disabled={!!running}
                onChange={(e) => setTransparent(e.target.checked)} />
              Transparent background
            </label>
          </>
        )}
        {isGif && (
          <label>
            <input aria-label="Loop forever" type="checkbox" checked={loop} disabled={!!running} onChange={(e) => setLoop(e.target.checked)} />
            Loop forever
          </label>
        )}
        {isSprites ? (
          <p data-testid="export-video-summary">
            {spritePlan
              ? `${spritePlan.frameCount} frames · ${spritePlan.columns}×${spritePlan.rows} grid · ${spritePlan.width}×${spritePlan.height}px`
              : '—'}
          </p>
        ) : (
          <p data-testid="export-video-summary">{duration.toFixed(1)}s · {frameCount} frames</p>
        )}
        {spriteError && <p className={styles.warning} data-testid="sprite-sheet-error">{spriteError}</p>}
        {!running && isGif && Number.isFinite(fps) && fps > GIF_MAX_FPS && (
          <p className={styles.warning}>GIF plays at most {GIF_MAX_FPS} fps; frames are exported at {GIF_MAX_FPS}.</p>
        )}
        {!running && isGif && Number.isFinite(width) && width > GIF_MAX_WIDTH && (
          <p className={styles.warning}>GIF width is capped at {GIF_MAX_WIDTH}px.</p>
        )}
        {!running && !isGif && !isSprites && duration > 60 && (
          <p className={styles.warning}>Long project (&gt;60s): single-threaded encoding may take several minutes.</p>
        )}
        {!running && format === 'webm' && frameCount > WEBM_MAX_FRAMES && (
          <p className={styles.warning}>
            WebM is capped at {WEBM_MAX_FRAMES} frames on the in-browser encoder — lower the fps, shorten the project, or export MP4.
          </p>
        )}
        {running ? (
          <div className={styles.progressRow}>
            <span>{PHASE_LABEL[running.phase]}</span>
            <progress max={1} value={running.fraction} />
            <button type="button" aria-label="Cancel export" onClick={() => abortRef.current?.abort()}>Cancel</button>
          </div>
        ) : (
          <div className={styles.actions}>
            <button type="button" disabled={!!spriteError} onClick={() => void start()}>Export</button>
            <button type="button" aria-label="Close" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
