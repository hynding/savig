import { snapToFrame } from '../../../engine';
import type { AnimatableProperty, Keyframe } from '../../../engine';
import { useEditor } from '../../store/store';
import { timeToX, xToTime } from './scale';
import styles from './Timeline.module.css';

export function Timeline() {
  const time = useEditor((s) => s.time);
  const fps = useEditor((s) => s.history.present.meta.fps);
  const objects = useEditor((s) => s.history.present.objects);
  const audioClips = useEditor((s) => s.history.present.audioClips);
  const selectedObjectId = useEditor((s) => s.selectedObjectId);
  const selectedKeyframe = useEditor((s) => s.selectedKeyframe);
  const autoKey = useEditor((s) => s.autoKey);
  const { seek, selectObject, selectKeyframe, toggleAutoKey } = useEditor.getState();

  const scrub = (clientX: number, rulerLeft: number) => {
    seek(snapToFrame(xToTime(Math.max(0, clientX - rulerLeft)), fps));
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <button
          className={`${styles.toggle} ${autoKey ? styles.on : ''}`}
          aria-pressed={autoKey}
          onClick={toggleAutoKey}
        >
          Auto-key
        </button>
      </div>
      <div className={styles.scroll}>
        <div
          className={styles.ruler}
          data-testid="timeline-ruler"
          onPointerDown={(e) => scrub(e.clientX, e.currentTarget.getBoundingClientRect().left)}
        />
        <div className={styles.rows}>
          {objects.map((obj) => (
            <div key={obj.id} className={styles.row} data-testid={`track-row-${obj.id}`}>
              <div
                className={`${styles.label} ${obj.id === selectedObjectId ? styles.labelSelected : ''}`}
                data-testid={`track-label-${obj.id}`}
                onClick={() => selectObject(obj.id)}
              >
                {obj.name}
              </div>
              <div className={styles.lane}>
                {(Object.entries(obj.tracks) as [AnimatableProperty, Keyframe[]][]).flatMap(
                  ([prop, track]) =>
                    (track ?? []).map((kf) => {
                      const isSel =
                        selectedKeyframe?.objectId === obj.id &&
                        selectedKeyframe.property === prop &&
                        selectedKeyframe.time === kf.time;
                      return (
                        <div
                          key={`${prop}-${kf.time}`}
                          className={`${styles.diamond} ${isSel ? styles.diamondSelected : ''}`}
                          data-testid={`keyframe-${obj.id}-${prop}-${kf.time}`}
                          style={{ left: `${timeToX(kf.time)}px` }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            selectKeyframe({ objectId: obj.id, property: prop, time: kf.time });
                          }}
                        />
                      );
                    }),
                )}
              </div>
            </div>
          ))}
        </div>
        <div className={styles.audioRow}>
          <div className={styles.label}>♪ Audio</div>
          <div className={styles.lane}>
            {audioClips.map((clip) => (
              <div
                key={clip.id}
                className={styles.clip}
                data-testid={`audio-clip-${clip.id}`}
                style={{
                  left: `${timeToX(clip.startTime)}px`,
                  width: `${Math.max(2, timeToX(clip.outPoint - clip.inPoint))}px`,
                }}
              />
            ))}
          </div>
        </div>
        <div className={styles.playhead} data-testid="playhead" style={{ left: `${timeToX(time)}px` }} />
      </div>
    </div>
  );
}
