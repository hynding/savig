import { useMemo, useState } from 'react';
import { projectScenes } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectActiveSceneId } from '../../store/selectors';
import { sceneThumbnailSvg } from '../AssetPanel/thumbnailSvg';
import styles from './SceneStrip.module.css';

export function SceneStrip() {
  const present = useEditor((s) => s.history.present);
  const activeSceneId = useEditor((s) => selectActiveSceneId(s));
  const { addScene, deleteScene, reorderScene, renameScene, setSceneDuration, selectScene } = useEditor.getState();
  const scenes = useMemo(() => projectScenes(present), [present]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const isMultiScene = Boolean(present.scenes);

  return (
    <div className={styles.strip} role="list" aria-label="Scenes">
      {scenes.map((scene, index) => {
        const active = scene.id === activeSceneId || (!present.scenes && index === 0);
        return (
          <div
            key={scene.id}
            role="listitem"
            className={`${styles.tile} ${active ? styles.active : ''}`}
            draggable={isMultiScene}
            onDragStart={() => setDragId(scene.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId) reorderScene(dragId, index); setDragId(null); }}
          >
            <button
              type="button"
              data-testid={`scene-${scene.id}`}
              aria-label={`Scene ${scene.name}`}
              className={styles.thumb}
              onClick={() => selectScene(scene.id)}
              dangerouslySetInnerHTML={{ __html: sceneThumbnailSvg(scene, present.assets, present.meta) }}
            />
            {editingId === scene.id ? (
              <input
                autoFocus
                className={styles.name}
                defaultValue={scene.name}
                aria-label="Scene name"
                onBlur={(e) => { renameScene(scene.id, e.target.value || scene.name); setEditingId(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
            ) : (
              <span className={styles.name} onDoubleClick={() => setEditingId(scene.id)}>{scene.name}</span>
            )}
            {isMultiScene && (
              <input
                type="number"
                min={0}
                step={0.1}
                className={styles.duration}
                aria-label="Scene duration"
                value={scene.duration}
                onChange={(e) => setSceneDuration(scene.id, Number(e.target.value))}
              />
            )}
            {isMultiScene && scenes.length > 1 && (
              <button type="button" aria-label={`Delete ${scene.name}`} className={styles.del} onClick={() => deleteScene(scene.id)}>×</button>
            )}
          </div>
        );
      })}
      <button type="button" aria-label="Add scene" className={styles.add} onClick={() => addScene()}>+</button>
    </div>
  );
}
