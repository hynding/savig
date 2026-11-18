import { useEditor } from '../../store/store';
import styles from './ThemeToggle.module.css';

export function ThemeToggle() {
  const theme = useEditor((s) => s.theme);
  const { setTheme } = useEditor.getState();
  return (
    <button
      className={styles.btn}
      aria-label="Toggle theme"
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {/* Icon only: the toolbar is full (the Camera tool took the last free slot). */}
      {theme === 'dark' ? '☾' : '☀'}
    </button>
  );
}
