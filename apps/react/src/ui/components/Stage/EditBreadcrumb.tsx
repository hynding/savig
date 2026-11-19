import type { ButtonState } from '@savig/engine';
import { useEditor } from '../../store/store';
import styles from './EditBreadcrumb.module.css';

const STATES: readonly { state: ButtonState | null; label: string }[] = [
  { state: null, label: 'All' },
  { state: 'up', label: 'Up' },
  { state: 'over', label: 'Over' },
  { state: 'down', label: 'Down' },
  { state: 'hit', label: 'Hit' },
];

// The "you are inside a symbol" path: Root › SymA › SymB. Each prior segment exits to that depth;
// the last segment is the current scene. Renders nothing at the root (slice 47 edit-mode).
export function EditBreadcrumb() {
  const editPath = useEditor((s) => s.editPath);
  const assets = useEditor((s) => s.history.present.assets);
  const exitToDepth = useEditor((s) => s.exitToDepth);
  const previewState = useEditor((s) => s.buttonPreviewState);
  const setPreviewState = useEditor((s) => s.setButtonPreviewState);
  if (editPath.length === 0) return null;
  const current = assets.find((x) => x.id === editPath.at(-1));
  const isButton = current?.kind === 'symbol' && current.button === true;
  const names = editPath.map((id) => {
    const a = assets.find((x) => x.id === id);
    return a && a.kind === 'symbol' ? a.name : 'Symbol';
  });
  return (
    <nav className={styles.breadcrumb} aria-label="Edit path" data-testid="edit-breadcrumb">
      <button type="button" onClick={() => exitToDepth(0)}>Root</button>
      {names.map((name, i) => (
        <span key={`${editPath[i]}-${i}`}>
          <span className={styles.sep} aria-hidden="true"> › </span>
          {i < names.length - 1 ? (
            <button type="button" onClick={() => exitToDepth(i + 1)}>{name}</button>
          ) : (
            <span aria-current="step">{name}</span>
          )}
        </span>
      ))}
      {/* Button symbols (spec 2026-11-19-button-symbols): preview one state's content. */}
      {isButton && (
        <span className={styles.states} role="group" aria-label="Button state" data-testid="button-state-strip">
          {STATES.map(({ state, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={previewState === state}
              data-testid={`button-preview-${state ?? 'all'}`}
              className={previewState === state ? styles.active : undefined}
              onClick={() => setPreviewState(state)}
            >
              {label}
            </button>
          ))}
        </span>
      )}
    </nav>
  );
}
