import { useId } from 'react';
import { importAudio, importSvg } from '../../../services';
import { useEditor } from '../../store/store';
import { readFileBytes, readFileText } from './readFile';
import styles from './AssetPanel.module.css';

export function AssetPanel() {
  const assets = useEditor((s) => s.history.present.assets);
  const { addAsset, addObject, addAudioClip, pushToast } = useEditor.getState();
  const svgId = useId();
  const audioId = useId();

  const onSvg = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { asset, warnings } = importSvg(await readFileText(file), file.name);
      addAsset(asset);
      warnings.forEach((w) => pushToast('info', w));
    } catch (err) {
      pushToast('error', (err as Error).message);
    }
  };

  const onAudio = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bytes = await readFileBytes(file);
      const { asset } = importAudio(file.name, bytes, file.type);
      addAsset(asset, bytes);
    } catch (err) {
      pushToast('error', (err as Error).message);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.imports}>
        <label className={styles.fileBtn} htmlFor={svgId}>Import SVG</label>
        <input
          id={svgId}
          className={styles.hidden}
          type="file"
          accept=".svg,image/svg+xml"
          aria-label="Import SVG"
          onChange={(e) => void onSvg(e.target.files?.[0])}
        />
        <label className={styles.fileBtn} htmlFor={audioId}>Import Audio</label>
        <input
          id={audioId}
          className={styles.hidden}
          type="file"
          accept="audio/*"
          aria-label="Import Audio"
          onChange={(e) => void onAudio(e.target.files?.[0])}
        />
      </div>
      <div className={styles.list}>
        {assets.map((a) => (
          <button
            key={a.id}
            className={styles.item}
            onClick={() => (a.kind === 'svg' ? addObject(a.id) : addAudioClip(a.id))}
          >
            {a.kind === 'audio' ? '♪ ' : ''}
            {a.name}
          </button>
        ))}
      </div>
    </div>
  );
}
