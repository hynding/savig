import { useMemo, useRef, useState } from 'react';
import { store } from '@savig/editor-state';
import { sceneStripViewModel, sceneStripIntents } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import { sceneThumbnailSvg } from '../AssetPanel/thumbnailSvg';
import styles from './SceneStrip.module.css';

export function SceneStrip() {
  const vm = useEditorVM(sceneStripViewModel);
  const intents = useMemo(() => sceneStripIntents(store), []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const cancelRename = useRef(false);

  return (
    <div className={styles.strip} role="list" aria-label="Scenes">
      {vm.scenes.map((scene, index) => (
        <div
          key={scene.id}
          role="listitem"
          className={`${styles.tile} ${scene.active ? styles.active : ''}`}
          draggable={vm.isMultiScene}
          onDragStart={() => setDragId(scene.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (dragId) intents.reorderScene(dragId, index); setDragId(null); }}
        >
          <button
            type="button"
            data-testid={`scene-${scene.id}`}
            aria-label={`Scene ${scene.name}`}
            className={styles.thumb}
            onClick={() => intents.selectScene(scene.id)}
            dangerouslySetInnerHTML={{ __html: sceneThumbnailSvg(scene.scene, vm.assets, vm.meta) }}
          />
          {editingId === scene.id ? (
            <input
              autoFocus
              className={styles.name}
              defaultValue={scene.name}
              aria-label="Scene name"
              onBlur={(e) => {
                if (!cancelRename.current) intents.renameScene(scene.id, e.target.value || scene.name);
                cancelRename.current = false;
                setEditingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { cancelRename.current = true; (e.target as HTMLInputElement).blur(); }
              }}
            />
          ) : (
            <span className={styles.name} onDoubleClick={() => setEditingId(scene.id)}>{scene.name}</span>
          )}
          {vm.isMultiScene && (
            <input
              type="number"
              min={0}
              step={0.1}
              className={styles.duration}
              aria-label="Scene duration"
              value={scene.duration}
              onChange={(e) => intents.setSceneDuration(scene.id, Number(e.target.value))}
            />
          )}
          {scene.showTransition && (
            <div className={styles.transition}>
              <select
                aria-label="Transition"
                value={scene.transitionIn?.kind ?? 'cut'}
                onChange={(e) => {
                  const kind = e.target.value as 'cut' | 'crossfade' | 'dip';
                  if (kind === 'cut') intents.setSceneTransition(scene.id, { kind: 'cut' });
                  else if (kind === 'crossfade') intents.setSceneTransition(scene.id, { kind: 'crossfade', duration: scene.transitionIn && scene.transitionIn.kind !== 'cut' ? scene.transitionIn.duration : 0.5 });
                  else intents.setSceneTransition(scene.id, { kind: 'dip', duration: scene.transitionIn && scene.transitionIn.kind !== 'cut' ? scene.transitionIn.duration : 0.5, color: scene.transitionIn?.kind === 'dip' ? scene.transitionIn.color : '#000000' });
                }}
              >
                <option value="cut">Cut</option>
                <option value="crossfade">Crossfade</option>
                <option value="dip">Dip</option>
              </select>
              {scene.transitionIn && scene.transitionIn.kind !== 'cut' && (
                <input
                  type="number" min={0} step={0.1} aria-label="Transition duration"
                  value={scene.transitionIn.duration}
                  onChange={(e) => {
                    const duration = Number(e.target.value);
                    const t = scene.transitionIn!;
                    intents.setSceneTransition(scene.id, t.kind === 'dip' ? { kind: 'dip', duration, color: t.color } : { kind: 'crossfade', duration });
                  }}
                />
              )}
              {scene.transitionIn?.kind === 'dip' && (
                <input
                  type="color" aria-label="Transition color" value={scene.transitionIn.color}
                  onChange={(e) => intents.setSceneTransition(scene.id, { kind: 'dip', duration: (scene.transitionIn as { duration: number }).duration, color: e.target.value })}
                />
              )}
            </div>
          )}
          {vm.canDelete && (
            <button type="button" aria-label={`Delete ${scene.name}`} className={styles.del} onClick={() => intents.deleteScene(scene.id)}>×</button>
          )}
        </div>
      ))}
      <button type="button" aria-label="Add scene" className={styles.add} onClick={() => intents.addScene()}>+</button>
    </div>
  );
}
