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
  const selectedShapeKeyframe = useEditor((s) => s.selectedShapeKeyframe);
  const selectedColorKeyframe = useEditor((s) => s.selectedColorKeyframe);
  const selectedGradientKeyframe = useEditor((s) => s.selectedGradientKeyframe);
  const selectedDashKeyframe = useEditor((s) => s.selectedDashKeyframe);
  const selectedProgressKeyframe = useEditor((s) => s.selectedProgressKeyframe);
  const autoKey = useEditor((s) => s.autoKey);
  const { seek, selectObject, selectKeyframe, selectShapeKeyframe, selectColorKeyframe, selectGradientKeyframe, selectDashKeyframe, selectProgressKeyframe, toggleAutoKey } =
    useEditor.getState();

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
                {(obj.shapeTrack ?? []).map((kf) => {
                  const isSel =
                    selectedShapeKeyframe?.objectId === obj.id && selectedShapeKeyframe.time === kf.time;
                  return (
                    <div
                      key={`shape-${kf.time}`}
                      className={`${styles.diamond} ${styles.shapeDiamond} ${isSel ? styles.diamondSelected : ''}`}
                      data-testid={`shape-keyframe-${obj.id}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        selectShapeKeyframe({ objectId: obj.id, time: kf.time });
                      }}
                    />
                  );
                })}
                {(['fill', 'stroke'] as const).flatMap((property) =>
                  (obj.colorTracks?.[property] ?? []).map((kf) => {
                    const isSel =
                      selectedColorKeyframe?.objectId === obj.id &&
                      selectedColorKeyframe.property === property &&
                      selectedColorKeyframe.time === kf.time;
                    return (
                      <div
                        key={`color-${property}-${kf.time}`}
                        className={`${styles.diamond} ${styles.colorDiamond} ${isSel ? styles.diamondSelected : ''}`}
                        data-testid={`color-keyframe-${obj.id}-${property}-${kf.time}`}
                        style={{ left: `${timeToX(kf.time)}px` }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          selectColorKeyframe({ objectId: obj.id, property, time: kf.time });
                        }}
                      />
                    );
                  }),
                )}
                {(['fill', 'stroke'] as const).flatMap((property) =>
                  (obj.gradientTracks?.[property] ?? []).map((kf) => {
                    const isSel =
                      selectedGradientKeyframe?.objectId === obj.id &&
                      selectedGradientKeyframe.property === property &&
                      selectedGradientKeyframe.time === kf.time;
                    return (
                      <div
                        key={`gradient-${property}-${kf.time}`}
                        className={`${styles.diamond} ${styles.gradientDiamond} ${isSel ? styles.diamondSelected : ''}`}
                        data-testid={`gradient-keyframe-${obj.id}-${property}-${kf.time}`}
                        style={{ left: `${timeToX(kf.time)}px` }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          selectGradientKeyframe({ objectId: obj.id, property, time: kf.time });
                        }}
                      />
                    );
                  }),
                )}
                {(obj.dashOffsetTrack ?? []).map((kf) => {
                  const isSel =
                    selectedDashKeyframe?.objectId === obj.id && selectedDashKeyframe.time === kf.time;
                  return (
                    <div
                      key={`dash-${kf.time}`}
                      className={`${styles.diamond} ${styles.dashDiamond} ${isSel ? styles.diamondSelected : ''}`}
                      data-testid={`dash-keyframe-${obj.id}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        selectDashKeyframe({ objectId: obj.id, time: kf.time });
                      }}
                    />
                  );
                })}
                {(obj.motionPath?.progress ?? []).map((kf) => {
                  const isSel =
                    selectedProgressKeyframe?.objectId === obj.id && selectedProgressKeyframe.time === kf.time;
                  return (
                    <div
                      key={`progress-${kf.time}`}
                      className={`${styles.diamond} ${styles.progressDiamond} ${isSel ? styles.diamondSelected : ''}`}
                      data-testid={`progress-keyframe-${obj.id}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        selectProgressKeyframe({ objectId: obj.id, time: kf.time });
                      }}
                    />
                  );
                })}
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
