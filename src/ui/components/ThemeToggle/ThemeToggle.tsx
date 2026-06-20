import { useEditor } from '../../store/store';
import styles from './ThemeToggle.module.css';

export function ThemeToggle() {
  const theme = useEditor((s) => s.theme);
  const { setTheme } = useEditor.getState();
  return (
    <button
      className={styles.btn}
      aria-label="Toggle theme"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? '☾ Theme' : '☀ Theme'}
    </button>
  );
}
