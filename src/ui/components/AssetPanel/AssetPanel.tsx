import { useId, useState } from 'react';
import { importAudio, importSvg } from '../../../services';
import { countSymbolInstances, symbolContains } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectActiveAssetId } from '../../store/selectors';
import { readFileBytes, readFileText } from './readFile';
import { SymbolThumbnail } from './SymbolThumbnail';
import styles from './AssetPanel.module.css';

export function AssetPanel() {
  // Subscribe narrowly: re-render only when objects or assets change (not on every commit). Both
  // are needed because countSymbolInstances spans the root objects AND every symbol's objects.
  const objects = useEditor((s) => s.history.present.objects);
  const assets = useEditor((s) => s.history.present.assets);
  const meta = useEditor((s) => s.history.present.meta);
  const activeAssetId = useEditor(selectActiveAssetId);
  const { addAsset, addObject, addAudioClip, placeSymbolInstance, pushToast, renameAsset, deleteSymbol, deleteAsset } = useEditor.getState();
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const symbols = assets.filter((a) => a.kind === 'symbol');
  // Only reusable library imports get a row; per-shape `vector` assets are 1:1 with their object
  // (not library items) and `symbol` assets have their own section below. (47d)
  const libraryAssets = assets.filter((a) => a.kind === 'svg' || a.kind === 'audio');

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
        {libraryAssets.map((a) => {
          const manageable = a.kind === 'svg' || a.kind === 'audio';
          return (
            <div className={styles.symbolRow} key={a.id}>
              {editingId === a.id ? (
                <input
                  className={styles.renameInput}
                  data-testid={`asset-rename-${a.id}`}
                  defaultValue={a.name}
                  autoFocus
                  onBlur={(e) => { renameAsset(a.id, e.currentTarget.value); setEditingId(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingId(null); }}
                />
              ) : (
                <button
                  className={styles.item}
                  data-testid={`asset-${a.id}`}
                  onClick={() => (a.kind === 'svg' ? addObject(a.id) : addAudioClip(a.id))}
                >
                  {a.kind === 'audio' ? '♪ ' : ''}{a.name}
                </button>
              )}
              {manageable && (
                <>
                  <button className={styles.rowBtn} aria-label={`Rename ${a.name}`} onClick={() => setEditingId(a.id)}>✎</button>
                  <button className={styles.rowBtn} aria-label={`Delete ${a.name}`} onClick={() => deleteAsset(a.id)}>×</button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {symbols.length > 0 && (
        <div className={styles.symbols} data-testid="symbols-section">
          <div className={styles.sectionTitle}>Symbols</div>
          {symbols.map((sym) => {
            const cyclic = !!activeAssetId && (sym.id === activeAssetId || symbolContains(sym.id, activeAssetId, assets));
            return (
              <div className={styles.symbolRow} key={sym.id}>
                {editingId === sym.id ? (
                  <input
                    className={styles.renameInput}
                    data-testid={`symbol-rename-${sym.id}`}
                    defaultValue={sym.name}
                    autoFocus
                    onBlur={(e) => { renameAsset(sym.id, e.currentTarget.value); setEditingId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    className={styles.item}
                    data-testid={`symbol-${sym.id}`}
                    disabled={cyclic}
                    title={cyclic ? 'Would create a containment cycle' : 'Place an instance'}
                    onClick={() => placeSymbolInstance(sym.id)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-savig-symbol', sym.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    <SymbolThumbnail symbol={sym} assets={assets} meta={meta} />
                    <span>{sym.name} ({countSymbolInstances(sym.id, { objects, assets })})</span>
                  </button>
                )}
                <button className={styles.rowBtn} aria-label={`Rename ${sym.name}`} onClick={() => setEditingId(sym.id)}>✎</button>
                <button className={styles.rowBtn} aria-label={`Delete ${sym.name}`} onClick={() => deleteSymbol(sym.id)}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
