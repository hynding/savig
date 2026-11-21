// Audio lip sync (roadmap 12): on a mouth symbol instance, pick a voice clip and key the instance
// so it shows a mouth pose per frame from the clip's loudness (quiet = rest pose, louder = wider
// poses). The symbol's poses are the keys of its frame-by-frame layer, rest pose first.
// Vowel shapes (roadmap 13): when the poses carry frame labels (A, E, O, U, M, FV, rest), each
// frame's vowel picks the matching pose instead, so the mouth makes shapes, not just opens.
import { useState } from 'react';
import { store, selectActiveObjects } from '@savig/editor-state';
import { frameLoudness, frameVowels, lipSyncPoseTimes, visemePoseMap, VISEME_NAMES, type SymbolAsset } from '@savig/engine';
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
  const fps = useEditor((s) => s.history.present.meta.fps);
  const symbol = useEditor((s) => {
    const o = selectActiveObjects(s).find((x) => x.id === objectId);
    const a = o ? s.history.present.assets.find((x) => x.id === o.assetId) : undefined;
    return a?.kind === 'symbol' ? (a as SymbolAsset) : undefined;
  });
  const poseMap = symbol ? visemePoseMap(symbol, lipSyncPoseTimes(symbol, fps).length) : null;
  // Vowel shapes are the default once the poses are labeled; otherwise loudness, as before.
  const [modeChoice, setMode] = useState<'loudness' | 'vowels' | null>(null);
  const mode = modeChoice ?? (poseMap?.labeled ? 'vowels' : 'loudness');

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
      const samples = buf.getChannelData(0);
      const levels = frameLoudness(samples, buf.sampleRate, fps, chosen.inPoint, chosen.outPoint, chosen.volume);
      const vowels = mode === 'vowels' ? frameVowels(samples, buf.sampleRate, fps, chosen.inPoint, chosen.outPoint) : undefined;
      const poses = store.getState().applyLipSync(objectId, { levels, startTime: chosen.startTime, sensitivity, vowels });
      setResult(poses > 0 ? `Synced ${levels.length} frames to ${poses} ${mode === 'vowels' ? 'mouth shapes' : 'poses'}.` : null);
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
            <label htmlFor="insp-lipsync-mode" title="Loudness opens the mouth wider on louder sound. Vowel shapes pick a mouth shape per sound from the poses' frame labels.">
              shapes
            </label>
            <select id="insp-lipsync-mode" data-testid="lip-sync-mode" value={mode} onChange={(e) => setMode(e.target.value as 'loudness' | 'vowels')}>
              <option value="loudness">Loudness (open / close)</option>
              <option value="vowels">Vowel shapes</option>
            </select>
          </div>
          {mode === 'vowels' && poseMap && (
            <div className={styles.row} data-testid="lip-sync-shapes" title="Label the mouth symbol's frame keys A, E, O, U, M, FV and rest to choose which pose each shape uses.">
              {poseMap.labeled
                ? `Shapes: ${poseMap.matched.map((v) => VISEME_NAMES[v]).join(', ')}`
                : 'No shape labels: poses are used in the order rest, M, A, E, O, U, FV.'}
            </div>
          )}
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
