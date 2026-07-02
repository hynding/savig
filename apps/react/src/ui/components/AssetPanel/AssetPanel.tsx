import { useId, useMemo, useState } from 'react';
import { importAudio, importSvg } from '@savig/services';
import { store } from '@savig/editor-state';
import { assetPanelViewModel, assetPanelIntents } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import { readFileBytes, readFileText } from './readFile';
import { SymbolThumbnail } from './SymbolThumbnail';
import styles from './AssetPanel.module.css';

export function AssetPanel() {
  const vm = useEditorVM(assetPanelViewModel);
  const intents = useMemo(() => assetPanelIntents(store), []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const svgId = useId();
  const audioId = useId();

  const onSvg = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { asset, warnings } = importSvg(await readFileText(file), file.name);
      intents.addAsset(asset);
      warnings.forEach((w) => intents.pushToast('info', w));
    } catch (err) {
      intents.pushToast('error', (err as Error).message);
    }
  };

  const onAudio = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bytes = await readFileBytes(file);
      const { asset } = importAudio(file.name, bytes, file.type);
      intents.addAsset(asset, bytes);
    } catch (err) {
      intents.pushToast('error', (err as Error).message);
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
        {vm.libraryAssets.map((a) => {
          // Every libraryAssets row is svg/audio, so rename/delete always apply.
          return (
            <div className={styles.symbolRow} key={a.id}>
              {editingId === a.id ? (
                <input
                  className={styles.renameInput}
                  data-testid={`asset-rename-${a.id}`}
                  defaultValue={a.name}
                  autoFocus
                  onBlur={(e) => { intents.renameAsset(a.id, e.currentTarget.value); setEditingId(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingId(null); }}
                />
              ) : (
                <button
                  className={styles.item}
                  data-testid={`asset-${a.id}`}
                  onClick={() => (a.kind === 'svg' ? intents.addObject(a.id) : intents.addAudioClip(a.id))}
                >
                  {a.kind === 'audio' ? '♪ ' : ''}{a.name}
                </button>
              )}
              <button className={styles.rowBtn} aria-label={`Rename ${a.name}`} onClick={() => setEditingId(a.id)}>✎</button>
              <button className={styles.rowBtn} aria-label={`Delete ${a.name}`} onClick={() => intents.deleteAsset(a.id)}>×</button>
            </div>
          );
        })}
      </div>
      {vm.symbols.length > 0 && (
        <div className={styles.symbols} data-testid="symbols-section">
          <div className={styles.sectionTitle}>Symbols</div>
          {vm.symbols.map((sym) => (
            <div className={styles.symbolRow} key={sym.id}>
              {editingId === sym.id ? (
                <input
                  className={styles.renameInput}
                  data-testid={`symbol-rename-${sym.id}`}
                  defaultValue={sym.name}
                  autoFocus
                  onBlur={(e) => { intents.renameAsset(sym.id, e.currentTarget.value); setEditingId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <button
                  className={styles.item}
                  data-testid={`symbol-${sym.id}`}
                  disabled={sym.cyclic}
                  title={sym.cyclic ? 'Would create a containment cycle' : 'Place an instance'}
                  onClick={() => intents.placeSymbolInstance(sym.id)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-savig-symbol', sym.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <SymbolThumbnail symbol={sym.symbol} assets={vm.assets} meta={vm.meta} />
                  <span>{sym.name} ({sym.instanceCount})</span>
                </button>
              )}
              <button className={styles.rowBtn} aria-label={`Rename ${sym.name}`} onClick={() => setEditingId(sym.id)}>✎</button>
              <button className={styles.rowBtn} aria-label={`Delete ${sym.name}`} onClick={() => intents.deleteSymbol(sym.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
