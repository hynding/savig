# M2 Slice 6 — Primitives (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure `engine/primitives.ts` module with three path generators — `polygonPath`, `starPath`, `linePath` — each returning a `PathData` of corner nodes.

**Architecture:** Generators are the single geometry source of truth. Because the UI routes their output through the existing `addVectorPath` → `shapeType:'path'` pipeline, everything downstream (render, node-edit, morph, color, motion, export, persistence) already works. This plan is engine-only and self-contained.

**Tech Stack:** TypeScript (strict), Vitest. No new dependencies.

## Global Constraints

- TypeScript strict; framework-agnostic engine (no React/DOM imports in `src/engine`).
- Pure functions only: deterministic, no side effects, no mutation of inputs.
- `PathData` = `{ nodes: PathNode[]; closed: boolean }`; `PathNode` = `{ anchor: PathPoint; in?: PathPoint; out?: PathPoint }`; `PathPoint` = `{ x: number; y: number }`. Corner nodes omit `in`/`out`.
- Use `0 - v` (not `-v`) when negating a coordinate that may be zero, to avoid `-0` (Vitest `toEqual` distinguishes `-0` from `+0`).
- No persistence version bump (primitives are ordinary paths). Project stays at version 4.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 1: `polygonPath` generator

**Files:**
- Create: `src/engine/primitives.ts`
- Test: `src/engine/primitives.test.ts`

**Interfaces:**
- Consumes: `PathData`, `PathPoint` from `./types`.
- Produces: `polygonPath(cx: number, cy: number, radius: number, sides: number, rotation?: number): PathData` — `sides` (clamped ≥ 3) corner anchors evenly spaced on a circle of `radius` about `(cx,cy)`; first vertex at angle `-90°` (straight up) plus `rotation` (radians); `closed: true`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { polygonPath } from './primitives';

describe('polygonPath', () => {
  it('produces `sides` closed corner nodes', () => {
    const p = polygonPath(0, 0, 10, 5);
    expect(p.nodes).toHaveLength(5);
    expect(p.closed).toBe(true);
    expect(p.nodes.every((n) => n.in === undefined && n.out === undefined)).toBe(true);
  });

  it('places the first vertex straight up (−90°)', () => {
    const p = polygonPath(0, 0, 10, 4);
    expect(p.nodes[0].anchor.x).toBeCloseTo(0, 6);
    expect(p.nodes[0].anchor.y).toBeCloseTo(-10, 6);
  });

  it('lays a square out clockwise in SVG space', () => {
    const p = polygonPath(0, 0, 10, 4); // up, right, down, left
    expect(p.nodes[1].anchor.x).toBeCloseTo(10, 6);
    expect(p.nodes[1].anchor.y).toBeCloseTo(0, 6);
    expect(p.nodes[2].anchor.y).toBeCloseTo(10, 6);
    expect(p.nodes[3].anchor.x).toBeCloseTo(-10, 6);
  });

  it('honors center and rotation', () => {
    const p = polygonPath(100, 50, 10, 4, Math.PI / 2); // +90° → first vertex points right
    expect(p.nodes[0].anchor.x).toBeCloseTo(110, 6);
    expect(p.nodes[0].anchor.y).toBeCloseTo(50, 6);
  });

  it('clamps sides to at least 3', () => {
    expect(polygonPath(0, 0, 10, 2).nodes).toHaveLength(3);
    expect(polygonPath(0, 0, 10, 0).nodes).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine/primitives.test.ts`
Expected: FAIL — `polygonPath` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { PathData, PathPoint } from './types';

// Generators emit corner-node PathData (no bezier handles). First vertex points
// straight up (angle −90°) so a freshly stamped shape reads upright; callers add
// `rotation` (radians) on top.
const TOP = -Math.PI / 2;

function vertex(cx: number, cy: number, radius: number, angle: number): PathPoint {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

export function polygonPath(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation = 0,
): PathData {
  const n = Math.max(3, Math.floor(sides));
  const nodes = Array.from({ length: n }, (_, i) => ({
    anchor: vertex(cx, cy, radius, TOP + rotation + (i * 2 * Math.PI) / n),
  }));
  return { nodes, closed: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/engine/primitives.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/primitives.ts src/engine/primitives.test.ts
git commit -m "feat(primitives): polygonPath generator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `starPath` generator

**Files:**
- Modify: `src/engine/primitives.ts`
- Test: `src/engine/primitives.test.ts`

**Interfaces:**
- Produces: `starPath(cx: number, cy: number, outerRadius: number, innerRadius: number, points: number, rotation?: number): PathData` — `2 * points` (points clamped ≥ 2) corner anchors alternating outer/inner radius; first (outer) vertex straight up plus `rotation`; `closed: true`.

- [ ] **Step 1: Write the failing tests**

```ts
import { starPath } from './primitives';

describe('starPath', () => {
  it('produces 2*points closed corner nodes alternating radius', () => {
    const p = starPath(0, 0, 10, 4, 5);
    expect(p.nodes).toHaveLength(10);
    expect(p.closed).toBe(true);
    expect(p.nodes.every((n) => n.in === undefined && n.out === undefined)).toBe(true);
    // even indices = outer radius (10), odd = inner radius (4)
    const r = (i: number) => Math.hypot(p.nodes[i].anchor.x, p.nodes[i].anchor.y);
    expect(r(0)).toBeCloseTo(10, 6);
    expect(r(1)).toBeCloseTo(4, 6);
    expect(r(2)).toBeCloseTo(10, 6);
  });

  it('places the first outer vertex straight up', () => {
    const p = starPath(0, 0, 10, 4, 5);
    expect(p.nodes[0].anchor.x).toBeCloseTo(0, 6);
    expect(p.nodes[0].anchor.y).toBeCloseTo(-10, 6);
  });

  it('clamps points to at least 2', () => {
    expect(starPath(0, 0, 10, 4, 1).nodes).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine/primitives.test.ts -t star`
Expected: FAIL — `starPath` is not defined.

- [ ] **Step 3: Write minimal implementation** (append to `src/engine/primitives.ts`)

```ts
export function starPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  points: number,
  rotation = 0,
): PathData {
  const p = Math.max(2, Math.floor(points));
  const count = p * 2;
  const step = (2 * Math.PI) / count;
  const nodes = Array.from({ length: count }, (_, i) => ({
    anchor: vertex(cx, cy, i % 2 === 0 ? outerRadius : innerRadius, TOP + rotation + i * step),
  }));
  return { nodes, closed: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/engine/primitives.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/primitives.ts src/engine/primitives.test.ts
git commit -m "feat(primitives): starPath generator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `linePath` generator + barrel export

**Files:**
- Modify: `src/engine/primitives.ts`
- Modify: `src/engine/index.ts`
- Test: `src/engine/primitives.test.ts`

**Interfaces:**
- Produces: `linePath(p0: PathPoint, p1: PathPoint): PathData` — open 2-node path `[p0, p1]`, corner nodes, `closed: false`.
- Re-exported from the engine barrel (`export * from './primitives'`).

- [ ] **Step 1: Write the failing tests**

```ts
import { linePath } from './primitives';

describe('linePath', () => {
  it('produces an open two-node corner path', () => {
    const p = linePath({ x: 1, y: 2 }, { x: 9, y: 4 });
    expect(p.closed).toBe(false);
    expect(p.nodes).toHaveLength(2);
    expect(p.nodes[0].anchor).toEqual({ x: 1, y: 2 });
    expect(p.nodes[1].anchor).toEqual({ x: 9, y: 4 });
    expect(p.nodes.every((n) => n.in === undefined && n.out === undefined)).toBe(true);
  });
});
```

Also add a barrel test in the existing engine index test (so the public surface is guarded):

```ts
// src/engine/index.test.ts — add to the existing import-surface assertions
it('re-exports primitive generators', async () => {
  const mod = await import('./index');
  expect(typeof mod.polygonPath).toBe('function');
  expect(typeof mod.starPath).toBe('function');
  expect(typeof mod.linePath).toBe('function');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine/primitives.test.ts src/engine/index.test.ts`
Expected: FAIL — `linePath` not defined; barrel does not export the generators.

- [ ] **Step 3: Write minimal implementation**

Append to `src/engine/primitives.ts`:

```ts
export function linePath(p0: PathPoint, p1: PathPoint): PathData {
  return { nodes: [{ anchor: { ...p0 } }, { anchor: { ...p1 } }], closed: false };
}
```

Add to `src/engine/index.ts` (alongside the other `export * from './...'` lines, keep them grouped/ordered as the file does):

```ts
export * from './primitives';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/engine/primitives.test.ts src/engine/index.test.ts`
Expected: PASS (9 primitives tests + barrel test).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: typecheck clean, lint clean, all unit tests green.

- [ ] **Step 6: Commit**

```bash
git add src/engine/primitives.ts src/engine/primitives.test.ts src/engine/index.ts src/engine/index.test.ts
git commit -m "feat(primitives): linePath generator + barrel export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (engine plan vs spec)

- Spec §5 generators (`polygonPath`/`starPath`/`linePath`) — Tasks 1/2/3. ✅
- First-vertex-up convention, rotation, clamps (sides ≥ 3, points ≥ 2) — covered in tests. ✅
- Returns corner-node `PathData`; star takes **absolute** inner radius (UI owns the ratio, spec §5/§6) — Task 2 signature. ✅
- No render-seam / migration / version change — engine-only module, no edits outside `primitives.ts` + barrel. ✅
- Pure, deterministic, no `-0` — Global Constraints + `vertex` helper. ✅

No gaps. UI consumption is the sibling plan `...-slice6-primitives-ui.md`.
