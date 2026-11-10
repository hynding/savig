// Frame-by-frame layer strip (spec 2026-11-07 §Timeline, slice 3). Replaces a frame layer's
// property lanes with: a held-span bar per key, a filled (drawing) or hollow (blank) dot at each
// key's start, label flags, and an end marker. Click a cell → seek + target the layer; drag a key
// dot → moveFrameKeyTo; right-click → the F5/F6/F7 verbs plus a label field. Pixel mapping stays
// here (scale.ts), the data comes from the pure TimelineFrameLayerVM.
import { useEffect, useRef, useState } from 'react';
import { snapToFrame } from '@savig/engine';
import type { TimelineFrameLayerVM, timelineIntents } from '@savig/ui-core';
import { timeToX, xToTime, frameTickBackground } from './scale';
import styles from './Timeline.module.css';

type Intents = ReturnType<typeof timelineIntents>;

interface Props {
  layerId: string;
  strip: TimelineFrameLayerVM;
  fps: number;
  locked: boolean;
  intents: Intents;
}

interface Menu {
  x: number;
  y: number;
  time: number;
  /** The key starting exactly at `time` (labelable / clearable), if any. */
  keyId: string | null;
  label: string;
}

const EPS = 1e-6;

export function FrameStrip({ layerId, strip, fps, locked, intents }: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const cellTime = (clientX: number) => {
    const left = laneRef.current?.getBoundingClientRect().left ?? 0;
    // Floor to the cell under the pointer (a cell spans [t, t + 1/fps)).
    return Math.max(0, snapToFrame(Math.floor(xToTime(clientX - left) * fps + EPS) / fps, fps));
  };

  // Drag a key dot: imperative frame-snapped preview, commit on release (a pure click seeks).
  const drag = useRef<{ keyId: string; startTime: number; startX: number; el: HTMLElement; moved: boolean } | null>(null);
  useEffect(() => {
    const timeFor = (clientX: number, d: { startTime: number; startX: number }) =>
      Math.max(0, snapToFrame(d.startTime + xToTime(clientX - d.startX), fps));
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const t = timeFor(e.clientX, d);
      if (Math.abs(t - d.startTime) > EPS) d.moved = true;
      d.el.style.left = `${timeToX(t)}px`;
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      const t = timeFor(e.clientX, d);
      if (d.moved && Math.abs(t - d.startTime) > EPS) intents.moveFrameKeyTo(d.keyId, t);
      else d.el.style.left = `${timeToX(d.startTime)}px`;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [fps, intents]);

  // Close the menu on any outside pointer-down or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && (e.target as HTMLElement | null)?.closest?.('[data-frame-menu]')) return;
      setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const run = (fn: () => void) => () => {
    fn();
    setMenu(null);
  };

  return (
    <div
      ref={laneRef}
      className={`${styles.lane} ${styles.frameLane} ${strip.targeted ? styles.frameLaneTargeted : ''}`}
      data-testid={`frame-strip-${layerId}`}
      style={{ backgroundImage: frameTickBackground(fps), minWidth: timeToX(strip.end), ['--half-cell' as string]: `${timeToX(0.5 / fps)}px` }}
      onPointerDown={(e) => {
        if (locked || e.button !== 0) return;
        intents.targetFrameCell(layerId, cellTime(e.clientX));
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (locked) return;
        const time = cellTime(e.clientX);
        intents.targetFrameCell(layerId, time);
        const key = strip.keys.find((k) => Math.abs(k.time - time) <= EPS) ?? null;
        const box = laneRef.current?.getBoundingClientRect();
        setMenu({ x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0), time, keyId: key?.id ?? null, label: key?.label ?? '' });
      }}
    >
      {strip.keys.map((k) => (
        <div
          key={`span-${k.id}`}
          className={`${styles.frameSpan} ${k.blank ? styles.frameSpanBlank : ''} ${k.current ? styles.frameSpanCurrent : ''}`}
          data-testid={`frame-span-${k.id}`}
          style={{ left: `${timeToX(k.time)}px`, width: `${Math.max(0, timeToX(k.end - k.time))}px` }}
        />
      ))}
      <div className={styles.frameEnd} data-testid={`frame-end-${layerId}`} style={{ left: `${timeToX(strip.end)}px` }} />
      {strip.keys.map((k) => (
        <div
          key={`key-${k.id}`}
          className={`${styles.frameKey} ${k.blank ? styles.frameKeyBlank : ''}`}
          data-testid={`frame-key-${k.id}`}
          data-blank={k.blank ? 'true' : 'false'}
          data-time={k.time}
          title={k.label ? `${k.label} (frame ${Math.round(k.time * fps) + 1})` : `Frame ${Math.round(k.time * fps) + 1}`}
          style={{ left: `${timeToX(k.time)}px` }}
          onPointerDown={(e) => {
            if (locked || e.button !== 0) return;
            e.stopPropagation();
            intents.targetFrameCell(layerId, k.time);
            drag.current = { keyId: k.id, startTime: k.time, startX: e.clientX, el: e.currentTarget as HTMLElement, moved: false };
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
        >
          {k.label && <span className={styles.frameLabel}>{k.label}</span>}
        </div>
      ))}
      {menu && (
        <div
          className={styles.frameMenu}
          data-frame-menu
          data-testid="frame-menu"
          role="menu"
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button role="menuitem" onClick={run(intents.insertFrames)}>Insert Frame <kbd>F5</kbd></button>
          <button role="menuitem" onClick={run(intents.removeFrames)}>Remove Frame <kbd>Shift+F5</kbd></button>
          <button role="menuitem" onClick={run(intents.insertFrameKeyframe)}>Insert Keyframe <kbd>F6</kbd></button>
          <button role="menuitem" onClick={run(intents.insertBlankFrameKeyframe)}>Insert Blank Keyframe <kbd>F7</kbd></button>
          <button role="menuitem" disabled={!menu.keyId} onClick={run(intents.clearFrameKeyframe)}>Clear Keyframe <kbd>Shift+F6</kbd></button>
          {menu.keyId && (
            <form
              className={styles.frameMenuLabel}
              onSubmit={(e) => {
                e.preventDefault();
                intents.setFrameKeyLabel(menu.keyId!, menu.label);
                setMenu(null);
              }}
            >
              <input
                aria-label="Frame label"
                placeholder="Frame label"
                value={menu.label}
                onChange={(e) => setMenu({ ...menu, label: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button type="submit">Set</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
