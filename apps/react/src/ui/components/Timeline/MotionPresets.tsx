// Motion presets (spec 2026-11-15-motion-presets): a Timeline header button opening a panel of
// one-click animations. Clicking a preset animates every selected object from the playhead.
import { useEffect, useRef, useState } from 'react';
import { BUILTIN_MOTION_PRESETS, type MotionPresetCategory } from '@savig/engine';
import type { timelineIntents } from '@savig/ui-core';
import styles from './Timeline.module.css';

type Intents = ReturnType<typeof timelineIntents>;

const GROUPS: { category: MotionPresetCategory; label: string }[] = [
  { category: 'entrance', label: 'Entrance' },
  { category: 'emphasis', label: 'Emphasis' },
  { category: 'exit', label: 'Exit' },
];

export function MotionPresets({ intents, hasSelection }: { intents: Intents; hasSelection: boolean }) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState('');
  // The Timeline panel scrolls (overflow clips), so the popover is fixed-positioned above the button.
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const apply = (id: string, name: string) => {
    const d = Number(duration);
    const n = intents.applyMotionPreset(id, duration.trim() !== '' && d > 0 ? { duration: d } : undefined);
    if (n === 0) intents.pushToast('info', 'Select an unlocked object to apply a motion preset.');
    else intents.pushToast('info', `${name} applied to ${n === 1 ? 'the selected object' : `${n} objects`} from the playhead.`);
  };

  return (
    <div className={styles.presetsRoot} ref={rootRef}>
      <button
        className={`${styles.toggle} ${open ? styles.on : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        title="One-click animations for the selected object, starting at the playhead"
        data-testid="presets-toggle"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ left: r.left, bottom: window.innerHeight - r.top + 4 });
          setOpen((v) => !v);
        }}
      >
        Presets
      </button>
      {open && (
        <div
          className={styles.presetsPanel}
          role="dialog"
          aria-label="Motion presets"
          data-testid="presets-panel"
          style={anchor ? { left: Math.max(8, Math.min(anchor.left, window.innerWidth - 336)), bottom: anchor.bottom } : undefined}
        >
          {!hasSelection && <p className={styles.presetsHint}>Select an object, then pick a preset.</p>}
          <label className={styles.presetsDuration}>
            Duration (s)
            <input
              type="number"
              min={0.05}
              step={0.1}
              placeholder="preset"
              aria-label="Preset duration in seconds"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          {GROUPS.map((g) => (
            <div key={g.category} className={styles.presetsGroup} role="group" aria-label={g.label}>
              <span className={styles.presetsGroupLabel}>{g.label}</span>
              <div className={styles.presetsButtons}>
                {BUILTIN_MOTION_PRESETS.filter((p) => p.category === g.category).map((p) => (
                  <button
                    key={p.id}
                    className={styles.graphChip}
                    data-testid={`preset-${p.id}`}
                    title={`${p.name} (${p.duration}s)`}
                    disabled={!hasSelection}
                    onClick={() => apply(p.id, p.name)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
