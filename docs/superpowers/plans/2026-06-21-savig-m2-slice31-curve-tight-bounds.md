# Slice 31 — Curve-tight `pathBounds` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pathBounds` returns the visual bounding box of a `PathData` including cubic-bezier extent, not just anchor extent.

**Architecture:** Replace the `pathBounds` body in `src/engine/path.ts` with: include every anchor, plus the per-axis derivative-root extrema of each cubic segment (segment = cubic iff `prev.out || cur.in`, mirroring `pathToD`). Regenerate the runtime bundle. No call-site or data-model change.

**Tech Stack:** Pure TS (`src/engine/`), Vitest. Runtime bundle via `pnpm build:runtime`.

## Global Constraints

- `pathBounds` is reachable from the runtime/export → run `pnpm build:runtime` and commit the regenerated `src/runtime/runtimeSource.generated.ts`.
- Straight-edged paths (no handles) MUST stay byte-identical to anchor-extent bounds.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Curve-tight `pathBounds`

**Files:**
- Modify: `src/engine/path.ts` (`pathBounds` + a cubic-extrema helper)
- Test: `src/engine/path.test.ts`

**Interfaces:**
- Consumes: `PathData`, `PathNode`, the existing `add(anchor, offset)` helper.
- Produces: `pathBounds(path): { x, y, width, height }` — unchanged signature, tighter result.

- [ ] **Step 1: Write the failing tests** — add inside `describe('pathBounds', ...)`:

```ts
  it('extends to a cubic that bulges past its anchors (down)', () => {
    // P0(0,0) C1(0,100) C2(100,100) P3(100,0): y-extremum at t=0.5 -> y=75; x stays [0,100].
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 }, out: { x: 0, y: 100 } },
        { anchor: { x: 100, y: 0 }, in: { x: 0, y: 100 } },
      ],
      closed: false,
    };
    expect(pathBounds(p)).toEqual({ x: 0, y: 0, width: 100, height: 75 });
  });

  it('extends the min for a handle pulling up past the start anchor', () => {
    // Mirror image bulging up: y-extremum -75.
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 }, out: { x: 0, y: -100 } },
        { anchor: { x: 100, y: 0 }, in: { x: 0, y: -100 } },
      ],
      closed: false,
    };
    expect(pathBounds(p)).toEqual({ x: 0, y: -75, width: 100, height: 75 });
  });

  it('includes the curved CLOSING segment of a closed path', () => {
    // Triangle anchors with a curved close from last->first bulging left to x=-? .
    // last(0,100) -> first(0,0) with out/in pulling left: x-extremum < 0.
    // out(-80,0) on last, in(-80,0) on first: d0=-80,d1=0,d2=80 -> a=0,b=160,c=-80 -> t=0.5
    // Bx(0.5) = 3*.25*.5*(-80) + 3*.5*.25*(-80) = -30 + -30 = -60.
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 }, in: { x: -80, y: 0 } },
        { anchor: { x: 100, y: 0 } },
        { anchor: { x: 0, y: 100 }, out: { x: -80, y: 0 } },
      ],
      closed: true,
    };
    const b = pathBounds(p);
    expect(b.x).toBeCloseTo(-60);
    expect(b.y).toBeCloseTo(0);
    expect(b.width).toBeCloseTo(160); // -60 .. 100
    expect(b.height).toBeCloseTo(100);
  });

  it('a straight (L-only) path is identical to the anchor extent', () => {
    const p: PathData = {
      nodes: [{ anchor: { x: 4, y: 6 } }, { anchor: { x: 14, y: 6 } }, { anchor: { x: 14, y: 26 } }],
      closed: true, // straight close, no handles -> no curve contribution
    };
    expect(pathBounds(p)).toEqual({ x: 4, y: 6, width: 10, height: 20 });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/engine/path.test.ts`
Expected: the 3 curved tests FAIL (anchor-extent ignores bulge); the straight test PASSES.

- [ ] **Step 3: Implement** — replace the `pathBounds` function in `src/engine/path.ts`:

```ts
const BOUNDS_EPS = 1e-9;

// Real roots in (0,1) of a*t^2 + b*t + c (endpoints are covered by the anchor pass).
function quadRootsInUnit(a: number, b: number, c: number): number[] {
  const out: number[] = [];
  if (Math.abs(a) < BOUNDS_EPS) {
    if (Math.abs(b) >= BOUNDS_EPS) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return out.filter((t) => t > BOUNDS_EPS && t < 1 - BOUNDS_EPS);
}

// Axis-wise interior extrema parameters of a cubic with control values p0,c1,c2,p3.
function cubicExtremaParams(p0: number, c1: number, c2: number, p3: number): number[] {
  const d0 = c1 - p0;
  const d1 = c2 - c1;
  const d2 = p3 - c2;
  return quadRootsInUnit(d0 - 2 * d1 + d2, 2 * (d1 - d0), d0);
}

function cubicAt(p0: number, c1: number, c2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3;
}

export function pathBounds(path: PathData): { x: number; y: number; width: number; height: number } {
  const { nodes, closed } = path;
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const fold = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const n of nodes) fold(n.anchor.x, n.anchor.y);

  const curve = (prev: PathNode, cur: PathNode) => {
    if (!prev.out && !cur.in) return; // straight segment: endpoints already folded
    const c1 = add(prev.anchor, prev.out);
    const c2 = add(cur.anchor, cur.in);
    for (const t of cubicExtremaParams(prev.anchor.x, c1.x, c2.x, cur.anchor.x)) {
      fold(cubicAt(prev.anchor.x, c1.x, c2.x, cur.anchor.x, t), cubicAt(prev.anchor.y, c1.y, c2.y, cur.anchor.y, t));
    }
    for (const t of cubicExtremaParams(prev.anchor.y, c1.y, c2.y, cur.anchor.y)) {
      fold(cubicAt(prev.anchor.x, c1.x, c2.x, cur.anchor.x, t), cubicAt(prev.anchor.y, c1.y, c2.y, cur.anchor.y, t));
    }
  };
  for (let i = 1; i < nodes.length; i++) curve(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 1) curve(nodes[nodes.length - 1], nodes[0]);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

(Remove the old anchor-only `pathBounds`. Keep `add` as-is.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/engine/path.test.ts`
Expected: PASS (all, incl. the two pre-existing anchor-extent tests).

- [ ] **Step 5: Regenerate the runtime bundle**

Run: `pnpm build:runtime`
Then verify nothing else drifted: `pnpm vitest run` (full engine + runtime parity suite).
Expected: PASS. (If `runtimeSource.generated.ts` changed, that is expected — it inlines `pathBounds`.)

- [ ] **Step 6: Commit**

```bash
git add src/engine/path.ts src/engine/path.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "feat(slice31): curve-tight pathBounds (cubic-bezier extrema)"
```

---

### Task 2: Full gate

- [ ] **Step 1: Run the whole gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all green. The existing pivot/parity e2e proves preview==export still holds with the new bounds.

- [ ] **Step 2: Commit (only if the gate surfaced an incidental fix)**

If a gradient-handle or pivot test asserted an old curved-path bbox and needs updating to the correct value, fix it and commit:

```bash
git add -A
git commit -m "test(slice31): update curved-path bbox expectations to the tight box"
```

Otherwise no commit needed.

---

## Self-Review (post-write)

- **Spec coverage:** §3 math → Task 1 helper; §7 tests → Task 1 Step 1 (down/up bulge, closed curved close, straight regression); §6 parity/bundle → Task 1 Step 5 + Task 2.
- **Type consistency:** `pathBounds` signature unchanged; helpers are file-local; reuses `add`.
- **No placeholders:** test vectors hand-verified — down bulge t=0.5→y=75; up bulge →y=−75; closed curved close x=−60 (width 160); straight path = {4,6,10,20}.
- **Risk:** the only behavior change is curved-path bbox; Task 2 Step 2 anticipates a test that pinned an old curved value (none known, but guarded).
