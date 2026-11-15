// Motion presets (spec 2026-11-15-motion-presets): a Timeline header button opening a panel of
// one-click animations. Clicking a preset animates every selected object from the playhead.
import { useEffect, useRef, useState } from 'react';
import { BUILTIN_MOTION_PRESETS, type MotionPresetCategory } from '@savig/engine';
import type { timelineIntents } from '@savig/ui-core';
import { useEditor } from '../../store/store';
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
  const mine = useEditor((s) => s.history.present.motionPresets) ?? [];
  const [saveName, setSaveName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const save = () => {
    const id = intents.saveMotionPreset(saveName);
    if (!id) {
      intents.pushToast('info', 'To save a preset, select an object that has transform keyframes (position, scale, rotation or opacity) at two or more times.');
      return;
    }
    setSaveName('');
    intents.pushToast('info', 'Saved to My presets. It is stored with this project.');
  };
  const commitRename = () => {
    if (renaming) intents.renameMotionPreset(renaming.id, renaming.name);
    setRenaming(null);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape inside the rename field only cancels the rename (handled there).
      if (e.key === 'Escape' && !(e.target as HTMLElement | null)?.closest?.('[data-rename]')) setOpen(false);
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
          <div className={styles.presetsGroup} role="group" aria-label="My presets">
            <span className={styles.presetsGroupLabel}>My presets</span>
            {mine.length === 0 && <p className={styles.presetsHint}>Animate an object, then save its motion here to reuse it.</p>}
            <div className={styles.presetsButtons}>
              {mine.map((p) =>
                renaming?.id === p.id ? (
                  <input
                    key={p.id}
                    data-rename=""
                    className={styles.presetsName}
                    aria-label={`Rename ${p.name}`}
                    autoFocus
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span key={p.id} className={styles.presetsMine}>
                    <button
                      className={styles.graphChip}
                      data-testid={`preset-${p.id}`}
                      title={`${p.name} (${Number(p.duration.toFixed(2))}s)`}
                      disabled={!hasSelection}
                      onClick={() => apply(p.id, p.name)}
                      onDoubleClick={() => setRenaming({ id: p.id, name: p.name })}
                    >
                      {p.name}
                    </button>
                    <button className={styles.presetsIcon} aria-label={`Rename ${p.name}`} title="Rename" onClick={() => setRenaming({ id: p.id, name: p.name })}>
                      ✎
                    </button>
                    <button className={styles.presetsIcon} aria-label={`Delete ${p.name}`} title="Delete" onClick={() => intents.deleteMotionPreset(p.id)}>
                      ×
                    </button>
                  </span>
                ),
              )}
            </div>
            <div className={styles.presetsSave}>
              <input
                className={styles.presetsName}
                placeholder="Preset name"
                aria-label="New preset name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hasSelection) save();
                }}
              />
              <button className={styles.graphChip} disabled={!hasSelection} data-testid="preset-save" onClick={save}>
                Save selection's motion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
