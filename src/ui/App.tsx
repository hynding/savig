import { useEffect, useMemo, useRef } from 'react';
import './theme/tokens.css';
import './theme/global.css';
import styles from './App.module.css';
import { useEditor } from './store/store';
import { usePlayback } from './playback/usePlayback';
import { useKeyboard } from './hooks/useKeyboard';
import { useAutosave } from './hooks/useAutosave';
import { createAudioTransport } from './playback/audioTransport';
import { FileToolbar } from './components/FileToolbar/FileToolbar';
import { TransportControls } from './components/TransportControls/TransportControls';
import { ThemeToggle } from './components/ThemeToggle/ThemeToggle';
import { AssetPanel } from './components/AssetPanel/AssetPanel';
import { Stage } from './components/Stage/Stage';
import { Inspector } from './components/Inspector/Inspector';
import { Timeline } from './components/Timeline/Timeline';
import { ToastHost } from './components/Toast/Toast';

export function App() {
  const nodesRef = useRef<Map<string, SVGGraphicsElement>>(new Map());
  const getNodes = useMemo(() => () => nodesRef.current, []);
  const theme = useEditor((s) => s.theme);

  usePlayback(getNodes);
  useKeyboard();
  useAutosave();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Audio transport: the Play gesture starts audio; pause/seek stops it.
  useEffect(() => {
    const transport = createAudioTransport();
    const unsub = useEditor.subscribe((state, prev) => {
      if (state.playing === prev.playing) return;
      const s = useEditor.getState();
      if (state.playing) {
        void transport.start(s.history.present, s.binaries, s.time);
      } else {
        transport.stop();
      }
    });
    return () => {
      transport.stop();
      unsub();
    };
  }, []);

  return (
    <div className={styles.app}>
      <section className={styles.toolbar} aria-label="Toolbar">
        <FileToolbar />
        <TransportControls />
        <span className={styles.spacer} />
        <ThemeToggle />
      </section>
      <section className={styles.assets} aria-label="Assets">
        <AssetPanel />
      </section>
      <section className={styles.stage} aria-label="Stage">
        <Stage nodes={nodesRef.current} />
        <ToastHost />
      </section>
      <section className={styles.inspector} aria-label="Inspector">
        <Inspector />
      </section>
      <section className={styles.timeline} aria-label="Timeline">
        <Timeline />
      </section>
    </div>
  );
}
