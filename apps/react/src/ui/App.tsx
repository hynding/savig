import { useEffect, useMemo, useRef, useState } from 'react';
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
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { ShortcutsSheet } from './components/ShortcutsSheet/ShortcutsSheet';
import { TemplateGallery } from './components/TemplateGallery/TemplateGallery';
import { GettingStarted } from './components/GettingStarted/GettingStarted';
import { makeCommandHost } from './commandHost';

type Overlay = 'palette' | 'shortcuts' | 'templates' | null;

const GS_DISMISSED_KEY = 'savig.gettingStarted.dismissed';

export function App() {
  const nodesRef = useRef<Map<string, SVGGraphicsElement>>(new Map());
  const getNodes = useMemo(() => () => nodesRef.current, []);
  const theme = useEditor((s) => s.theme);
  const [overlay, setOverlay] = useState<Overlay>(null);
  // First-run checklist: shown until dismissed (persisted). Re-openable via the palette command.
  const [showGettingStarted, setShowGettingStarted] = useState(() => {
    try {
      return !localStorage.getItem(GS_DISMISSED_KEY);
    } catch {
      return true;
    }
  });
  const dismissGettingStarted = () => {
    try {
      localStorage.setItem(GS_DISMISSED_KEY, '1');
    } catch {
      // ignore storage failures (private mode); it just re-appears next launch
    }
    setShowGettingStarted(false);
  };
  // Stable host: the setState setters are stable, so the keymap controller (built once) keeps a valid host.
  const host = useMemo(
    () =>
      makeCommandHost({
        openPalette: () => setOverlay('palette'),
        openShortcuts: () => setOverlay('shortcuts'),
        openTemplates: () => setOverlay('templates'),
        openGettingStarted: () => setShowGettingStarted(true),
        closeOverlay: () => setOverlay(null),
      }),
    [],
  );

  usePlayback(getNodes);
  useKeyboard(host, overlay !== null); // suppress global shortcuts while an overlay owns the keyboard
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
        <button aria-label="New from template" title="New from template" onClick={() => setOverlay('templates')}>🎬</button>
        <button aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setOverlay('shortcuts')}>?</button>
        <ThemeToggle />
      </section>
      <section className={styles.assets} aria-label="Assets">
        <AssetPanel />
        <LayersPanel />
      </section>
      <section className={styles.stage} aria-label="Stage">
        <EditBreadcrumb />
        <Stage nodes={nodesRef.current} />
        {showGettingStarted && <GettingStarted onDismiss={dismissGettingStarted} />}
        <ToastHost />
      </section>
      <section className={styles.inspector} aria-label="Inspector">
        <Inspector />
      </section>
      <section className={styles.timeline} aria-label="Timeline">
        <SceneStrip />
        <Timeline />
      </section>
      {overlay === 'palette' && <CommandPalette host={host} onClose={() => setOverlay(null)} />}
      {overlay === 'shortcuts' && <ShortcutsSheet onClose={() => setOverlay(null)} />}
      {overlay === 'templates' && <TemplateGallery onClose={() => setOverlay(null)} />}
    </div>
  );
}
