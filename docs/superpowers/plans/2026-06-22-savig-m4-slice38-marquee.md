# Slice 38 — M4 Marquee (rubber-band) selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag on the empty Select-tool background to draw a rubber-band; on release, select objects whose AABB intersects it (Shift = add). Background CLICK still deselects.

**Architecture:** A pure `aabbIntersect`; a Stage marquee drag (background-only) that renders a dashed rect and selects hits via `objectAABB` on release. Editor-only.

**Tech Stack:** TS, React + RTL, Playwright.

## Global Constraints

- Editor-only: NO engine/export/runtime/persistence change (v4).
- Marquee starts ONLY on the background handler (objects `stopPropagation`); middle-button pan + draw tools unaffected.
- Background click (no move) preserves today's deselect.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Pure `aabbIntersect`

**Files:**
- Modify: `src/ui/components/Stage/snapping.ts`
- Test: `src/ui/components/Stage/snapping.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `snapping.test.ts`:
```ts
import { aabbIntersect, type AABB } from './snapping'; // add aabbIntersect to the import

describe('aabbIntersect', () => {
  const a: AABB = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  it('overlapping boxes intersect', () => {
    expect(aabbIntersect(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true);
  });
  it('disjoint boxes do not intersect', () => {
    expect(aabbIntersect(a, { minX: 20, minY: 0, maxX: 30, maxY: 10 })).toBe(false);
    expect(aabbIntersect(a, { minX: 0, minY: 20, maxX: 10, maxY: 30 })).toBe(false);
  });
  it('edge-touching counts as intersecting', () => {
    expect(aabbIntersect(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(true);
  });
  it('a box fully inside another intersects', () => {
    expect(aabbIntersect(a, { minX: 2, minY: 2, maxX: 8, maxY: 8 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm vitest run src/ui/components/Stage/snapping.test.ts` → FAIL (undefined).

- [ ] **Step 3: Implement** — add to `snapping.ts`:
```ts
// AABB overlap (touch counts). Used by marquee selection (slice 38).
export function aabbIntersect(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run src/ui/components/Stage/snapping.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/ui/components/Stage/snapping.ts src/ui/components/Stage/snapping.test.ts
git commit -m "feat(slice38): pure aabbIntersect (AABB overlap, touch counts)"
```

---

### Task 2: Stage marquee drag + overlay

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

- [ ] **Step 1: Refs/state + import** — import `aabbIntersect`. Add:
```ts
const marqueeRef = useRef<{ start: { x: number; y: number }; additive: boolean; moved: boolean } | null>(null);
const [marquee, setMarquee] = useState<AABB | null>(null);
```

- [ ] **Step 2: onBackgroundPointerDown** — replace the `if (s.activeTool === 'select') selectObject(null);` line with a marquee start:
```ts
if (s.activeTool === 'select') {
  if (e.button !== 0) return;
  const start = clientToLocal(e.clientX, e.clientY);
  if (!start) { selectObject(null); return; }
  marqueeRef.current = { start, additive: e.shiftKey, moved: false };
}
```

- [ ] **Step 3: onMove marquee branch** — near the other drag handlers in the window `onMove` (e.g. after the pan branch), add:
```ts
const mq = marqueeRef.current;
if (mq) {
  const cur = clientToLocal(e.clientX, e.clientY);
  if (!cur) return;
  mq.moved = true;
  setMarquee({ minX: Math.min(mq.start.x, cur.x), minY: Math.min(mq.start.y, cur.y), maxX: Math.max(mq.start.x, cur.x), maxY: Math.max(mq.start.y, cur.y) });
  return;
}
```
(Place it where it won't shadow object/handle drags — those refs are checked first and return; the marquee only runs when no object/handle/pan drag is active. Putting it right after the `panRef` branch is fine since marquee and pan are mutually exclusive.)

- [ ] **Step 4: onUp marquee branch** — at the start of the `onUp` move-drag section (before the `dragRef` handling, or as its own branch):
```ts
const mq = marqueeRef.current;
if (mq) {
  marqueeRef.current = null;
  const rect = marquee;
  setMarquee(null);
  if (mq.moved && rect) {
    const proj = useEditor.getState().history.present;
    const hits = proj.objects
      .filter((o) => !o.hidden && !o.locked)
      .filter((o) => { const a = objectAABB(o, assetsById.get(o.assetId), useEditor.getState().time); return a ? aabbIntersect(rect, a) : false; })
      .map((o) => o.id);
    if (mq.additive) {
      const cur = useEditor.getState().selectedObjectIds;
      useEditor.getState().selectObjects([...cur, ...hits.filter((id) => !cur.includes(id))]);
    } else {
      useEditor.getState().selectObjects(hits);
    }
  } else if (!mq.additive) {
    useEditor.getState().selectObject(null); // a plain background click deselects
  }
  return;
}
```
(`selectObjects([])` clears the selection, so a plain marquee that hits nothing = deselect — fine.)

- [ ] **Step 5: Render the marquee** — in the pan/zoom content `<g>` (near the selection outlines), add:
```tsx
{marquee && (
  <rect
    data-testid="marquee"
    x={marquee.minX}
    y={marquee.minY}
    width={marquee.maxX - marquee.minX}
    height={marquee.maxY - marquee.minY}
    fill="var(--color-accent)"
    fillOpacity={0.08}
    stroke="var(--color-accent)"
    strokeWidth={1 / zoom}
    strokeDasharray={`${3 / zoom} ${3 / zoom}`}
    pointerEvents="none"
  />
)}
```

- [ ] **Step 6: Stage tests** — append to `Stage.test.tsx` (reuse `stubIdentityCTM`; the SVG `onPointerDown={onBackgroundPointerDown}` fires when the event target is the SVG/background — fire `pointerDown` on the `<svg>` element or the stage container):
```ts
it('marquee-dragging the background selects intersecting objects', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 }); // AABB 0..40
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 200, y: 0, width: 40, height: 40 }); // AABB 200..240
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObject(null);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  const { container } = render(<Stage nodes={nodes} />);
  const svg = container.querySelector('svg')!;
  // a marquee from (-10,-10) to (50,50) covers only A.
  fireEvent.pointerDown(svg, { clientX: -10, clientY: -10, button: 0 });
  fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
  expect(screen.getByTestId('marquee')).toBeInTheDocument();
  fireEvent.pointerUp(window, { clientX: 50, clientY: 50 });
  expect(useEditor.getState().selectedObjectIds).toEqual([a]);
  expect(useEditor.getState().selectedObjectIds).not.toContain(b);
  expect(screen.queryByTestId('marquee')).toBeNull(); // cleared on release
});

it('a background click (no drag) deselects', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  const { container } = render(<Stage nodes={nodes} />);
  const svg = container.querySelector('svg')!;
  fireEvent.pointerDown(svg, { clientX: 5, clientY: 5, button: 0 });
  fireEvent.pointerUp(window, { clientX: 5, clientY: 5 }); // no move
  expect(useEditor.getState().selectedObjectIds).toEqual([]);
});
```
(If `stubIdentityCTM` makes `clientToLocal` = client coords, the marquee rect equals the client rect — pin the coords so the AABB math matches the objects' positions.)

- [ ] **Step 7: Commit**
```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice38): marquee drag on the Stage background selects intersecting objects"
```

---

### Task 3: e2e + full gate

- [ ] **Step 1: e2e** — `e2e/marquee.spec.ts`: draw two rects; drag a marquee on the empty Stage that encloses both (start above-left of both, end below-right); assert two `selection-outline-*` elements; press Delete → `[data-savig-object]` count 0. Avoid starting the drag on an object (pick an empty corner).

- [ ] **Step 2: Run e2e** — `pnpm exec playwright test e2e/marquee.spec.ts` → PASS.

- [ ] **Step 3: Full gate + commit**
```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add -A
git commit -m "test(slice38): marquee e2e (drag-select two rects, bulk delete)"
```

---

## Self-Review (post-write)

- **Spec coverage:** §3 hit test → T1; §5 Stage → T2; e2e → T3.
- **Type consistency:** `aabbIntersect(a,b)`, `marqueeRef`/`marquee` (AABB), `selectObjects` (union for additive) consistent.
- **No placeholders:** T1 full helper + vectors; T2 references the existing background/drag handlers and the `objectAABB`/`assetsById` already in scope; tests specify coords.
- **Click vs drag:** `moved` flag set only on `onMove`; a no-move background click → deselect (plain) / no-op (shift).
- **No conflict with object drags:** marquee is background-only; object pointer-downs stopPropagation.
