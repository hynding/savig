import { useEffect, useMemo, useRef } from 'react';
import type { Project } from '@savig/engine';
import '@savig/theme/tokens.css';
import '@savig/theme/global.css';
import styles from './App.module.css';
import { useEditor } from './store/store';
import { selectEditProject } from './store/selectors';
import { applyFrame } from './playback/applyFrame';
import { usePlayback } from './playback/usePlayback';
import { useKeyboard } from './hooks/useKeyboard';
import { useAutosave } from './hooks/useAutosave';
import { FileToolbar } from './components/FileToolbar/FileToolbar';
import { TransportControls } from './components/TransportControls/TransportControls';
import { ToolPalette } from './components/Toolbar/ToolPalette';
import { PrimitiveOptions } from './components/Toolbar/PrimitiveOptions';
import { ThemeToggle } from './components/ThemeToggle/ThemeToggle';
import { AssetPanel } from './components/AssetPanel/AssetPanel';
import { LayersPanel } from './components/LayersPanel/LayersPanel';
import { Stage } from './components/Stage/Stage';
import { EditBreadcrumb } from './components/Stage/EditBreadcrumb';
import { Inspector } from './components/Inspector/Inspector';
import { Timeline } from './components/Timeline/Timeline';
import { SceneStrip } from './components/SceneStrip/SceneStrip';
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

  // Cross-app test contract (@portable e2e): a SYNCHRONOUS seek that paints a deterministic frame
  // into the live node map (no React re-render, so one page.evaluate can seek + read), plus a
  // fixture loader. The Svelte PoC exposes the identical hooks — and both paint through the same
  // computeFrame/applyFrameToNodes, so a seeked transform is byte-identical across the two apps.
  useEffect(() => {
    const w = window as unknown as {
      savigSeek: (t: number) => void;
      savigLoadProject: (p: Project) => void;
    };
    w.savigSeek = (t) => applyFrame(nodesRef.current, selectEditProject(useEditor.getState()), t);
    w.savigLoadProject = (p) => useEditor.getState().setProject(p);
  }, []);

  return (
    <div className={styles.app}>
      <section className={styles.toolbar} aria-label="Toolbar">
        <FileToolbar />
        <TransportControls />
        <ToolPalette />
        <PrimitiveOptions />
        <span className={styles.spacer} />
        <ThemeToggle />
      </section>
      <section className={styles.assets} aria-label="Assets">
        <AssetPanel />
        <LayersPanel />
      </section>
      <section className={styles.stage} aria-label="Stage">
        <EditBreadcrumb />
        <Stage nodes={nodesRef.current} />
        <ToastHost />
      </section>
      <section className={styles.inspector} aria-label="Inspector">
        <Inspector />
      </section>
      <section className={styles.timeline} aria-label="Timeline">
        <SceneStrip />
        <Timeline />
      </section>
    </div>
  );
}
