// Options + progress + cancel for browser video export (spec §7). Overlay pattern mirrors
// TemplateGallery; the global keymap is already suppressed while any overlay is open (App.tsx
// passes overlay !== null to useKeyboard). Snapshot semantics (spec §8): project + binaries
// are captured ONCE at Export-click and handed to the orchestrator.
import { useRef, useState } from 'react';
import { computeProjectDuration } from '@savig/engine';
import { WEBM_MAX_FRAMES, saveBytesToDisk } from '@savig/services';
import { useEditor } from '../../store/store';
import { exportVideo, type VideoPhase } from '../../export/videoExport';
import styles from './ExportVideoDialog.module.css';

const PHASE_LABEL: Record<VideoPhase, string> = {
  frames: 'rendering frames…',
  audio: 'mixing audio…',
  encode: 'encoding…',
  finalize: 'finalizing…',
};

export function ExportVideoDialog({ onClose }: { onClose: () => void }) {
  const meta = useEditor((s) => s.history.present.meta);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [fps, setFps] = useState(meta.fps);
  const [width, setWidth] = useState(meta.width);
  const [running, setRunning] = useState<{ phase: VideoPhase; fraction: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = async () => {
    const s = useEditor.getState();
    const project = s.history.present; // snapshot (spec §8)
    const binaries = s.binaries;
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning({ phase: 'frames', fraction: 0 });
    try {
      const result = await exportVideo(
        project, binaries,
        { format, fps: Math.max(1, Math.min(60, fps)), width: Math.max(16, Math.min(3840, width)) },
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
      useEditor.getState().pushToast('error', `Video export failed: ${message}`);
      setRunning(null);
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-label="Export video">
      <div className={styles.panel}>
        <h2>Export Video</h2>
        <label>
          Format
          <select aria-label="Format" value={format} disabled={!!running} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}>
            <option value="mp4">MP4 (H.264)</option>
            <option value="webm" disabled>WebM (VP9)</option>
          </select>
        </label>
        <p className={styles.warning} data-testid="webm-disabled-note">
          WebM is temporarily unavailable: the bundled in-browser encoder (ffmpeg.wasm) crashes on real frame
          content. Export MP4 — WebM returns with the server-side encoder.
        </p>
        <label>
          Frames per second
          <input aria-label="Frames per second" type="number" min={1} max={60} value={fps} disabled={!!running}
            onChange={(e) => setFps(Number(e.target.value))} />
        </label>
        <label>
          Width
          <input aria-label="Width" type="number" min={16} max={3840} step={2} value={width} disabled={!!running}
            onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        {!running && computeProjectDuration(useEditor.getState().history.present) > 60 && (
          <p className={styles.warning}>Long project (&gt;60s): single-threaded encoding may take several minutes.</p>
        )}
        {!running && format === 'webm' &&
          Math.round(computeProjectDuration(useEditor.getState().history.present) * fps) > WEBM_MAX_FRAMES && (
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
            <button type="button" onClick={() => void start()}>Export</button>
            <button type="button" aria-label="Close" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
