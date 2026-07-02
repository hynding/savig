import { useMemo } from 'react';
import { store } from '@savig/editor-state';
import { transportControlsViewModel, transportControlsIntents } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import styles from './TransportControls.module.css';

export function TransportControls() {
  const vm = useEditorVM(transportControlsViewModel);
  const intents = useMemo(() => transportControlsIntents(store), []);

  return (
    <div className={styles.bar}>
      <button className={styles.btn} aria-label="Step back" onClick={() => intents.stepFrame(-1)}>⏮</button>
      <button className={styles.btn} aria-label={vm.playing ? 'Pause' : 'Play'} onClick={() => intents.setPlaying(!vm.playing)}>
        {vm.playing ? '⏸' : '▶'}
      </button>
      <button className={styles.btn} aria-label="Step forward" onClick={() => intents.stepFrame(1)}>⏭</button>
      <button
        className={`${styles.btn} ${vm.loop ? styles.on : ''}`}
        aria-label="Loop"
        aria-pressed={vm.loop}
        onClick={intents.toggleLoop}
      >⟲</button>
      <span className={styles.time}>{vm.currentTimeLabel} / {vm.durationLabel}</span>
    </div>
  );
}
