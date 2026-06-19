# Savig Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-agnostic, fully unit-tested TypeScript animation engine that powers both the editor preview and the exported HTML5 runtime.

**Architecture:** Pure functions over a plain-data `Project` document. No React, no DOM. A `(project, time) → RenderState[]` sampling pipeline (easing → interpolate → sample), plus document operations (keyframe CRUD, undo/redo), a pure playback-clock state machine, and pure audio-timing math. This is **Plan 1 of 3** for Milestone 1 (Engine → Services → UI). The same modules built here are later compiled into the export runtime, which is what guarantees preview == export.

**Tech Stack:** TypeScript (strict), Vite, Vitest, React (app shell only in Task 1), pnpm.

## Global Constraints

- Package manager: **pnpm** (v10+). Never invoke `npm`/`yarn`.
- Language: **TypeScript strict mode** (`"strict": true`, `noUnusedLocals`, `noUnusedParameters`).
- Framework floor: **React 18+**. Build tool: **Vite 5+**. Test runner: **Vitest 2+**.
- The `src/engine/**` directory has **zero imports of React or DOM APIs**. It must run under Vitest's `node` environment.
- Methodology: **TDD** — write the failing test, see it fail, write minimal code, see it pass, commit. **One logical change per commit.**
- All engine functions are **pure and immutable**: they return new values and never mutate their arguments.
- Numeric output that ends up in exported markup must be **deterministic** (rounded, stable ordering) so golden-file tests in Plan 2 don't flake.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

```
savig/
├── package.json                  # scripts + deps (Task 1)
├── vite.config.ts                # Vite + Vitest config (Task 1)
├── tsconfig.json                 # strict TS config (Task 1)
├── tsconfig.node.json            # config for vite.config.ts (Task 1)
├── eslint.config.js              # flat ESLint config (Task 1)
├── index.html                    # app entry (Task 1)
└── src/
    ├── main.tsx                  # React mount (Task 1)
    ├── ui/
    │   ├── App.tsx               # minimal app shell (Task 1)
    │   └── App.test.tsx          # smoke test (Task 1)
    └── engine/
        ├── types.ts              # all document types (Task 2)
        ├── project.ts            # factories + id helper (Task 2)
        ├── project.test.ts       # (Task 2)
        ├── easing.ts             # easing registry + cubicBezier (Task 3)
        ├── easing.test.ts        # (Task 3)
        ├── interpolate.ts        # interpolate(track, time) (Task 4)
        ├── interpolate.test.ts   # (Task 4)
        ├── transform.ts          # buildTransform() (Task 5)
        ├── transform.test.ts     # (Task 5)
        ├── sample.ts             # sampleObject / sampleProject (Task 6)
        ├── sample.test.ts        # (Task 6)
        ├── keyframes.ts          # keyframe CRUD + snapToFrame (Task 7)
        ├── keyframes.test.ts     # (Task 7)
        ├── duration.ts           # computeProjectDuration (Task 8)
        ├── duration.test.ts      # (Task 8)
        ├── history.ts            # undo/redo stack (Task 9)
        ├── history.test.ts       # (Task 9)
        ├── clock.ts              # playback clock state machine (Task 10)
        ├── clock.test.ts         # (Task 10)
        ├── audio-timing.ts       # resolveActiveClips (Task 11)
        ├── audio-timing.test.ts  # (Task 11)
        ├── index.ts              # barrel export (Task 12)
        └── index.test.ts         # integration test (Task 12)
```

**Test running convention:** run a single test file with `pnpm exec vitest run <file>` and a single named test with `pnpm exec vitest run <file> -t "<name>"`. Run everything with `pnpm test`.

---

## Task 1: Project scaffold & toolchain

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `eslint.config.js`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`
- Test: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: a working Vite+React app, `pnpm test`/`pnpm typecheck`/`pnpm lint` scripts, and Vitest configured with `node` env for `src/engine/**` and `jsdom` for `src/ui/**`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "savig",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.9.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "eslint": "^9.9.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "typescript-eslint": "^8.0.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [['src/ui/**', 'jsdom']],
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 5: Create `src/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Create `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
```

- [ ] **Step 7: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Savig</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create `src/ui/App.tsx`**

```tsx
export function App() {
  return <h1>Savig</h1>;
}
```

- [ ] **Step 9: Create `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 10: Write the smoke test `src/ui/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the app title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Savig' })).toBeInTheDocument();
});
```

- [ ] **Step 11: Install dependencies**

Run: `pnpm install`
Expected: completes without error; creates `pnpm-lock.yaml` and `node_modules/`.

- [ ] **Step 12: Run the smoke test (verify toolchain works)**

Run: `pnpm test`
Expected: PASS — 1 test passing (`renders the app title`).

- [ ] **Step 13: Verify typecheck and lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0 with no errors.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS + Vitest toolchain

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Core document types & factories

**Files:**
- Create: `src/engine/types.ts`, `src/engine/project.ts`
- Test: `src/engine/project.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (imported by nearly every later task):
  - Types: `Easing`, `EasingName`, `CubicBezierEasing`, `RotationMode`, `AnimatableProperty`, `Keyframe`, `Transform2D`, `SceneObject`, `SvgAsset`, `AudioAsset`, `Asset`, `AudioClip`, `DurationMode`, `ProjectMeta`, `Project`.
  - `newId(): string` — unique id (uses `crypto.randomUUID()`).
  - `createProject(overrides?: Partial<ProjectMeta>): Project`
  - `createSceneObject(assetId: string, overrides?: Partial<SceneObject>): SceneObject`
  - `createKeyframe(time: number, value: number, overrides?: Partial<Keyframe>): Keyframe`
  - `ANIMATABLE_PROPERTIES: readonly AnimatableProperty[]`
  - `DEFAULT_TRANSFORM: Transform2D`

- [ ] **Step 1: Create `src/engine/types.ts`**

```ts
export type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface CubicBezierEasing {
  readonly type: 'cubicBezier';
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  readonly p4: number;
}

export type Easing = EasingName | CubicBezierEasing;

export type RotationMode = 'shortest' | 'raw';

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity';

export interface Keyframe {
  /** Seconds from the start of the timeline. */
  time: number;
  value: number;
  easing: Easing;
  /** Only meaningful on the `rotation` track. Defaults to "shortest" when omitted. */
  rotationMode?: RotationMode;
}

export interface Transform2D {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

export interface SceneObject {
  id: string;
  name: string;
  assetId: string;
  zOrder: number;
  parentId?: string;
  anchorX: number;
  anchorY: number;
  /** Static values used for a property when it has no keyframes. */
  base: Transform2D;
  tracks: Partial<Record<AnimatableProperty, Keyframe[]>>;
}

export interface SvgAsset {
  id: string;
  kind: 'svg';
  name: string;
  /** id-namespaced, sanitized SVG markup. */
  normalizedContent: string;
  viewBox: string;
  width: number;
  height: number;
}

export interface AudioAsset {
  id: string;
  kind: 'audio';
  name: string;
  mimeType: string;
}

export type Asset = SvgAsset | AudioAsset;

export interface AudioClip {
  id: string;
  assetId: string;
  /** Timeline time (seconds) at which the clip begins. */
  startTime: number;
  /** Source in-point (seconds into the audio asset). */
  inPoint: number;
  /** Source out-point (seconds into the audio asset). */
  outPoint: number;
  /** 0..1 linear gain. */
  volume: number;
}

export type DurationMode = 'auto' | 'manual';

export interface ProjectMeta {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  durationMode: DurationMode;
  loop: boolean;
  version: number;
}

export interface Project {
  meta: ProjectMeta;
  assets: Asset[];
  objects: SceneObject[];
  audioClips: AudioClip[];
}
```

- [ ] **Step 2: Write the failing test `src/engine/project.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import {
  ANIMATABLE_PROPERTIES,
  DEFAULT_TRANSFORM,
  createKeyframe,
  createProject,
  createSceneObject,
  newId,
} from './project';

describe('newId', () => {
  test('returns unique non-empty strings', () => {
    expect(newId()).not.toEqual(newId());
    expect(newId().length).toBeGreaterThan(0);
  });
});

describe('createProject', () => {
  test('creates a project with sensible defaults and empty collections', () => {
    const project = createProject();
    expect(project.meta.width).toBe(1280);
    expect(project.meta.height).toBe(720);
    expect(project.meta.fps).toBe(30);
    expect(project.meta.durationMode).toBe('auto');
    expect(project.meta.loop).toBe(false);
    expect(project.meta.version).toBe(1);
    expect(project.assets).toEqual([]);
    expect(project.objects).toEqual([]);
    expect(project.audioClips).toEqual([]);
  });

  test('applies meta overrides', () => {
    const project = createProject({ name: 'Demo', fps: 60 });
    expect(project.meta.name).toBe('Demo');
    expect(project.meta.fps).toBe(60);
  });
});

describe('createSceneObject', () => {
  test('creates an object with default transform and empty tracks', () => {
    const obj = createSceneObject('asset-1');
    expect(obj.assetId).toBe('asset-1');
    expect(obj.base).toEqual(DEFAULT_TRANSFORM);
    expect(obj.tracks).toEqual({});
    expect(obj.id.length).toBeGreaterThan(0);
  });

  test('applies overrides', () => {
    const obj = createSceneObject('asset-1', { id: 'fixed', zOrder: 3 });
    expect(obj.id).toBe('fixed');
    expect(obj.zOrder).toBe(3);
  });
});

describe('createKeyframe', () => {
  test('defaults easing to linear', () => {
    const kf = createKeyframe(1.5, 100);
    expect(kf).toEqual({ time: 1.5, value: 100, easing: 'linear' });
  });

  test('applies overrides', () => {
    const kf = createKeyframe(0, 0, { easing: 'easeIn' });
    expect(kf.easing).toBe('easeIn');
  });
});

describe('constants', () => {
  test('ANIMATABLE_PROPERTIES lists the six animatable props', () => {
    expect([...ANIMATABLE_PROPERTIES]).toEqual([
      'x',
      'y',
      'scaleX',
      'scaleY',
      'rotation',
      'opacity',
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/project.test.ts`
Expected: FAIL — cannot resolve `./project`.

- [ ] **Step 4: Create `src/engine/project.ts`**

```ts
import type {
  AnimatableProperty,
  Keyframe,
  Project,
  ProjectMeta,
  SceneObject,
  Transform2D,
} from './types';

export const ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
] as const;

export const DEFAULT_TRANSFORM: Transform2D = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

export function newId(): string {
  return crypto.randomUUID();
}

export function createProject(overrides: Partial<ProjectMeta> = {}): Project {
  const meta: ProjectMeta = {
    name: 'Untitled',
    width: 1280,
    height: 720,
    fps: 30,
    duration: 0,
    durationMode: 'auto',
    loop: false,
    version: 1,
    ...overrides,
  };
  return { meta, assets: [], objects: [], audioClips: [] };
}

export function createSceneObject(
  assetId: string,
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return {
    id: newId(),
    name: 'Object',
    assetId,
    zOrder: 0,
    anchorX: 0,
    anchorY: 0,
    base: { ...DEFAULT_TRANSFORM },
    tracks: {},
    ...overrides,
  };
}

export function createKeyframe(
  time: number,
  value: number,
  overrides: Partial<Keyframe> = {},
): Keyframe {
  return { time, value, easing: 'linear', ...overrides };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/project.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/project.ts src/engine/project.test.ts
git commit -m "feat(engine): add core document types and factories

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Easing registry & cubic-bezier

**Files:**
- Create: `src/engine/easing.ts`
- Test: `src/engine/easing.test.ts`

**Interfaces:**
- Consumes: `Easing`, `EasingName` from `./types`.
- Produces:
  - `easingRegistry: Record<EasingName, (t: number) => number>`
  - `applyEasing(easing: Easing, t: number): number` — maps progress `t` in `[0,1]` to eased progress in `[0,1]`.

- [ ] **Step 1: Write the failing test `src/engine/easing.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { applyEasing, easingRegistry } from './easing';

describe('easingRegistry', () => {
  test('all named easings fix the endpoints 0 and 1', () => {
    for (const fn of Object.values(easingRegistry)) {
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    }
  });

  test('linear is the identity', () => {
    expect(easingRegistry.linear(0.25)).toBeCloseTo(0.25, 6);
    expect(easingRegistry.linear(0.5)).toBeCloseTo(0.5, 6);
  });

  test('easeIn starts slow (below linear at t=0.5)', () => {
    expect(easingRegistry.easeIn(0.5)).toBeLessThan(0.5);
  });

  test('easeOut ends slow (above linear at t=0.5)', () => {
    expect(easingRegistry.easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe('applyEasing', () => {
  test('resolves a named easing', () => {
    expect(applyEasing('linear', 0.4)).toBeCloseTo(0.4, 6);
  });

  test('resolves a cubic-bezier easing at the midpoint of a symmetric curve', () => {
    // ease-in-out cubic-bezier(0.42, 0, 0.58, 1) is symmetric → 0.5 at t=0.5
    const eased = applyEasing(
      { type: 'cubicBezier', p1: 0.42, p2: 0, p3: 0.58, p4: 1 },
      0.5,
    );
    expect(eased).toBeCloseTo(0.5, 3);
  });

  test('cubic-bezier fixes the endpoints', () => {
    const easing = { type: 'cubicBezier', p1: 0.25, p2: 0.1, p3: 0.25, p4: 1 } as const;
    expect(applyEasing(easing, 0)).toBeCloseTo(0, 4);
    expect(applyEasing(easing, 1)).toBeCloseTo(1, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/easing.test.ts`
Expected: FAIL — cannot resolve `./easing`.

- [ ] **Step 3: Create `src/engine/easing.ts`**

```ts
import type { Easing, EasingName } from './types';

export const easingRegistry: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
};

/**
 * Returns a function mapping progress t∈[0,1] to eased progress, for the CSS
 * cubic-bezier(x1, y1, x2, y2) curve. Solves x→t with Newton-Raphson and a
 * bisection fallback, then evaluates y.
 */
function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const xError = sampleX(t) - x;
      if (Math.abs(xError) < 1e-6) return t;
      const dx = sampleDX(t);
      if (Math.abs(dx) < 1e-6) break;
      t -= xError / dx;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const xValue = sampleX(t);
      if (Math.abs(xValue - x) < 1e-6) return t;
      if (x > xValue) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveX(t));
  };
}

export function applyEasing(easing: Easing, t: number): number {
  if (typeof easing === 'string') {
    return easingRegistry[easing](t);
  }
  return cubicBezier(easing.p1, easing.p2, easing.p3, easing.p4)(t);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/easing.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/easing.ts src/engine/easing.test.ts
git commit -m "feat(engine): add easing registry and cubic-bezier solver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Keyframe interpolation

**Files:**
- Create: `src/engine/interpolate.ts`
- Test: `src/engine/interpolate.test.ts`

**Interfaces:**
- Consumes: `Keyframe` from `./types`; `applyEasing` from `./easing`.
- Produces: `interpolate(track: Keyframe[], time: number): number`.

**Behavior contract (from spec §3):**
- Empty track throws (callers must guard; `sampleObject` only calls with non-empty tracks).
- `time` ≤ first keyframe → first value. `time` ≥ last keyframe → last value (clamp).
- Between keyframes A and B: progress is eased using **keyframe A's** easing.
- If keyframe A has `rotationMode: 'shortest'`, the segment takes the shortest angular path (delta normalized to `[-180, 180)`); `'raw'` or omitted-on-non-rotation interpolates literal values. (Default for rotation tracks is set to `'shortest'` by the keyframe factory callers in Task 7; `interpolate` treats a missing `rotationMode` as raw.)

- [ ] **Step 1: Write the failing test `src/engine/interpolate.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { interpolate } from './interpolate';
import { createKeyframe } from './project';

describe('interpolate', () => {
  test('throws on an empty track', () => {
    expect(() => interpolate([], 0)).toThrow();
  });

  test('returns the single value for a one-keyframe track', () => {
    expect(interpolate([createKeyframe(2, 42)], 0)).toBe(42);
    expect(interpolate([createKeyframe(2, 42)], 5)).toBe(42);
  });

  test('clamps before the first and after the last keyframe', () => {
    const track = [createKeyframe(1, 10), createKeyframe(3, 30)];
    expect(interpolate(track, 0)).toBe(10);
    expect(interpolate(track, 5)).toBe(30);
  });

  test('linearly interpolates at the midpoint', () => {
    const track = [createKeyframe(0, 0), createKeyframe(1, 100)];
    expect(interpolate(track, 0.5)).toBeCloseTo(50, 6);
  });

  test('eases with keyframe A easing over the A→B segment', () => {
    const track = [createKeyframe(0, 0, { easing: 'easeIn' }), createKeyframe(1, 100)];
    // easeIn(0.5) = 0.25 → 25
    expect(interpolate(track, 0.5)).toBeCloseTo(25, 6);
  });

  test('picks the correct segment across three keyframes', () => {
    const track = [
      createKeyframe(0, 0),
      createKeyframe(2, 100),
      createKeyframe(4, 0),
    ];
    expect(interpolate(track, 1)).toBeCloseTo(50, 6);
    expect(interpolate(track, 3)).toBeCloseTo(50, 6);
  });

  test('rotation shortest mode takes the short way (350 → 10 goes +20)', () => {
    const track = [
      createKeyframe(0, 350, { rotationMode: 'shortest' }),
      createKeyframe(1, 10),
    ];
    // shortest delta = +20 → at t=0.5 value = 360 (i.e. 350 + 10)
    expect(interpolate(track, 0.5)).toBeCloseTo(360, 6);
  });

  test('rotation raw mode interpolates literal values (350 → 10 goes down)', () => {
    const track = [
      createKeyframe(0, 350, { rotationMode: 'raw' }),
      createKeyframe(1, 10),
    ];
    expect(interpolate(track, 0.5)).toBeCloseTo(180, 6);
  });

  test('handles zero-length segments without dividing by zero', () => {
    const track = [createKeyframe(1, 10), createKeyframe(1, 20)];
    expect(Number.isFinite(interpolate(track, 1))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/interpolate.test.ts`
Expected: FAIL — cannot resolve `./interpolate`.

- [ ] **Step 3: Create `src/engine/interpolate.ts`**

```ts
import { applyEasing } from './easing';
import type { Keyframe } from './types';

function shortestAngleTarget(from: number, to: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta;
}

export function interpolate(track: Keyframe[], time: number): number {
  if (track.length === 0) {
    throw new Error('interpolate: track must contain at least one keyframe');
  }

  const first = track[0];
  const last = track[track.length - 1];
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;

  let a = first;
  let b = last;
  for (let i = 0; i < track.length - 1; i++) {
    if (time >= track[i].time && time < track[i + 1].time) {
      a = track[i];
      b = track[i + 1];
      break;
    }
  }

  const span = b.time - a.time;
  const rawProgress = span === 0 ? 0 : (time - a.time) / span;
  const progress = applyEasing(a.easing, rawProgress);

  const target =
    a.rotationMode === 'shortest' ? shortestAngleTarget(a.value, b.value) : b.value;

  return a.value + (target - a.value) * progress;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/interpolate.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/interpolate.ts src/engine/interpolate.test.ts
git commit -m "feat(engine): add keyframe interpolation with easing and rotation modes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Transform string builder

**Files:**
- Create: `src/engine/transform.ts`
- Test: `src/engine/transform.test.ts`

**Interfaces:**
- Consumes: `Transform2D` from `./types`.
- Produces:
  - `fmt(n: number): string` — deterministic number formatter (rounds to 4 decimals, normalizes `-0` to `0`).
  - `buildTransform(t: Transform2D, anchorX: number, anchorY: number): string` — the SVG `transform` attribute value. Order: `translate(x,y) rotate(angle,ax,ay) translate(ax,ay) scale(sx,sy) translate(-ax,-ay)`. (Opacity is part of `Transform2D` but is not part of the transform string; it is applied separately by the renderer.)

- [ ] **Step 1: Write the failing test `src/engine/transform.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { buildTransform, fmt } from './transform';
import { DEFAULT_TRANSFORM } from './project';

describe('fmt', () => {
  test('rounds to 4 decimals', () => {
    expect(fmt(1.234567)).toBe('1.2346');
  });

  test('normalizes negative zero to "0"', () => {
    expect(fmt(-0)).toBe('0');
  });

  test('keeps integers clean', () => {
    expect(fmt(5)).toBe('5');
  });
});

describe('buildTransform', () => {
  test('produces the fixed-order transform string', () => {
    const t = { ...DEFAULT_TRANSFORM, x: 10, y: 20, rotation: 45, scaleX: 2, scaleY: 3 };
    expect(buildTransform(t, 4, 5)).toBe(
      'translate(10, 20) rotate(45, 4, 5) translate(4, 5) scale(2, 3) translate(-4, -5)',
    );
  });

  test('is deterministic for identical inputs', () => {
    const t = { ...DEFAULT_TRANSFORM, x: 1.111111, rotation: 30 };
    expect(buildTransform(t, 0, 0)).toBe(buildTransform(t, 0, 0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/transform.test.ts`
Expected: FAIL — cannot resolve `./transform`.

- [ ] **Step 3: Create `src/engine/transform.ts`**

```ts
import type { Transform2D } from './types';

export function fmt(n: number): string {
  const rounded = Math.round(n * 1e4) / 1e4;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalized);
}

export function buildTransform(
  t: Transform2D,
  anchorX: number,
  anchorY: number,
): string {
  return [
    `translate(${fmt(t.x)}, ${fmt(t.y)})`,
    `rotate(${fmt(t.rotation)}, ${fmt(anchorX)}, ${fmt(anchorY)})`,
    `translate(${fmt(anchorX)}, ${fmt(anchorY)})`,
    `scale(${fmt(t.scaleX)}, ${fmt(t.scaleY)})`,
    `translate(${fmt(-anchorX)}, ${fmt(-anchorY)})`,
  ].join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/transform.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/transform.ts src/engine/transform.test.ts
git commit -m "feat(engine): add deterministic transform string builder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Sampling (object & project)

**Files:**
- Create: `src/engine/sample.ts`
- Test: `src/engine/sample.test.ts`

**Interfaces:**
- Consumes: `Project`, `SceneObject`, `AnimatableProperty`, `Transform2D` from `./types`; `interpolate` from `./interpolate`; `ANIMATABLE_PROPERTIES` from `./project`.
- Produces:
  - `interface RenderState extends Transform2D { objectId: string; }`
  - `sampleObject(obj: SceneObject, time: number): RenderState`
  - `sampleProject(project: Project, time: number): RenderState[]` — returned sorted ascending by `zOrder`, ties broken by original array order (stable).

- [ ] **Step 1: Write the failing test `src/engine/sample.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { sampleObject, sampleProject } from './sample';
import { createKeyframe, createProject, createSceneObject } from './project';

describe('sampleObject', () => {
  test('uses base values when a property has no keyframes', () => {
    const obj = createSceneObject('a', { base: {
      x: 7, y: 8, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5,
    } });
    const state = sampleObject(obj, 1);
    expect(state.x).toBe(7);
    expect(state.y).toBe(8);
    expect(state.opacity).toBe(0.5);
    expect(state.objectId).toBe(obj.id);
  });

  test('interpolates a keyframed property and falls back to base elsewhere', () => {
    const obj = createSceneObject('a', {
      base: { x: 0, y: 99, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      tracks: { x: [createKeyframe(0, 0), createKeyframe(2, 100)] },
    });
    const state = sampleObject(obj, 1);
    expect(state.x).toBeCloseTo(50, 6);
    expect(state.y).toBe(99);
  });

  test('treats an empty track array as no keyframes (uses base)', () => {
    const obj = createSceneObject('a', {
      base: { x: 12, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      tracks: { x: [] },
    });
    expect(sampleObject(obj, 1).x).toBe(12);
  });
});

describe('sampleProject', () => {
  test('returns one render state per object, ordered by zOrder', () => {
    const project = createProject();
    project.objects = [
      createSceneObject('a', { id: 'top', zOrder: 5 }),
      createSceneObject('a', { id: 'bottom', zOrder: 1 }),
    ];
    const states = sampleProject(project, 0);
    expect(states.map((s) => s.objectId)).toEqual(['bottom', 'top']);
  });

  test('is a pure function (does not mutate the project)', () => {
    const project = createProject();
    project.objects = [createSceneObject('a', { id: 'x', zOrder: 2 })];
    const snapshot = JSON.stringify(project);
    sampleProject(project, 1);
    expect(JSON.stringify(project)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/sample.test.ts`
Expected: FAIL — cannot resolve `./sample`.

- [ ] **Step 3: Create `src/engine/sample.ts`**

```ts
import { interpolate } from './interpolate';
import { ANIMATABLE_PROPERTIES } from './project';
import type { AnimatableProperty, Project, SceneObject, Transform2D } from './types';

export interface RenderState extends Transform2D {
  objectId: string;
}

export function sampleObject(obj: SceneObject, time: number): RenderState {
  const resolve = (prop: AnimatableProperty): number => {
    const track = obj.tracks[prop];
    if (track && track.length > 0) {
      return interpolate(track, time);
    }
    return obj.base[prop];
  };

  const state = { objectId: obj.id } as RenderState;
  for (const prop of ANIMATABLE_PROPERTIES) {
    state[prop] = resolve(prop);
  }
  return state;
}

export function sampleProject(project: Project, time: number): RenderState[] {
  return project.objects
    .map((obj, index) => ({ obj, index }))
    .sort((p, q) => p.obj.zOrder - q.obj.zOrder || p.index - q.index)
    .map(({ obj }) => sampleObject(obj, time));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/sample.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/sample.ts src/engine/sample.test.ts
git commit -m "feat(engine): add object and project sampling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Keyframe operations & frame snapping

**Files:**
- Create: `src/engine/keyframes.ts`
- Test: `src/engine/keyframes.test.ts`

**Interfaces:**
- Consumes: `Keyframe` from `./types`.
- Produces (all pure; return new arrays/values):
  - `snapToFrame(time: number, fps: number): number` — rounds a time to the nearest frame boundary.
  - `upsertKeyframe(track: Keyframe[], keyframe: Keyframe): Keyframe[]` — inserts, or replaces the keyframe at the same `time`; result stays sorted ascending by `time`.
  - `removeKeyframeAt(track: Keyframe[], time: number): Keyframe[]` — removes any keyframe at `time` (exact match).
  - `EPSILON: number` — time-equality tolerance (`1e-6`).

- [ ] **Step 1: Write the failing test `src/engine/keyframes.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { removeKeyframeAt, snapToFrame, upsertKeyframe } from './keyframes';
import { createKeyframe } from './project';

describe('snapToFrame', () => {
  test('rounds to the nearest frame boundary at 30fps', () => {
    expect(snapToFrame(0.04, 30)).toBeCloseTo(1 / 30, 6); // nearest frame is frame 1
    expect(snapToFrame(0.0, 30)).toBe(0);
  });

  test('returns the input when fps is not positive', () => {
    expect(snapToFrame(0.123, 0)).toBe(0.123);
  });
});

describe('upsertKeyframe', () => {
  test('inserts keeping ascending time order', () => {
    const track = [createKeyframe(0, 0), createKeyframe(2, 20)];
    const result = upsertKeyframe(track, createKeyframe(1, 10));
    expect(result.map((k) => k.time)).toEqual([0, 1, 2]);
  });

  test('replaces an existing keyframe at the same time', () => {
    const track = [createKeyframe(0, 0), createKeyframe(1, 10)];
    const result = upsertKeyframe(track, createKeyframe(1, 999));
    expect(result).toHaveLength(2);
    expect(result[1].value).toBe(999);
  });

  test('does not mutate the input track', () => {
    const track = [createKeyframe(0, 0)];
    upsertKeyframe(track, createKeyframe(1, 1));
    expect(track).toHaveLength(1);
  });
});

describe('removeKeyframeAt', () => {
  test('removes the keyframe at the given time', () => {
    const track = [createKeyframe(0, 0), createKeyframe(1, 10)];
    expect(removeKeyframeAt(track, 1).map((k) => k.time)).toEqual([0]);
  });

  test('returns an equivalent track when nothing matches', () => {
    const track = [createKeyframe(0, 0)];
    expect(removeKeyframeAt(track, 5)).toEqual(track);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/keyframes.test.ts`
Expected: FAIL — cannot resolve `./keyframes`.

- [ ] **Step 3: Create `src/engine/keyframes.ts`**

```ts
import type { Keyframe } from './types';

export const EPSILON = 1e-6;

export function snapToFrame(time: number, fps: number): number {
  if (fps <= 0) return time;
  return Math.round(time * fps) / fps;
}

export function upsertKeyframe(track: Keyframe[], keyframe: Keyframe): Keyframe[] {
  const withoutSameTime = track.filter(
    (k) => Math.abs(k.time - keyframe.time) > EPSILON,
  );
  withoutSameTime.push(keyframe);
  withoutSameTime.sort((a, b) => a.time - b.time);
  return withoutSameTime;
}

export function removeKeyframeAt(track: Keyframe[], time: number): Keyframe[] {
  return track.filter((k) => Math.abs(k.time - time) > EPSILON);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/keyframes.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/keyframes.ts src/engine/keyframes.test.ts
git commit -m "feat(engine): add keyframe upsert/remove and frame snapping

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Project duration

**Files:**
- Create: `src/engine/duration.ts`
- Test: `src/engine/duration.test.ts`

**Interfaces:**
- Consumes: `Project` from `./types`.
- Produces: `computeProjectDuration(project: Project): number` — when `meta.durationMode === 'manual'` returns `meta.duration`; otherwise returns the max end time across all keyframes (latest `time`) and audio clips (`startTime + (outPoint - inPoint)`), or `0` when empty.

- [ ] **Step 1: Write the failing test `src/engine/duration.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { computeProjectDuration } from './duration';
import { createKeyframe, createProject, createSceneObject } from './project';

describe('computeProjectDuration', () => {
  test('is 0 for an empty auto project', () => {
    expect(computeProjectDuration(createProject())).toBe(0);
  });

  test('uses the latest keyframe time in auto mode', () => {
    const project = createProject();
    project.objects = [
      createSceneObject('a', {
        tracks: { x: [createKeyframe(0, 0), createKeyframe(3.5, 100)] },
      }),
    ];
    expect(computeProjectDuration(project)).toBeCloseTo(3.5, 6);
  });

  test('considers audio clip end times in auto mode', () => {
    const project = createProject();
    project.audioClips = [
      { id: 'c1', assetId: 'a', startTime: 2, inPoint: 1, outPoint: 4, volume: 1 },
    ];
    // ends at 2 + (4 - 1) = 5
    expect(computeProjectDuration(project)).toBeCloseTo(5, 6);
  });

  test('returns meta.duration in manual mode', () => {
    const project = createProject({ durationMode: 'manual', duration: 12 });
    project.objects = [
      createSceneObject('a', { tracks: { x: [createKeyframe(99, 0)] } }),
    ];
    expect(computeProjectDuration(project)).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/duration.test.ts`
Expected: FAIL — cannot resolve `./duration`.

- [ ] **Step 3: Create `src/engine/duration.ts`**

```ts
import type { Project } from './types';

export function computeProjectDuration(project: Project): number {
  if (project.meta.durationMode === 'manual') {
    return project.meta.duration;
  }

  let max = 0;
  for (const obj of project.objects) {
    for (const track of Object.values(obj.tracks)) {
      if (!track) continue;
      for (const keyframe of track) {
        if (keyframe.time > max) max = keyframe.time;
      }
    }
  }
  for (const clip of project.audioClips) {
    const end = clip.startTime + (clip.outPoint - clip.inPoint);
    if (end > max) max = end;
  }
  return max;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/duration.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/duration.ts src/engine/duration.test.ts
git commit -m "feat(engine): add project duration computation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Undo/redo history

**Files:**
- Create: `src/engine/history.ts`
- Test: `src/engine/history.test.ts`

**Interfaces:**
- Consumes: nothing (generic).
- Produces (generic over a document type `T`; all pure):
  - `interface History<T> { past: T[]; present: T; future: T[]; }`
  - `createHistory<T>(present: T): History<T>`
  - `pushHistory<T>(history: History<T>, next: T): History<T>` — sets a new present, pushing the old present onto `past`, clearing `future`.
  - `undo<T>(history: History<T>): History<T>` — no-op when `past` is empty.
  - `redo<T>(history: History<T>): History<T>` — no-op when `future` is empty.
  - `canUndo<T>(history: History<T>): boolean`, `canRedo<T>(history: History<T>): boolean`.

- [ ] **Step 1: Write the failing test `src/engine/history.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
} from './history';

describe('history', () => {
  test('starts with the given present and no past/future', () => {
    const h = createHistory(1);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  test('push moves present to past and clears future', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    expect(h.present).toBe(2);
    expect(h.past).toEqual([1]);
    expect(h.future).toEqual([]);
  });

  test('undo and redo move between states', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
  });

  test('a new push after undo clears the redo future', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = undo(h);
    h = pushHistory(h, 99);
    expect(h.present).toBe(99);
    expect(canRedo(h)).toBe(false);
  });

  test('undo and redo are no-ops at the ends', () => {
    const h = createHistory(1);
    expect(undo(h)).toEqual(h);
    expect(redo(h)).toEqual(h);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/history.test.ts`
Expected: FAIL — cannot resolve `./history`.

- [ ] **Step 3: Create `src/engine/history.ts`**

```ts
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function pushHistory<T>(history: History<T>, next: T): History<T> {
  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/history.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/history.ts src/engine/history.test.ts
git commit -m "feat(engine): add generic undo/redo history

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Playback clock state machine

**Files:**
- Create: `src/engine/clock.ts`
- Test: `src/engine/clock.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (pure state machine — no RAF, no timers; the UI feeds timestamps in):
  - `interface ClockState { time: number; playing: boolean; lastTimestamp: number | null; }`
  - `createClock(): ClockState` — `{ time: 0, playing: false, lastTimestamp: null }`.
  - `play(state: ClockState, timestamp: number): ClockState` — marks playing and anchors `lastTimestamp`.
  - `pause(state: ClockState): ClockState`.
  - `seek(state: ClockState, time: number): ClockState` — sets `time` (clamped ≥ 0), keeps playing state, resets `lastTimestamp` to `null` so the next `advance` re-anchors.
  - `advance(state: ClockState, timestamp: number, duration: number, loop: boolean): ClockState` — when playing, adds elapsed wall-clock delta to `time`; when `time` exceeds `duration`, wraps if `loop` else clamps to `duration` and pauses. `timestamp` is in **seconds**.

- [ ] **Step 1: Write the failing test `src/engine/clock.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { advance, createClock, pause, play, seek } from './clock';

describe('clock', () => {
  test('starts paused at time 0', () => {
    const c = createClock();
    expect(c).toEqual({ time: 0, playing: false, lastTimestamp: null });
  });

  test('advance does nothing while paused', () => {
    const c = createClock();
    expect(advance(c, 10, 100, false).time).toBe(0);
  });

  test('advance accumulates elapsed seconds while playing', () => {
    let c = play(createClock(), 100);
    c = advance(c, 100.5, 10, false);
    expect(c.time).toBeCloseTo(0.5, 6);
    c = advance(c, 101, 10, false);
    expect(c.time).toBeCloseTo(1, 6);
  });

  test('clamps to duration and pauses at the end when not looping', () => {
    let c = play(createClock(), 0);
    c = advance(c, 5, 3, false);
    expect(c.time).toBe(3);
    expect(c.playing).toBe(false);
  });

  test('wraps around when looping', () => {
    let c = play(createClock(), 0);
    c = advance(c, 3.5, 3, true);
    expect(c.time).toBeCloseTo(0.5, 6);
    expect(c.playing).toBe(true);
  });

  test('seek clamps to >= 0 and re-anchors the next advance', () => {
    let c = play(createClock(), 100);
    c = seek(c, -5);
    expect(c.time).toBe(0);
    expect(c.lastTimestamp).toBeNull();
    c = advance(c, 200, 10, false); // first advance after seek re-anchors, no jump
    expect(c.time).toBe(0);
    c = advance(c, 200.25, 10, false);
    expect(c.time).toBeCloseTo(0.25, 6);
  });

  test('pause stops accumulation', () => {
    let c = play(createClock(), 0);
    c = advance(c, 1, 10, false);
    c = pause(c);
    c = advance(c, 5, 10, false);
    expect(c.time).toBeCloseTo(1, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/clock.test.ts`
Expected: FAIL — cannot resolve `./clock`.

- [ ] **Step 3: Create `src/engine/clock.ts`**

```ts
export interface ClockState {
  /** Current playhead time in seconds. */
  time: number;
  playing: boolean;
  /** Wall-clock timestamp (seconds) of the last advance; null until anchored. */
  lastTimestamp: number | null;
}

export function createClock(): ClockState {
  return { time: 0, playing: false, lastTimestamp: null };
}

export function play(state: ClockState, timestamp: number): ClockState {
  return { ...state, playing: true, lastTimestamp: timestamp };
}

export function pause(state: ClockState): ClockState {
  return { ...state, playing: false, lastTimestamp: null };
}

export function seek(state: ClockState, time: number): ClockState {
  return { ...state, time: Math.max(0, time), lastTimestamp: null };
}

export function advance(
  state: ClockState,
  timestamp: number,
  duration: number,
  loop: boolean,
): ClockState {
  if (!state.playing) return state;
  if (state.lastTimestamp === null) {
    return { ...state, lastTimestamp: timestamp };
  }

  const delta = timestamp - state.lastTimestamp;
  let time = state.time + delta;

  if (duration <= 0) {
    return { ...state, time: 0, lastTimestamp: timestamp };
  }

  if (time >= duration) {
    if (loop) {
      time = time % duration;
      return { ...state, time, lastTimestamp: timestamp };
    }
    return { ...state, time: duration, playing: false, lastTimestamp: null };
  }

  return { ...state, time, lastTimestamp: timestamp };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/clock.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/clock.ts src/engine/clock.test.ts
git commit -m "feat(engine): add pure playback clock state machine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Audio timing math

**Files:**
- Create: `src/engine/audio-timing.ts`
- Test: `src/engine/audio-timing.test.ts`

**Interfaces:**
- Consumes: `AudioClip` from `./types`.
- Produces:
  - `interface ActiveClip { clip: AudioClip; sourceOffset: number; }` — `sourceOffset` is the seconds into the source audio asset to play at the queried timeline `time`.
  - `resolveActiveClips(clips: AudioClip[], time: number): ActiveClip[]` — returns clips whose `[startTime, startTime + (outPoint - inPoint))` interval contains `time`, with `sourceOffset = inPoint + (time - startTime)`.

- [ ] **Step 1: Write the failing test `src/engine/audio-timing.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { resolveActiveClips } from './audio-timing';
import type { AudioClip } from './types';

const clip = (over: Partial<AudioClip>): AudioClip => ({
  id: 'c',
  assetId: 'a',
  startTime: 0,
  inPoint: 0,
  outPoint: 5,
  volume: 1,
  ...over,
});

describe('resolveActiveClips', () => {
  test('returns a clip active at the queried time with the right source offset', () => {
    const clips = [clip({ startTime: 2, inPoint: 1, outPoint: 4 })];
    // active over [2, 5); at time 3 → sourceOffset = 1 + (3 - 2) = 2
    const active = resolveActiveClips(clips, 3);
    expect(active).toHaveLength(1);
    expect(active[0].sourceOffset).toBeCloseTo(2, 6);
  });

  test('excludes clips before their start and at/after their end', () => {
    const clips = [clip({ startTime: 2, inPoint: 0, outPoint: 3 })]; // active [2,5)
    expect(resolveActiveClips(clips, 1)).toHaveLength(0);
    expect(resolveActiveClips(clips, 5)).toHaveLength(0);
    expect(resolveActiveClips(clips, 2)).toHaveLength(1);
  });

  test('returns multiple overlapping clips', () => {
    const clips = [
      clip({ id: 'c1', startTime: 0, outPoint: 10 }),
      clip({ id: 'c2', startTime: 1, outPoint: 10 }),
    ];
    expect(resolveActiveClips(clips, 2).map((a) => a.clip.id)).toEqual(['c1', 'c2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/engine/audio-timing.test.ts`
Expected: FAIL — cannot resolve `./audio-timing`.

- [ ] **Step 3: Create `src/engine/audio-timing.ts`**

```ts
import type { AudioClip } from './types';

export interface ActiveClip {
  clip: AudioClip;
  /** Seconds into the source audio asset to play at the queried timeline time. */
  sourceOffset: number;
}

export function resolveActiveClips(clips: AudioClip[], time: number): ActiveClip[] {
  const active: ActiveClip[] = [];
  for (const clip of clips) {
    const length = clip.outPoint - clip.inPoint;
    const end = clip.startTime + length;
    if (time >= clip.startTime && time < end) {
      active.push({ clip, sourceOffset: clip.inPoint + (time - clip.startTime) });
    }
  }
  return active;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/engine/audio-timing.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/audio-timing.ts src/engine/audio-timing.test.ts
git commit -m "feat(engine): add audio clip timing resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Public barrel & integration test

**Files:**
- Create: `src/engine/index.ts`, `src/engine/index.test.ts`

**Interfaces:**
- Consumes: every engine module.
- Produces: `src/engine/index.ts` re-exporting the public API so consumers (Plans 2–3 and the export runtime) import from `./engine` only.

- [ ] **Step 1: Create the barrel `src/engine/index.ts`**

```ts
export * from './types';
export * from './project';
export * from './easing';
export * from './interpolate';
export * from './transform';
export * from './sample';
export * from './keyframes';
export * from './duration';
export * from './history';
export * from './clock';
export * from './audio-timing';
```

- [ ] **Step 2: Write the integration test `src/engine/index.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import {
  advance,
  buildTransform,
  computeProjectDuration,
  createKeyframe,
  createProject,
  createSceneObject,
  play,
  sampleProject,
  upsertKeyframe,
} from './index';

describe('engine integration', () => {
  test('build a project, animate it, and sample a frame end-to-end', () => {
    // Object that slides x from 0 to 100 over 2 seconds.
    const obj = createSceneObject('svg-asset', { id: 'mover', anchorX: 50, anchorY: 50 });
    obj.tracks.x = upsertKeyframe(
      upsertKeyframe([], createKeyframe(0, 0)),
      createKeyframe(2, 100),
    );

    const project = createProject({ name: 'Integration' });
    project.objects = [obj];

    expect(computeProjectDuration(project)).toBeCloseTo(2, 6);

    const midState = sampleProject(project, 1)[0];
    expect(midState.x).toBeCloseTo(50, 6);

    const transform = buildTransform(midState, obj.anchorX, obj.anchorY);
    expect(transform).toContain('translate(50, 0)');
  });

  test('clock drives time forward to produce a later sample', () => {
    const obj = createSceneObject('svg-asset', { id: 'mover' });
    obj.tracks.x = upsertKeyframe(
      upsertKeyframe([], createKeyframe(0, 0)),
      createKeyframe(2, 100),
    );
    const project = createProject();
    project.objects = [obj];

    let clock = play({ time: 0, playing: true, lastTimestamp: null }, 0);
    clock = advance(clock, 0, 2, false); // anchor
    clock = advance(clock, 1, 2, false); // +1s
    expect(sampleProject(project, clock.time)[0].x).toBeCloseTo(50, 6);
  });
});
```

- [ ] **Step 3: Run the integration test**

Run: `pnpm exec vitest run src/engine/index.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 4: Run the full suite, typecheck, and lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all engine + UI tests pass; typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/engine/index.ts src/engine/index.test.ts
git commit -m "feat(engine): add public barrel and end-to-end integration test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

**Spec coverage (engine-relevant items from the M1 spec):**
- Plain serializable `Project` document → Task 2. ✓
- Assets vs objects separation, content-addressed ids (id field present; hashing is a Plan 2 import concern) → Task 2. ✓
- `anchorX/anchorY` pivot → Task 2 + Task 5. ✓
- Per-property keyframe tracks + static base values → Task 2, Task 6. ✓
- Continuous seconds internally; frame snapping for UI → Task 7 (`snapToFrame`). ✓
- Easing registry shared everywhere; cubic-bezier → Task 3. ✓
- Easing governs the leaving (A→B) segment → Task 4. ✓
- Rotation `shortest`/`raw` → Task 4. ✓
- Tween core `interpolate`/`sampleObject`/`sampleProject`, clamping, empty-track static value, empty project plays → Tasks 4 & 6. ✓
- Deterministic transform string via shared `buildTransform()` → Task 5. ✓
- `durationMode` auto/manual → Task 8. ✓
- Undo/redo snapshots the document tree only → Task 9 (generic; document binding happens in the Plan 3 store). ✓
- Playback clock; AudioContext-as-master is a Plan 2/3 wiring concern, but the clock is timestamp-driven so it can be fed `audioContext.currentTime` → Task 10. ✓
- Audio clip timing math → Task 11. ✓
- TDD, pnpm, Vitest, strict TS, zero-DOM engine → Task 1 + global constraints. ✓

**Deferred to later plans (correctly out of scope here):** SVG sanitization/id-namespacing, audio decode, `.savig` zip persistence, IndexedDB autosave, migration registry, HTML5 export + runtime-parity test, Playwright e2e, all UI/theming, the Zustand store, AudioContext wiring.

**Placeholder scan:** none — every step contains complete code or an exact command.

**Type consistency:** `Transform2D` (Task 2) is reused by `RenderState` (Task 6) and `buildTransform` (Task 5). `Keyframe`/`createKeyframe` signatures match across Tasks 2, 4, 7. `History<T>` API names (`pushHistory`/`undo`/`redo`/`canUndo`/`canRedo`) are consistent. `ClockState` field names (`time`/`playing`/`lastTimestamp`) consistent across Task 10 and the Task 12 integration test.
