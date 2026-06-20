import { computeProjectDuration } from '../../../engine';
import { useEditor } from '../../store/store';
import { formatTime } from './formatTime';
import styles from './TransportControls.module.css';

export function TransportControls() {
  const playing = useEditor((s) => s.playing);
  const time = useEditor((s) => s.time);
  const loop = useEditor((s) => s.history.present.meta.loop);
  const duration = useEditor((s) => computeProjectDuration(s.history.present));
  const { setPlaying, stepFrame, commit } = useEditor.getState();

  const toggleLoop = () => {
    const p = useEditor.getState().history.present;
    commit({ ...p, meta: { ...p.meta, loop: !p.meta.loop } });
  };

  return (
    <div className={styles.bar}>
      <button className={styles.btn} aria-label="Step back" onClick={() => stepFrame(-1)}>⏮</button>
      <button className={styles.btn} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
        {playing ? '⏸' : '▶'}
      </button>
      <button className={styles.btn} aria-label="Step forward" onClick={() => stepFrame(1)}>⏭</button>
      <button
        className={`${styles.btn} ${loop ? styles.on : ''}`}
        aria-label="Loop"
        aria-pressed={loop}
        onClick={toggleLoop}
      >⟲</button>
      <span className={styles.time}>{formatTime(time)} / {formatTime(duration)}</span>
    </div>
  );
}
