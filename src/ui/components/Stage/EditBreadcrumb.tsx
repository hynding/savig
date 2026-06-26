import { useEditor } from '../../store/store';
import styles from './EditBreadcrumb.module.css';

// The "you are inside a symbol" path: Root › SymA › SymB. Each prior segment exits to that depth;
// the last segment is the current scene. Renders nothing at the root (slice 47 edit-mode).
export function EditBreadcrumb() {
  const editPath = useEditor((s) => s.editPath);
  const assets = useEditor((s) => s.history.present.assets);
  const exitToDepth = useEditor((s) => s.exitToDepth);
  if (editPath.length === 0) return null;
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
    </nav>
  );
}
