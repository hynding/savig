// Audio lip sync (roadmap 12): on a mouth symbol instance, pick a voice clip and key the instance
// so it shows a mouth pose per frame from the clip's loudness (quiet = rest pose, louder = wider
// poses). The symbol's poses are the keys of its frame-by-frame layer, rest pose first.
import { useState } from 'react';
import { store } from '@savig/editor-state';
import { frameLoudness } from '@savig/engine';
import { useEditor } from '../../store/store';
import { decodeAudioBuffer } from '../../audio/decode';
import styles from './Inspector.module.css';

export function LipSyncSection({ objectId }: { objectId: string }) {
  const clips = useEditor((s) => s.history.present.audioClips);
  const assets = useEditor((s) => s.history.present.assets);
  const [clipId, setClipId] = useState<string>('');
  const [sensitivity, setSensitivity] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const chosen = clips.find((c) => c.id === clipId) ?? clips[0];

  const run = async () => {
    if (!chosen) return;
    const s = store.getState();
    const bytes = s.binaries[chosen.assetId];
    if (!bytes) {
      s.pushToast('error', 'The audio for that clip is not loaded.');
      return;
    }
    setBusy(true);
    try {
      const buf = await decodeAudioBuffer(bytes);
      const fps = s.history.present.meta.fps;
      const levels = frameLoudness(buf.getChannelData(0), buf.sampleRate, fps, chosen.inPoint, chosen.outPoint, chosen.volume);
      const poses = store.getState().applyLipSync(objectId, { levels, startTime: chosen.startTime, sensitivity });
      setResult(poses > 0 ? `Synced ${levels.length} frames to ${poses} poses.` : null);
    } catch (err) {
      store.getState().pushToast('error', `Couldn't read that audio: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (assetId: string) => assets.find((a) => a.id === assetId)?.name ?? 'audio';
  return (
    <div data-testid="lip-sync-section">
      <div className={styles.group} title="Key this mouth symbol from a voice clip: its frame-by-frame layer holds the poses, rest (closed) first, then wider.">
        Lip sync
      </div>
      {clips.length === 0 ? (
        <div className={styles.row}>Import a voice clip to lip sync.</div>
      ) : (
        <>
          <div className={styles.row}>
            <label htmlFor="insp-lipsync-clip">voice</label>
            <select id="insp-lipsync-clip" data-testid="lip-sync-clip" value={chosen?.id ?? ''} onChange={(e) => setClipId(e.target.value)}>
              {clips.map((c) => (
                <option key={c.id} value={c.id}>
                  {nameOf(c.assetId)} @ {c.startTime.toFixed(2)}s
                </option>
              ))}
            </select>
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-lipsync-sens" title="Higher opens the mouth on quieter sound.">sensitivity</label>
            <input
              id="insp-lipsync-sens"
              data-testid="lip-sync-sensitivity"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sensitivity}
              onChange={(e) => setSensitivity(Number(e.target.value))}
            />
          </div>
          <div className={styles.row}>
            <button type="button" data-testid="lip-sync-run" disabled={busy} onClick={run}>
              {busy ? 'Syncing…' : 'Sync mouth to voice'}
            </button>
          </div>
          {result && <div className={styles.row} data-testid="lip-sync-result">{result}</div>}
        </>
      )}
    </div>
  );
}
