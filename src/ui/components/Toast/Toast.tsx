import { useEditor } from '../../store/store';
import styles from './Toast.module.css';

export function ToastHost() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  return (
    <div className={styles.host} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${t.kind === 'error' ? styles.error : ''}`}>
          <span>{t.message}</span>
          <button className={styles.dismiss} aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
