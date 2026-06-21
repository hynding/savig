# Keyframe Easing-Editing UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit the `easing` (and rotation `rotationMode`) of any selected scalar or shape keyframe via an Inspector "Keyframe" section with preset buttons and a draggable cubic-bezier curve.

**Architecture:** Pure UI. A new `EasingEditor` component plots the real `applyEasing` output and writes `EasingName` or `CubicBezierEasing`. Two new store actions route the edit to the active selection (scalar `tracks[property]` vs `shapeTrack`). No engine, data-model, persistence, or migration change — `applyEasing`/`interpolate`/`samplePath` already consume `easing`, and it already serializes.

**Tech Stack:** React 18 + TS (strict) · Zustand · Vitest + React Testing Library · Playwright · CSS Modules.

## Global Constraints

- Engine layer stays pure (no React/DOM); this feature touches **no** engine file.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Each user gesture is **one undo step** (commit-on-gesture, as existing actions do).
- Keyframe time matching uses tolerance `1e-6` (the existing `KF_EPS` in `Inspector.tsx:7`).
- `cubicBezier` x-params (`p1`, `p3`) clamp to `[0,1]`; y-params (`p2`, `p4`) clamp to `[-0.5, 1.5]`.
- Engine exports are available from the barrel `../../../engine` (`applyEasing`, `Easing`, `EasingName`, `CubicBezierEasing`, `RotationMode`).
- Strict TS: no `any`; type all props and store-action signatures.

---

### Task 1: `EasingEditor` component

**Files:**
- Create: `src/ui/components/EasingEditor/EasingEditor.tsx`
- Create: `src/ui/components/EasingEditor/EasingEditor.module.css`
- Test: `src/ui/components/EasingEditor/EasingEditor.test.tsx`

**Interfaces:**
- Consumes: `applyEasing`, `Easing`, `EasingName`, `CubicBezierEasing` from `../../../engine`.
- Produces:
  - `EasingEditor({ value: Easing; onChange: (next: Easing) => void; inert?: boolean }): JSX.Element`
  - `curveSamples(value: Easing, n?: number): Array<{ t: number; y: number }>` (exported, pure)

- [ ] **Step 1: Write the failing test**

```tsx
// src/ui/components/EasingEditor/EasingEditor.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EasingEditor, curveSamples } from './EasingEditor';
import type { CubicBezierEasing } from '../../../engine';

describe('curveSamples', () => {
  it('plots the real applyEasing output (linear vs easeIn differ at t=0.5)', () => {
    const lin = curveSamples('linear', 4).find((p) => p.t === 0.5)!;
    const easeIn = curveSamples('easeIn', 4).find((p) => p.t === 0.5)!;
    expect(lin.y).toBeCloseTo(0.5, 5);
    expect(easeIn.y).toBeCloseTo(0.25, 5); // t*t at 0.5
  });
});

describe('EasingEditor', () => {
  it('marks the preset matching value as pressed and has no handles for a named easing', () => {
    render(<EasingEditor value="easeOut" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'easeOut' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('clicking a named preset calls onChange with that name', async () => {
    const onChange = vi.fn();
    render(<EasingEditor value="linear" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'easeIn' }));
    expect(onChange).toHaveBeenCalledWith('easeIn');
  });

  it('clicking custom seeds a cubicBezier and reveals two handles', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<EasingEditor value="linear" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'custom' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cubicBezier' }),
    );
    rerender(
      <EasingEditor
        value={{ type: 'cubicBezier', p1: 0.42, p2: 0, p3: 0.58, p4: 1 }}
        onChange={onChange}
      />,
    );
    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });

  it('dragging control point 1 calls onChange with clamped params', () => {
    const onChange = vi.fn();
    const value: CubicBezierEasing = { type: 'cubicBezier', p1: 0.42, p2: 0, p3: 0.58, p4: 1 };
    const { container } = render(<EasingEditor value={value} onChange={onChange} />);
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 120, height: 180, right: 120, bottom: 180, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    const handle = screen.getByRole('slider', { name: 'ease control point 1' });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    // clientX=60 -> x=0.5 ; clientY=30 (PAD) -> y=1.0
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 60, clientY: 30 });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cubicBezier', p1: 0.5, p2: 1, p3: 0.58, p4: 1 }),
    );
  });

  it('arrow keys nudge a focused handle', () => {
    const onChange = vi.fn();
    const value: CubicBezierEasing = { type: 'cubicBezier', p1: 0.4, p2: 0, p3: 0.58, p4: 1 };
    render(<EasingEditor value={value} onChange={onChange} />);
    const handle = screen.getByRole('slider', { name: 'ease control point 1' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ p1: expect.closeTo(0.42, 5) }));
  });

  it('shows the inert hint when inert', () => {
    render(<EasingEditor value="linear" onChange={() => {}} inert />);
    expect(screen.getByText(/segment into the next keyframe/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/EasingEditor/EasingEditor.test.tsx`
Expected: FAIL — cannot resolve `./EasingEditor`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/ui/components/EasingEditor/EasingEditor.tsx
import { useRef } from 'react';
import { applyEasing } from '../../../engine';
import type { Easing, EasingName, CubicBezierEasing } from '../../../engine';
import styles from './EasingEditor.module.css';

const W = 120;
const H = 120;
const PAD = 30;
const PRESETS: EasingName[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
const DEFAULT_CUSTOM: CubicBezierEasing = { type: 'cubicBezier', p1: 0.42, p2: 0, p3: 0.58, p4: 1 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const clampX = (n: number) => clamp(n, 0, 1);
const clampY = (n: number) => clamp(n, -0.5, 1.5);

const toSx = (t: number) => t * W;
const toSy = (y: number) => PAD + (1 - y) * H;

export function curveSamples(value: Easing, n = 24): Array<{ t: number; y: number }> {
  const out: Array<{ t: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ t, y: applyEasing(value, t) });
  }
  return out;
}

function curvePoints(value: Easing): string {
  return curveSamples(value)
    .map(({ t, y }) => `${toSx(t)},${toSy(y)}`)
    .join(' ');
}

function Handle({
  label,
  x,
  y,
  onMove,
  onNudge,
}: {
  label: string;
  x: number;
  y: number;
  onMove: (clientX: number, clientY: number) => void;
  onNudge: (dx: number, dy: number) => void;
}) {
  return (
    <circle
      className={styles.handle}
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(x * 100)}
      tabIndex={0}
      cx={toSx(x)}
      cy={toSy(y)}
      r={6}
      onPointerDown={(e) => (e.target as Element).setPointerCapture?.(e.pointerId)}
      onPointerMove={(e) => {
        if (e.buttons) onMove(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'ArrowLeft') { onNudge(-step, 0); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { onNudge(step, 0); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { onNudge(0, step); e.preventDefault(); }
        else if (e.key === 'ArrowDown') { onNudge(0, -step); e.preventDefault(); }
      }}
    />
  );
}

export function EasingEditor({
  value,
  onChange,
  inert,
}: {
  value: Easing;
  onChange: (next: Easing) => void;
  inert?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const custom = typeof value !== 'string';
  const bezier = custom ? value : null;

  const fromClient = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: clampX((clientX - rect.left) / W),
      y: clampY(1 - (clientY - rect.top - PAD) / H),
    };
  };

  const setP1 = (x: number, y: number) =>
    onChange({ type: 'cubicBezier', p1: clampX(x), p2: clampY(y), p3: bezier!.p3, p4: bezier!.p4 });
  const setP2 = (x: number, y: number) =>
    onChange({ type: 'cubicBezier', p1: bezier!.p1, p2: bezier!.p2, p3: clampX(x), p4: clampY(y) });

  return (
    <div className={styles.editor}>
      <div className={styles.presets}>
        {PRESETS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={value === name}
            className={value === name ? styles.active : ''}
            onClick={() => onChange(name)}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          className={custom ? styles.active : ''}
          onClick={() => {
            if (!custom) onChange(DEFAULT_CUSTOM);
          }}
        >
          custom
        </button>
      </div>

      <svg ref={svgRef} className={styles.canvas} width={W} height={H + 2 * PAD} role="img" aria-label="easing curve">
        <polyline className={styles.guide} points={`${toSx(0)},${toSy(0)} ${toSx(1)},${toSy(1)}`} fill="none" />
        <polyline className={styles.curve} points={curvePoints(value)} fill="none" />
        {bezier && (
          <>
            <Handle
              label="ease control point 1"
              x={bezier.p1}
              y={bezier.p2}
              onMove={(cx, cy) => { const p = fromClient(cx, cy); setP1(p.x, p.y); }}
              onNudge={(dx, dy) => setP1(bezier.p1 + dx, bezier.p2 + dy)}
            />
            <Handle
              label="ease control point 2"
              x={bezier.p3}
              y={bezier.p4}
              onMove={(cx, cy) => { const p = fromClient(cx, cy); setP2(p.x, p.y); }}
              onNudge={(dx, dy) => setP2(bezier.p3 + dx, bezier.p4 + dy)}
            />
          </>
        )}
      </svg>

      <div className={styles.readback} data-testid="easing-readback">
        {custom
          ? `cubic-bezier(${round2(bezier!.p1)}, ${round2(bezier!.p2)}, ${round2(bezier!.p3)}, ${round2(bezier!.p4)})`
          : value}
      </div>
      {inert && <div className={styles.hint}>easing applies to the segment into the next keyframe</div>}
    </div>
  );
}
```

```css
/* src/ui/components/EasingEditor/EasingEditor.module.css */
.editor { display: flex; flex-direction: column; gap: 6px; }
.presets { display: flex; flex-wrap: wrap; gap: 4px; }
.presets button { font-size: 11px; padding: 2px 6px; cursor: pointer; }
.presets .active { outline: 2px solid var(--accent, #4a90d9); }
.canvas { background: var(--surface-2, #1b1b1b); border-radius: 4px; touch-action: none; }
.guide { stroke: var(--border, #444); stroke-dasharray: 3 3; stroke-width: 1; }
.curve { stroke: var(--accent, #4a90d9); stroke-width: 2; }
.handle { fill: var(--accent, #4a90d9); stroke: #fff; stroke-width: 1; cursor: grab; }
.readback { font-family: monospace; font-size: 11px; color: var(--text-muted, #aaa); }
.hint { font-size: 11px; color: var(--text-muted, #aaa); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/EasingEditor/EasingEditor.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/EasingEditor/
git commit -m "feat(easing-ui): EasingEditor widget — presets + draggable bezier curve"
```

---

### Task 2: Store actions + keyframe-select also selects object

**Files:**
- Modify: `src/ui/store/store.ts` (add to `EditorState` interface near line 105–106; add actions near `removeSelectedKeyframe` at `store.ts:401`; edit `selectKeyframe` at `store.ts:398` and `selectShapeKeyframe` at `store.ts:318`)
- Test: `src/ui/store/store.test.ts` (append cases)

**Interfaces:**
- Consumes: `replaceObject` (`store.ts:145`), `Easing`, `RotationMode` from `../../engine`.
- Produces:
  - `setSelectedKeyframeEasing(easing: Easing): void`
  - `setSelectedKeyframeRotationMode(mode: RotationMode): void`
  - `selectKeyframe` / `selectShapeKeyframe` now also set `selectedObjectId` to `ref.objectId` (unchanged when `ref` is `null`).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/ui/store/store.test.ts
describe('keyframe easing editing', () => {
  beforeEach(() => {
    useEditor.getState().newProject();
    useEditor.getState().addAsset(svgAsset);
    useEditor.getState().addObject('asset-a');
  });

  it('setSelectedKeyframeEasing edits the selected scalar keyframe (one undo step)', () => {
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 10);
    const id = selectSelectedObject(useEditor.getState())!.id;
    const t = selectSelectedObject(useEditor.getState())!.tracks.x![0].time;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: t });
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(selectSelectedObject(useEditor.getState())!.tracks.x![0].easing).toBe('easeIn');
    expect(useEditor.getState().history.past.length).toBe(before + 1);
    useEditor.getState().undo();
    expect(selectSelectedObject(useEditor.getState())!.tracks.x![0].easing).not.toBe('easeIn');
  });

  it('setSelectedKeyframeEasing edits the selected shape keyframe', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    useEditor.getState().addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    const t = selectSelectedObject(useEditor.getState())!.shapeTrack![0].time;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: t });
    useEditor.getState().setSelectedKeyframeEasing({ type: 'cubicBezier', p1: 0.4, p2: 0, p3: 0.6, p4: 1 });
    expect(selectSelectedObject(useEditor.getState())!.shapeTrack![0].easing).toEqual(
      { type: 'cubicBezier', p1: 0.4, p2: 0, p3: 0.6, p4: 1 },
    );
  });

  it('setSelectedKeyframeRotationMode writes only on a rotation keyframe', () => {
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 90);
    const id = selectSelectedObject(useEditor.getState())!.id;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().setSelectedKeyframeRotationMode('raw');
    expect(selectSelectedObject(useEditor.getState())!.tracks.rotation![0].rotationMode).toBe('raw');
  });

  it('selectKeyframe / selectShapeKeyframe also select the object', () => {
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 5);
    const id = selectSelectedObject(useEditor.getState())!.id;
    useEditor.getState().selectObject(null);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    expect(useEditor.getState().selectedObjectId).toBe(id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "keyframe easing editing"`
Expected: FAIL — `setSelectedKeyframeEasing is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/ui/store/store.ts`, add `Easing` and `RotationMode` to the `from '../../engine'` import block (lines 2–22 region, where other engine types are imported).

Add to the `EditorState` interface (after `removeSelectedKeyframe(): void;` near `store.ts:106`):

```ts
  setSelectedKeyframeEasing(easing: Easing): void;
  setSelectedKeyframeRotationMode(mode: RotationMode): void;
```

Replace `selectKeyframe` (`store.ts:398`) and `selectShapeKeyframe` (`store.ts:318`) bodies:

```ts
  selectShapeKeyframe(ref) {
    set({
      selectedShapeKeyframe: ref,
      selectedKeyframe: null,
      ...(ref ? { selectedObjectId: ref.objectId } : {}),
    });
  },
```

```ts
  selectKeyframe(ref) {
    set({
      selectedKeyframe: ref,
      selectedShapeKeyframe: null,
      ...(ref ? { selectedObjectId: ref.objectId } : {}),
    });
  },
```

Add the two actions immediately after `removeSelectedKeyframe` (after `store.ts:412`):

```ts
  setSelectedKeyframeEasing(easing) {
    const s = get();
    const project = s.history.present;
    const EPS = 1e-6;
    if (s.selectedShapeKeyframe) {
      const ref = s.selectedShapeKeyframe;
      const obj = project.objects.find((o) => o.id === ref.objectId);
      if (!obj?.shapeTrack) return;
      const shapeTrack = obj.shapeTrack.map((k) =>
        Math.abs(k.time - ref.time) < EPS ? { ...k, easing } : k,
      );
      get().commit(replaceObject(project, { ...obj, shapeTrack }));
      return;
    }
    const ref = s.selectedKeyframe;
    if (!ref) return;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    const track = obj?.tracks[ref.property];
    if (!obj || !track) return;
    const next = track.map((k) => (Math.abs(k.time - ref.time) < EPS ? { ...k, easing } : k));
    get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [ref.property]: next } }));
  },
  setSelectedKeyframeRotationMode(mode) {
    const s = get();
    const ref = s.selectedKeyframe;
    if (!ref || ref.property !== 'rotation') return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    const track = obj?.tracks.rotation;
    if (!obj || !track) return;
    const next = track.map((k) => (Math.abs(k.time - ref.time) < 1e-6 ? { ...k, rotationMode: mode } : k));
    get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, rotation: next } }));
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "keyframe easing editing"`
Expected: PASS.

- [ ] **Step 5: Update the existing Timeline selection tests for the new behavior**

`selectKeyframe`/`selectShapeKeyframe` now also set `selectedObjectId`. Run the Timeline + store suites to surface any assertion that expected `selectedObjectId` to stay unchanged:

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx src/ui/store/store.test.ts`
Expected: PASS. If a pre-existing test asserted `selectedObjectId` was `null`/unchanged after selecting a keyframe, update it to expect the keyframe's `objectId` (this is the intended new behavior, per the spec §5). Do not weaken any other assertion.

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts src/ui/components/Timeline/Timeline.test.tsx
git commit -m "feat(store): setSelectedKeyframeEasing/RotationMode; keyframe-select selects object"
```

---

### Task 3: Inspector "Keyframe" section

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx` (append cases)

**Interfaces:**
- Consumes: `EasingEditor` (Task 1); `setSelectedKeyframeEasing`, `setSelectedKeyframeRotationMode`, and the now-object-selecting `selectKeyframe`/`selectShapeKeyframe` (Task 2); `Easing`, `RotationMode` from `../../../engine`.
- Produces: a "Keyframe" group in the Inspector, shown when a scalar or shape keyframe on the selected object resolves.

- [ ] **Step 1: Write the failing test**

```tsx
// append to src/ui/components/Inspector/Inspector.test.tsx
describe('keyframe easing section', () => {
  it('shows the Keyframe section with the scalar header and edits easing', async () => {
    useEditor.getState().newProject();
    useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('a');
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 10);
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    render(<Inspector />);
    expect(screen.getByText(/^x @ 0s$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'easeIn' }));
    expect(useEditor.getState().history.present.objects[0].tracks.x![0].easing).toBe('easeIn');
  });

  it('shows a rotationMode toggle only for a rotation keyframe', () => {
    useEditor.getState().newProject();
    useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('a');
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 90);
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    render(<Inspector />);
    expect(screen.getByLabelText('rotationMode')).toBeInTheDocument();
  });

  it('does not show the Keyframe section when no keyframe is selected', () => {
    useEditor.getState().newProject();
    useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('a');
    render(<Inspector />);
    expect(screen.queryByText(/Keyframe/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx -t "keyframe easing section"`
Expected: FAIL — header text / rotationMode control not found.

- [ ] **Step 3: Write minimal implementation**

In `Inspector.tsx`:

Add imports:
```tsx
import type { Easing, RotationMode } from '../../../engine';
import { EasingEditor } from '../EasingEditor/EasingEditor';
```

Add subscriptions near the other `useEditor` selectors (around `Inspector.tsx:79`):
```tsx
  const selectedKeyframe = useEditor((s) => s.selectedKeyframe);
```

Add to the destructured actions (around `Inspector.tsx:80`):
```tsx
    setSelectedKeyframeEasing,
    setSelectedKeyframeRotationMode,
```

After `const asset = ...; const vector = ...;` (around `Inspector.tsx:96`), resolve the selected keyframe:
```tsx
  // Resolve the selected keyframe (scalar or shape) on THIS object for the easing editor.
  let kfEasing: Easing | null = null;
  let kfHeader = '';
  let kfIsRotation = false;
  let kfRotationMode: RotationMode = 'shortest';
  let kfInert = false;
  if (selectedShapeKeyframe && selectedShapeKeyframe.objectId === obj.id && obj.shapeTrack) {
    const track = obj.shapeTrack;
    const idx = track.findIndex((k) => Math.abs(k.time - selectedShapeKeyframe.time) < KF_EPS);
    if (idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `shape @ ${round(track[idx].time)}s`;
      kfInert = idx === track.length - 1;
    }
  } else if (selectedKeyframe && selectedKeyframe.objectId === obj.id) {
    const track = obj.tracks[selectedKeyframe.property];
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0) {
      kfEasing = track[idx].easing;
      kfHeader = `${selectedKeyframe.property} @ ${round(track[idx].time)}s`;
      kfIsRotation = selectedKeyframe.property === 'rotation';
      kfRotationMode = track[idx].rotationMode ?? 'shortest';
      kfInert = idx === track.length - 1;
    }
  }
```

Render the section just before the final `</div>` that closes `styles.panel` (after the Style block, around `Inspector.tsx:240`):
```tsx
      {kfEasing !== null && (
        <>
          <div className={styles.group}>Keyframe</div>
          <div className={styles.row}>{kfHeader}</div>
          <EasingEditor value={kfEasing} onChange={(e) => setSelectedKeyframeEasing(e)} inert={kfInert} />
          {kfIsRotation && (
            <div className={styles.row}>
              <label htmlFor="insp-rotmode">rotationMode</label>
              <select
                id="insp-rotmode"
                aria-label="rotationMode"
                value={kfRotationMode}
                onChange={(e) => setSelectedKeyframeRotationMode(e.target.value as RotationMode)}
              >
                <option value="shortest">shortest</option>
                <option value="raw">raw</option>
              </select>
            </div>
          )}
        </>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS (new + existing cases).

- [ ] **Step 5: Run the full unit suite + typecheck**

Run: `pnpm vitest run && pnpm tsc -p tsconfig.json --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(inspector): Keyframe section — easing editor + rotationMode toggle"
```

---

### Task 4: E2E — author keyframes, edit easing, verify persistence

**Files:**
- Create: `e2e/keyframe-easing.spec.ts`

**Interfaces:**
- Consumes: the running app at `/`; the `easing-readback` testid (Task 1); the Inspector Keyframe section (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// e2e/keyframe-easing.spec.ts
import { test, expect } from '@playwright/test';

test('select a keyframe -> set easeIn -> readback reflects it and survives reload', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Author a path with the pen, then key x at two times so there is a keyframe.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.mouse.click(box.x + 180, box.y + 120);
  await page.mouse.dblclick(box.x + 240, box.y + 80);

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const xField = page.getByLabel('x', { exact: true });
  await expect(xField).toBeEnabled();
  await xField.fill('100');
  await xField.blur();
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await xField.fill('400');
  await xField.blur();

  // Select the first x keyframe diamond in the timeline (testid: keyframe-{id}-x-{time}).
  const firstDiamond = page.locator('[data-testid^="keyframe-"][data-testid*="-x-"]').first();
  await firstDiamond.click();

  // The Inspector Keyframe section appears; set easeIn and check the read-back.
  await page.getByRole('button', { name: 'easeIn' }).click();
  await expect(page.getByTestId('easing-readback')).toHaveText('easeIn');

  // Reload: IndexedDB autosave should restore the project; the easing persists.
  await page.reload();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('[data-testid^="keyframe-"][data-testid*="-x-"]').first().click();
  await expect(page.getByTestId('easing-readback')).toHaveText('easeIn');
});
```

- [ ] **Step 2: Run test to verify it fails (then passes)**

Run: `pnpm playwright test e2e/keyframe-easing.spec.ts`
Expected: With Tasks 1–3 merged, this PASSES. If selecting the keyframe diamond does not reveal the read-back, confirm the diamond testid pattern via `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx` (the format is `keyframe-{objectId}-{property}-{time}`) and adjust the locator. If reload does not restore selection, the autosave restore is asynchronous — add `await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1)` before re-selecting.

- [ ] **Step 3: Commit**

```bash
git add e2e/keyframe-easing.spec.ts
git commit -m "test(e2e): edit keyframe easing via inspector; persists across reload"
```

---

## Self-Review

**Spec coverage:**
- Spec §3 EasingEditor (presets, curve from real `applyEasing`, custom handles, x-clamp/y-overshoot, a11y, read-back) → Task 1. ✓
- Spec §4 Inspector Keyframe section (resolution, header, embed, rotationMode, inert hint) → Task 3. ✓
- Spec §5 store actions + select-selects-object → Task 2. ✓
- Spec §7 test strategy (EasingEditor RTL, store unit, Inspector RTL, light e2e) → Tasks 1–4. ✓
- Spec §2 "no data/migration change" → no engine/persistence file touched. ✓
- Spec §6 edge cases: last-keyframe inert (Task 3 `kfInert`), x-clamp/y-overshoot (Task 1 `clampX`/`clampY`), no-selection hidden section (Task 3 test). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `setSelectedKeyframeEasing(easing: Easing)` and `setSelectedKeyframeRotationMode(mode: RotationMode)` are declared in the Task 2 interface block and consumed with the same names/types in Task 3. `curveSamples`/`EasingEditor` signatures match between Task 1's Produces block, its implementation, and Task 3's import. The `easing-readback` testid is produced in Task 1 and consumed in Task 4. ✓

**Note on inert easing semantics:** the inert hint is informational only; the last keyframe's `easing` remains editable and stored (consistent with `interpolate`/`samplePath` using the *from* keyframe's easing), matching spec §4/§6.
