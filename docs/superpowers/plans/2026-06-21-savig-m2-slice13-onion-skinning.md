# Slice 13 Onion Skinning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show translucent ghost copies of the selected object at its neighboring keyframe times (toggleable), so the user can see the motion arc while editing one frame.

**Architecture:** Pure helpers (`objectKeyframeTimes`, `onionSkinTimes`) compute which times to ghost. A transient store flag `onionSkin` toggles the feature. A Stage overlay renders, per onion time, the object's shape sampled at that time (reusing `sampleObject`/`geometryToSvgAttrs`/`pathToD`/`buildTransform`/`resolveAnchor`) as a faded tint silhouette under the live objects. Editor-only chrome — NO engine/runtime/export/persistence change.

**Tech Stack:** TypeScript (strict), Vitest + RTL, Playwright; the existing `src/engine` pure core + `src/ui` Stage/Timeline/store.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Onion skinning is EDITOR-only chrome — never exported, never in the playback `nodes` map, NOT part of computeFrame/runtime. NO engine render/runtime/export/persistence change, NO migration (project stays v4), NO bundle regen.
- `onionSkin` is a TRANSIENT UI flag (not in undo history), mirroring `autoKey`.
- Ghosts: selected vector object only; up to `ONION_COUNT = 2` keyframe times before and after the playhead; `pointer-events: none`; rendered UNDER the live objects; no group when there are zero ghosts.
- Keyframe times = the union across ALL six track sources: `tracks[*]`, `shapeTrack`, `colorTracks[*]`, `gradientTracks[*]`, `dashOffsetTrack`, `motionPath.progress`.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Pure helpers — `engine/onionSkin.ts`

**Files:**
- Create: `src/engine/onionSkin.ts`
- Create: `src/engine/onionSkin.test.ts`
- Modify: `src/engine/index.ts` (barrel export)

**Interfaces:**
- Consumes: `SceneObject` (from `./types`).
- Produces: `objectKeyframeTimes(obj: SceneObject): number[]` (sorted, de-duped union); `onionSkinTimes(times: number[], playhead: number, count: number, eps?: number): { before: number[]; after: number[] }` (nearest-first, excludes on-playhead).

- [ ] **Step 1: Write the failing test**

Create `src/engine/onionSkin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { objectKeyframeTimes, onionSkinTimes } from './onionSkin';
import { createSceneObject } from './project';

describe('objectKeyframeTimes', () => {
  it('unions + de-dupes + sorts across all track sources', () => {
    const obj = createSceneObject('a', {
      tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 1, easing: 'linear' }] },
      shapeTrack: [{ time: 2, easing: 'linear', path: { nodes: [], closed: false } }],
      colorTracks: { fill: [{ time: 1, value: '#000000', easing: 'linear' }] },
      gradientTracks: { stroke: [{ time: 3, gradient: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [] }, easing: 'linear' }] },
      dashOffsetTrack: [{ time: 0, value: 1, easing: 'linear' }],
      motionPath: { path: { nodes: [{ anchor: { x: 0, y: 0 } }], closed: false }, orient: false, progress: [{ time: 4, value: 0, easing: 'linear' }] },
    });
    expect(objectKeyframeTimes(obj)).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns [] for a static object', () => {
    expect(objectKeyframeTimes(createSceneObject('a', {}))).toEqual([]);
  });
});

describe('onionSkinTimes', () => {
  const times = [0, 1, 2, 3, 4];
  it('picks count before + after the playhead, nearest first, excluding the on-playhead frame', () => {
    expect(onionSkinTimes(times, 2, 2)).toEqual({ before: [1, 0], after: [3, 4] });
  });
  it('excludes a keyframe within eps of the playhead (the live frame)', () => {
    expect(onionSkinTimes(times, 2.0000001, 2)).toEqual({ before: [1, 0], after: [3, 4] });
  });
  it('returns fewer than count near the ends', () => {
    expect(onionSkinTimes(times, 0.5, 2)).toEqual({ before: [0], after: [1, 2] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/onionSkin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `onionSkin.ts`**

Create `src/engine/onionSkin.ts`:

```ts
import type { SceneObject } from './types';

const EPS = 1e-6;

/** Sorted, de-duped union of every keyframe time on the object (all track sources). */
export function objectKeyframeTimes(obj: SceneObject): number[] {
  const times: number[] = [];
  for (const track of Object.values(obj.tracks)) {
    for (const k of track ?? []) times.push(k.time);
  }
  for (const k of obj.shapeTrack ?? []) times.push(k.time);
  for (const track of Object.values(obj.colorTracks ?? {})) {
    for (const k of track ?? []) times.push(k.time);
  }
  for (const track of Object.values(obj.gradientTracks ?? {})) {
    for (const k of track ?? []) times.push(k.time);
  }
  for (const k of obj.dashOffsetTrack ?? []) times.push(k.time);
  for (const k of obj.motionPath?.progress ?? []) times.push(k.time);
  times.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of times) {
    if (out.length === 0 || Math.abs(t - out[out.length - 1]) > EPS) out.push(t);
  }
  return out;
}

/** The `count` times immediately before and after the playhead, nearest first,
 *  excluding any within `eps` of the playhead (the live frame). */
export function onionSkinTimes(
  times: number[],
  playhead: number,
  count: number,
  eps = EPS,
): { before: number[]; after: number[] } {
  const before = times
    .filter((t) => t < playhead - eps)
    .sort((a, b) => b - a)
    .slice(0, count);
  const after = times
    .filter((t) => t > playhead + eps)
    .sort((a, b) => a - b)
    .slice(0, count);
  return { before, after };
}
```

- [ ] **Step 4: Add the barrel export**

In `src/engine/index.ts`, add a line next to the other top-level re-exports (e.g. after `export * from './motion';`):

```ts
export * from './onionSkin';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/engine/onionSkin.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/onionSkin.ts src/engine/onionSkin.test.ts src/engine/index.ts
git commit -m "feat(slice13): onionSkin pure helpers (keyframe-time union + before/after)"
```

---

### Task 2: Store — `onionSkin` flag + `toggleOnionSkin`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: state `onionSkin: boolean` (initial `false`); action `toggleOnionSkin(): void`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/store/store.test.ts`:

```ts
describe('onion skin toggle', () => {
  it('defaults off and flips', () => {
    useEditor.getState().newProject();
    expect(useEditor.getState().onionSkin).toBe(false);
    useEditor.getState().toggleOnionSkin();
    expect(useEditor.getState().onionSkin).toBe(true);
    useEditor.getState().toggleOnionSkin();
    expect(useEditor.getState().onionSkin).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "onion skin toggle"`
Expected: FAIL — `onionSkin`/`toggleOnionSkin` undefined.

- [ ] **Step 3: Add the flag + action**

In `src/ui/store/store.ts`:

1. In `EditorState`, after `autoKey: boolean;`:

```ts
  onionSkin: boolean;
```

2. In the actions interface, after `toggleAutoKey(): void;`:

```ts
  toggleOnionSkin(): void;
```

3. In the initial-state object, after `autoKey: true,`:

```ts
  onionSkin: false,
```

4. Add the action near `toggleAutoKey`:

```ts
  toggleOnionSkin() {
    set({ onionSkin: !get().onionSkin });
  },
```

> `newProject` resets the document but `onionSkin` is transient UI state; confirm `newProject` does not need to reset it (it is a view preference, like `theme`/`zoom`). If `newProject` explicitly resets transient flags, leave `onionSkin` out of that reset (a view preference persists across new projects).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "onion skin toggle"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice13): store onionSkin flag + toggleOnionSkin"
```

---

### Task 3: Stage — onion-skin ghost overlay

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `objectKeyframeTimes`/`onionSkinTimes` (Task 1, via `../../../engine`); `onionSkin` (Task 2); `sampleObject`/`geometryToSvgAttrs`/`pathToD`/`buildTransform`/`resolveAnchor`/`pathBounds` (already imported).
- Produces: a `<g data-testid="onion-skins" pointer-events="none">` with `onion-ghost-<before|after>-<index>` ghost elements, rendered under the live objects.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('renders no onion skins when the flag is off', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
  useEditor.getState().setProperty('x', 10); // a keyframe at t=0
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('onion-skins')).toBeNull();
});

it('renders before/after onion ghosts for an animated selected object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
  useEditor.getState().seek(0);
  useEditor.getState().setProperty('x', 0);   // keyframe at 0
  useEditor.getState().seek(2);
  useEditor.getState().setProperty('x', 100); // keyframe at 2
  useEditor.getState().seek(1);               // playhead between them
  useEditor.getState().toggleOnionSkin();
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('onion-skins')).toBeInTheDocument();
  expect(screen.getByTestId('onion-ghost-before-0')).toBeInTheDocument();
  expect(screen.getByTestId('onion-ghost-after-0')).toBeInTheDocument();
});

it('renders no onion group for a static selected object even with the flag on', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
  useEditor.getState().toggleOnionSkin();
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('onion-skins')).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — no `onion-skins` testid.

- [ ] **Step 3: Add imports + subscription + constants**

In `src/ui/components/Stage/Stage.tsx`:

1. Add `objectKeyframeTimes, onionSkinTimes` to the `from '../../../engine'` import.
2. Subscribe to the flag near the other `useEditor` selectors:

```ts
  const onionSkin = useEditor((s) => s.onionSkin);
```
3. Below `const ROTATE_STALK = 24;` add:

```ts
const ONION_COUNT = 2;
const ONION_OPACITY = [0.55, 0.3];
```

- [ ] **Step 4: Compute the ghosts (memo)**

After the `selectedRotatable` memo, add:

```ts
  // Onion-skin ghosts: the selected vector object sampled at its neighbouring
  // keyframe times. Editor-only chrome; null when off / no selection / no ghosts.
  const onionGhosts = useMemo(() => {
    if (!onionSkin || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || !asset || asset.kind !== 'vector') return null;
    const { before, after } = onionSkinTimes(objectKeyframeTimes(obj), time, ONION_COUNT);
    if (before.length === 0 && after.length === 0) return null;
    return { obj, asset, before, after };
  }, [onionSkin, selectedId, project.objects, assetsById, time]);
```

- [ ] **Step 5: Render the overlay (a small ghost helper)**

Just before `{ordered.map((o) => {` (so ghosts render under the live objects), add:

```tsx
          {onionGhosts &&
            (() => {
              const { obj, asset } = onionGhosts;
              const ghost = (ghostTime: number, tint: string, opacity: number, key: string) => {
                const gs = sampleObject(obj, ghostTime);
                if (asset.shapeType === 'path') {
                  const path = gs.path ?? asset.path ?? { nodes: [], closed: false };
                  const anchor = resolveAnchor(obj, gs, 'path', pathBounds(path));
                  return (
                    <g key={key} transform={buildTransform(gs, anchor.anchorX, anchor.anchorY)} opacity={opacity}>
                      <path data-testid={key} d={pathToD(path)} fill={tint} fillOpacity={0.18} stroke={tint} strokeWidth={1.5 / zoom} />
                    </g>
                  );
                }
                const anchor = resolveAnchor(obj, gs, asset.shapeType);
                const ShapeTag = asset.shapeType === 'rect' ? 'rect' : 'ellipse';
                return (
                  <g key={key} transform={buildTransform(gs, anchor.anchorX, anchor.anchorY)} opacity={opacity}>
                    <ShapeTag
                      data-testid={key}
                      {...geometryToSvgAttrs(asset.shapeType, gs.geometry ?? {})}
                      fill={tint}
                      fillOpacity={0.18}
                      stroke={tint}
                      strokeWidth={1.5 / zoom}
                    />
                  </g>
                );
              };
              return (
                <g data-testid="onion-skins" pointerEvents="none">
                  {onionGhosts.before.map((t, i) =>
                    ghost(t, 'var(--onion-before)', ONION_OPACITY[i] ?? 0.2, `onion-ghost-before-${i}`),
                  )}
                  {onionGhosts.after.map((t, i) =>
                    ghost(t, 'var(--onion-after)', ONION_OPACITY[i] ?? 0.2, `onion-ghost-after-${i}`),
                  )}
                </g>
              );
            })()}
          {ordered.map((o) => {
```

> The `key` doubles as the `data-testid` so each ghost is addressable. `pointerEvents="none"` on the group keeps ghosts inert.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (3 new tests + no regressions).

- [ ] **Step 7: Gate + commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: all green.

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice13): Stage onion-skin ghost overlay"
```

---

### Task 4: Toggle UI — Timeline button + token + keyboard shortcut

**Files:**
- Modify: `src/ui/components/Timeline/Timeline.tsx`
- Modify: `src/ui/theme/tokens.css`
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/components/Timeline/Timeline.test.tsx`, `src/ui/hooks/useKeyboard.test.ts`

**Interfaces:**
- Consumes: `onionSkin`/`toggleOnionSkin` (Task 2).
- Produces: an "Onion" toggle button in the Timeline header; `--onion-before`/`--onion-after` tokens; `o`/`O` shortcut.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Timeline/Timeline.test.tsx`:

```ts
it('toggles onion skin from the header button', async () => {
  render(<Timeline />);
  expect(useEditor.getState().onionSkin).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: /onion/i }));
  expect(useEditor.getState().onionSkin).toBe(true);
});
```

Append to `src/ui/hooks/useKeyboard.test.ts`:

```ts
it('o toggles onion skin', () => {
  const s = useEditor.getState();
  s.newProject();
  renderHook(() => useKeyboard());
  expect(useEditor.getState().onionSkin).toBe(false);
  fireEvent.keyDown(window, { key: 'o' });
  expect(useEditor.getState().onionSkin).toBe(true);
});
```

> If `useKeyboard.test.ts` does not already `import { renderHook } from '@testing-library/react'`, add it (the other tests in the file mount the hook — match their pattern; they use `renderHook(() => useKeyboard())`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx src/ui/hooks/useKeyboard.test.ts`
Expected: FAIL — no Onion button; `o` does nothing.

- [ ] **Step 3: Add the Timeline toggle**

In `src/ui/components/Timeline/Timeline.tsx`:

1. Subscribe + destructure the action:

```ts
  const onionSkin = useEditor((s) => s.onionSkin);
```
and add `toggleOnionSkin` to the destructured `useEditor.getState()` actions.

2. In the header (after the Auto-key button), add:

```tsx
        <button
          className={`${styles.toggle} ${onionSkin ? styles.on : ''}`}
          aria-pressed={onionSkin}
          onClick={toggleOnionSkin}
        >
          Onion
        </button>
```

- [ ] **Step 4: Add the tokens**

In `src/ui/theme/tokens.css`, add to BOTH theme blocks (alongside `--color-gradient`/`--color-dash`):

```css
  --onion-before: #5b8def;   /* default/dark block */
  --onion-after: #ef6a5b;
```
```css
  --onion-before: #3b6fd6;   /* light theme block */
  --onion-after: #d6483b;
```

- [ ] **Step 5: Add the keyboard shortcut**

In `src/ui/hooks/useKeyboard.ts`, add a case alongside the other tool shortcuts (e.g. after `case 'b': case 'B': ...`):

```ts
        case 'o': case 'O': s.toggleOnionSkin(); break;
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx src/ui/hooks/useKeyboard.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/Timeline/Timeline.tsx src/ui/theme/tokens.css src/ui/hooks/useKeyboard.ts src/ui/components/Timeline/Timeline.test.tsx src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(slice13): onion-skin toggle (Timeline button + tokens + o shortcut)"
```

---

### Task 5: End-to-end — onion ghosts appear when toggled

**Files:**
- Create: `e2e/onion-skin.spec.ts`

**Interfaces:**
- Consumes: the whole feature.

- [ ] **Step 1: Write the e2e**

Create `e2e/onion-skin.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('toggling onion skin shows ghosts for an animated object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect, then switch to the select tool.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();

  // Keyframe x at two times via the ruler + the Inspector x field (autoKey defaults on).
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('40');
  await xField.blur();
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await xField.fill('200');
  await xField.blur();

  // Seek between the keyframes and toggle onion on.
  await page.getByTestId('timeline-ruler').click({ position: { x: 60, y: 10 } });
  await page.getByRole('button', { name: /onion/i }).click();

  await expect(page.getByTestId('onion-skins')).toBeVisible();
  await expect(page.locator('[data-testid^="onion-ghost-"]').first()).toBeAttached();
});
```

> The Inspector `x` field exists for a selected object; `getByLabel('x', { exact: true })` matches it (the Inspector renders `aria-label="x"`). If the ruler-x-to-time mapping differs, the exact pixel positions are not load-bearing — any two distinct keyframe times bracketing the seek position work.

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec playwright test e2e/onion-skin.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/onion-skin.spec.ts
git commit -m "test(e2e): onion skin shows ghosts for an animated object"
```

---

## Self-Review (plan vs spec)

- **§3 pure helpers (union across all six sources; before/after nearest-first; exclude on-playhead)** → Task 1. ✅
- **§4 store flag + toggle** → Task 2. ✅
- **§5 Stage overlay (selected vector; onionSkinTimes; ghost = sampled shape, tint fill+stroke, under live objects; no group when zero ghosts; path uses pathBounds anchor)** → Task 3. ✅
- **§6 toggle UI (Timeline button; tokens both themes; `o` shortcut)** → Task 4. ✅
- **§7 no persistence/render/runtime/export change** → only `onionSkin.ts`, `index.ts`, store, Stage, Timeline, tokens, useKeyboard, tests, one e2e touched. ✅
- **§8 tests (pure; Stage off/animated/static; e2e)** → Tasks 1, 3, 5. ✅
- **Type consistency:** `objectKeyframeTimes(obj): number[]` + `onionSkinTimes(times, playhead, count, eps?): {before, after}` identical in Task 1 def + Task 3 call; `onionSkin`/`toggleOnionSkin` identical across Tasks 2/3/4; `ONION_COUNT`/`ONION_OPACITY` local to Task 3. ✅
- **Placeholder scan:** all steps carry concrete code; the e2e ruler-pixel + renderHook-import notes have concrete fallbacks. ✅
- **Spec §2 editor-only:** confirmed — no computeFrame/runtime/export/persistence files touched, no migration, no bundle regen.
