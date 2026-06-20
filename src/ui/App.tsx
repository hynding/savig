import { useEffect } from 'react';
import './theme/tokens.css';
import './theme/global.css';
import styles from './App.module.css';

export function App() {
  useEffect(() => {
    if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = 'dark';
    }
  }, []);

  return (
    <div className={styles.app}>
      <section className={styles.toolbar} aria-label="Toolbar" />
      <section className={styles.assets} aria-label="Assets" />
      <section className={styles.stage} aria-label="Stage" />
      <section className={styles.inspector} aria-label="Inspector" />
      <section className={styles.timeline} aria-label="Timeline" />
    </div>
  );
}
