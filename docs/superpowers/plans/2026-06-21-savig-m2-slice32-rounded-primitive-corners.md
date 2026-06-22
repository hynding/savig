# Slice 32 — Rounded polygon / star corners — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A corner-radius tool option for the polygon/star tools that fillets the stamped path's corners with circular-arc cubics.

**Architecture:** Pure `roundCorners(path, radius)` fillet in `engine/primitives.ts`; `polygonPath`/`starPath` apply it when `cornerRadius > 0`. A `primitiveCornerRadius` tool option (store, transient, clamped ≥0) threads through `primitivePathFromDrag` and is surfaced in `PrimitiveOptions`. Baked into the path → no data-model/persistence/runtime change.

**Tech Stack:** TS engine (`src/engine/`), Zustand store, React + RTL, Playwright.

## Global Constraints

- Baked at stamp time → NO persistence/migration (v4) and NO runtime bundle regen (`roundCorners` is never called by the runtime).
- `cornerRadius = 0` MUST be byte-identical to today's sharp primitives.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `roundCorners` fillet + generator params

**Files:**
- Modify: `src/engine/primitives.ts`
- Test: `src/engine/primitives.test.ts`
- Modify: `src/engine/index.ts` (barrel — re-export `roundCorners` if the barrel enumerates primitives; otherwise skip)

**Interfaces:**
- Consumes: `PathData`, `PathPoint`, `PathNode`.
- Produces: `roundCorners(path: PathData, radius: number): PathData`; `polygonPath(cx,cy,radius,sides,rotation?,cornerRadius?)`, `starPath(cx,cy,outerR,innerR,points,rotation?,cornerRadius?)`.

- [ ] **Step 1: Write the failing tests** — append to `primitives.test.ts`:

```ts
import { roundCorners } from './primitives'; // add to the existing import

describe('roundCorners', () => {
  const square: PathData = {
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 100, y: 0 } },
      { anchor: { x: 100, y: 100 } },
      { anchor: { x: 0, y: 100 } },
    ],
    closed: true,
  };

  it('radius 0 returns the sharp path unchanged', () => {
    expect(roundCorners(square, 0)).toEqual(square);
  });

  it('fillets a square corner with circular-arc tangent points and handles', () => {
    const r = 20;
    const h = (4 / 3) * 20 * Math.tan(Math.PI / 8); // 90deg corner -> kappa*R
    const out = roundCorners(square, r);
    expect(out.nodes).toHaveLength(8);
    expect(out.closed).toBe(true);
    // Corner (0,0): prev (0,100) -> A on that edge; next (100,0) -> B on that edge.
    const a = out.nodes[0];
    const b = out.nodes[1];
    expect(a.anchor.x).toBeCloseTo(0);
    expect(a.anchor.y).toBeCloseTo(20);
    expect(a.out!.x).toBeCloseTo(0);
    expect(a.out!.y).toBeCloseTo(-h);
    expect(b.anchor.x).toBeCloseTo(20);
    expect(b.anchor.y).toBeCloseTo(0);
    expect(b.in!.x).toBeCloseTo(-h);
    expect(b.in!.y).toBeCloseTo(0);
  });

  it('clamps an over-large radius to the half-edge (no overlap)', () => {
    const out = roundCorners(square, 1000);
    // t clamped to 50 (half of the 100 edge); A on the (0,0)->(0,100) edge at y=50.
    expect(out.nodes[0].anchor.y).toBeCloseTo(50);
  });
});

describe('polygonPath / starPath cornerRadius', () => {
  it('polygonPath with cornerRadius 0 is byte-identical to the sharp polygon', () => {
    expect(polygonPath(0, 0, 50, 5, 0, 0)).toEqual(polygonPath(0, 0, 50, 5, 0));
  });
  it('polygonPath with cornerRadius > 0 produces handles (a rounded path)', () => {
    const p = polygonPath(0, 0, 50, 5, 0, 8);
    expect(p.nodes).toHaveLength(10); // 2 per corner
    expect(p.nodes.some((n) => n.out || n.in)).toBe(true);
  });
  it('starPath with cornerRadius rounds inner + outer vertices', () => {
    const s = starPath(0, 0, 50, 25, 5, 0, 5);
    expect(s.nodes).toHaveLength(20); // 2 * (2 * points)
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/engine/primitives.test.ts`
Expected: the new tests FAIL (`roundCorners` undefined; cornerRadius param ignored).

- [ ] **Step 3: Implement** — in `primitives.ts`:

```ts
const ROUND_EPS = 1e-9;

function sub(a: PathPoint, b: PathPoint): PathPoint {
  return { x: a.x - b.x, y: a.y - b.y };
}
function len(p: PathPoint): number {
  return Math.hypot(p.x, p.y);
}

// Fillet every vertex of a closed corner-node path with a circular-arc cubic.
export function roundCorners(path: PathData, radius: number): PathData {
  const { nodes, closed } = path;
  if (radius <= 0 || nodes.length < 3) return path;
  const n = nodes.length;
  const out: PathNode[] = [];
  for (let i = 0; i < n; i++) {
    const V = nodes[i].anchor;
    const P = nodes[(i - 1 + n) % n].anchor;
    const N = nodes[(i + 1) % n].anchor;
    const eP = sub(P, V);
    const eN = sub(N, V);
    const lenP = len(eP);
    const lenN = len(eN);
    if (lenP < ROUND_EPS || lenN < ROUND_EPS) {
      out.push({ anchor: { ...V } });
      continue;
    }
    const u = { x: eP.x / lenP, y: eP.y / lenP };
    const w = { x: eN.x / lenN, y: eN.y / lenN };
    const theta = Math.acos(Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y)));
    const t = Math.min(radius / Math.tan(theta / 2), 0.5 * lenP, 0.5 * lenN);
    if (!(t > ROUND_EPS)) {
      out.push({ anchor: { ...V } }); // collinear / degenerate -> keep sharp
      continue;
    }
    const rEff = t * Math.tan(theta / 2);
    const h = (4 / 3) * rEff * Math.tan((Math.PI - theta) / 4);
    out.push({ anchor: { x: V.x + u.x * t, y: V.y + u.y * t }, out: { x: -u.x * h, y: -u.y * h } });
    out.push({ anchor: { x: V.x + w.x * t, y: V.y + w.y * t }, in: { x: -w.x * h, y: -w.y * h } });
  }
  return { nodes: out, closed };
}
```

Then add the `cornerRadius` param to the generators (apply after building the sharp path):

```ts
export function polygonPath(cx, cy, radius, sides, rotation = 0, cornerRadius = 0): PathData {
  // ... existing body builds `path` ...
  return cornerRadius > 0 ? roundCorners({ nodes, closed: true }, cornerRadius) : { nodes, closed: true };
}
// same shape for starPath (cornerRadius after `points` and `rotation`)
```

(Mirror the exact existing signatures; append `cornerRadius = 0` as the last param. Keep `PathNode`/`PathPoint` imports.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/engine/primitives.test.ts`
Expected: PASS (incl. the pre-existing sharp-primitive tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/primitives.ts src/engine/primitives.test.ts src/engine/index.ts
git commit -m "feat(slice32): roundCorners fillet + cornerRadius on polygonPath/starPath"
```

---

### Task 2: Store tool option + draw wiring

**Files:**
- Modify: `src/ui/store/store.ts`
- Modify: `src/ui/components/Stage/drawGeometry.ts`
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/drawGeometry.test.ts`

**Interfaces:**
- Produces: `primitiveCornerRadius: number` + `setPrimitiveCornerRadius(n)` (clamp `≥ 0`); `PrimitiveDrawOpts.cornerRadius`.

- [ ] **Step 1: Write the failing test** — append to `drawGeometry.test.ts`:

```ts
it('primitivePathFromDrag rounds polygon corners when cornerRadius > 0', () => {
  const sharp = primitivePathFromDrag('polygon', { x: 0, y: 0 }, { x: 0, y: 50 }, { polygonSides: 5, starPoints: 5, starInnerRatio: 0.5, cornerRadius: 0 }, 4);
  const round = primitivePathFromDrag('polygon', { x: 0, y: 0 }, { x: 0, y: 50 }, { polygonSides: 5, starPoints: 5, starInnerRatio: 0.5, cornerRadius: 8 }, 4);
  expect(pathToD(sharp!)).not.toContain('C');
  expect(pathToD(round!)).toContain('C'); // rounded -> cubic segments
});
```

(Import `pathToD` from `../../../engine` in the test if not already present.)

- [ ] **Step 2: Run to verify it fails (type error / no cornerRadius)**

Run: `pnpm vitest run src/ui/components/Stage/drawGeometry.test.ts`
Expected: FAIL (TS: `cornerRadius` not on `PrimitiveDrawOpts`).

- [ ] **Step 3: Implement**

In `drawGeometry.ts`: add `cornerRadius: number;` to the opts interface (near `starInnerRatio`); pass it to the generators:
```ts
if (tool === 'polygon') return polygonPath(start.x, start.y, dist, opts.polygonSides, rotation, opts.cornerRadius);
return starPath(start.x, start.y, dist, dist * opts.starInnerRatio, opts.starPoints, rotation, opts.cornerRadius);
```

In `store.ts`: add `primitiveCornerRadius: number;` to the interface (near `starInnerRatio`, line ~140); add `setPrimitiveCornerRadius(n: number): void;` (near line ~229); add `primitiveCornerRadius: 0,` to `TRANSIENT_DEFAULTS` (near line ~264); implement the setter (near line ~1324):
```ts
setPrimitiveCornerRadius(n) {
  set({ primitiveCornerRadius: Math.max(0, n) });
},
```

In `Stage.tsx`: both `primitivePathFromDrag(...)` opts objects (lines ~672 and ~828) add `cornerRadius: <state>.primitiveCornerRadius` (`st` at the first site, `s` at the second — match the local name used there).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/ui/components/Stage/drawGeometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/components/Stage/drawGeometry.ts src/ui/components/Stage/Stage.tsx src/ui/components/Stage/drawGeometry.test.ts
git commit -m "feat(slice32): primitiveCornerRadius tool option threaded into the stamp draw"
```

---

### Task 3: PrimitiveOptions UI + e2e

**Files:**
- Modify: `src/ui/components/Toolbar/PrimitiveOptions.tsx`
- Test: `src/ui/components/Toolbar/PrimitiveOptions.test.tsx`
- Test: `e2e/rounded-polygon.spec.ts` (create)

- [ ] **Step 1: Write the failing UI test** — mirror the existing `starInnerRatio` field test in `PrimitiveOptions.test.tsx`:

```ts
it('shows a corner-radius field for the polygon tool and updates it', () => {
  useEditor.setState({ activeTool: 'polygon' });
  render(<PrimitiveOptions />);
  const field = screen.getByLabelText(/corner radius/i);
  fireEvent.change(field, { target: { value: '12' } });
  expect(useEditor.getState().primitiveCornerRadius).toBe(12);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Toolbar/PrimitiveOptions.test.tsx`
Expected: FAIL (no corner-radius field).

- [ ] **Step 3: Implement** — in `PrimitiveOptions.tsx`, read `primitiveCornerRadius` + `setPrimitiveCornerRadius` (mirror the `starInnerRatio` selectors), and render a "Corner radius" number input for BOTH the polygon and star tool branches (min 0, step 1). Match the existing field markup (label + input) so `getByLabelText(/corner radius/i)` resolves.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/ui/components/Toolbar/PrimitiveOptions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the e2e** — `e2e/rounded-polygon.spec.ts`, modelled on `e2e/star-*`/primitive e2e harness (select the polygon tool, set the corner-radius field > 0, drag to stamp, export, assert the exported path `d` contains `C`):

```ts
import { test, expect } from '@playwright/test';

test('a rounded polygon exports with curved corners', async ({ page }) => {
  // addInitScript to drop the file pickers (see sibling e2e), goto('/').
  // pick Polygon tool, set corner radius field > 0, drag on the Stage to stamp,
  // export, read the exported index.html, assert the <path d="..."> contains 'C'.
});
```

(Model setup/draw/export on an existing primitive e2e such as `e2e/primitives*`/`e2e/star*`. Pin exact selectors to that harness.)

- [ ] **Step 6: Run e2e**

Run: `pnpm exec playwright test e2e/rounded-polygon.spec.ts`
Expected: PASS.

- [ ] **Step 7: Full gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add src/ui/components/Toolbar/PrimitiveOptions.tsx src/ui/components/Toolbar/PrimitiveOptions.test.tsx e2e/rounded-polygon.spec.ts
git commit -m "feat(slice32): corner-radius field in PrimitiveOptions + rounded-polygon e2e"
```

---

## Self-Review (post-write)

- **Spec coverage:** §3 fillet → Task 1; §5 store/draw → Task 2; UI + e2e → Task 3.
- **Type consistency:** `roundCorners(path, radius)`, generator `cornerRadius` last-param, `primitiveCornerRadius`/`setPrimitiveCornerRadius`, `PrimitiveDrawOpts.cornerRadius` — names consistent across tasks.
- **No placeholders:** Task 1 has the full helper + hand-verified square vector (A=(0,20), out=(0,−h), h=(4/3)·20·tan(π/8)≈11.05). Task 3's e2e harness selectors are deferred to the existing primitive e2e (executor reads it) — the assertions are pinned (`d` contains `C`).
- **Risk:** `cornerRadius=0` equivalence is asserted (Task 1) so existing primitives stay byte-identical; curve-tight bounds (S31) already cover the rounded bulge.
