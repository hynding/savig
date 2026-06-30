# M5 Slice 8b-4 — Scene Transitions (crossfade + dip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add overlap-based scene transitions — **crossfade** (dissolve) and **dip-to-color** (e.g. fade through black) — to the multi-scene timeline: engine overlap accounting, dual-scene compute, runtime rendering (crossfade opacity ramp + dip overlay rect), and an editor scene-strip transition picker. Cut stays the default; single-scene and cut-only projects stay byte-identical.

**Architecture:** A transition lives on the **incoming** scene (`Scene.transitionIn`, already typed). It *overlaps* the previous scene's tail: the incoming scene's segment starts `overlap` seconds before the outgoing scene ends, so both render during `[start_incoming, end_outgoing]`. The overlap is one helper (`transitionOverlap`) threaded through `resolveTimeline`/`computeProjectDurationMulti`/`sceneAtTime`. Rendering is **pure runtime DOM mutation** (no export markup change): crossfade ramps the incoming `<g data-savig-scene>` opacity; dip drives a full-frame overlay `<rect>` the runtime creates lazily. Because the headless raster shares `applyProjectFrame`, `render_gif`/`render_frame`/export-player all get transitions.

**Tech Stack:** TypeScript (strict), Vitest (unit, jsdom for DOM), Playwright (e2e), esbuild (runtime bundle via `scripts/build-runtime.mjs`), pnpm.

## Global Constraints

- **Absent / cut = byte-identical parity.** A single-scene project, and a multi-scene project whose every `transitionIn` is absent or `{kind:'cut'}`, must lay out, compute, render, and export exactly as before. Overlap is 0 for cut ⇒ `resolveTimeline` spans stay contiguous ⇒ all downstream is unchanged. Full prior suite green. Baseline after 8b-5: **1696 unit + 108 e2e** on `main`.
- **Transition lives on the INCOMING scene.** `scenes[i].transitionIn` describes the transition from `scenes[i-1]` into `scenes[i]`. `transitionIn` on `scenes[0]` has no previous scene ⇒ **ignored** (no overlap, no outgoing). `validateProject` already warns on it.
- **Overlap clamp:** `overlap = clamp(transition.duration, 0, min(prevScene.duration, scene.duration))` for `crossfade`/`dip`; `0` for `cut`/absent. A transition never consumes more than the shorter adjacent scene.
- **No export markup change.** `renderProjectDocument` is unchanged; `renderDocument.test.ts` goldens must stay frozen. Transitions are applied imperatively by `applyProjectFrame` (runtime + headless raster). The dip overlay `<rect>` is created by the runtime, not emitted by export.
- **One transition active at a time** (v1): transitions don't overlap each other (the clamp + per-scene-pair model guarantees a transition only spans one scene boundary). A single shared dip overlay rect suffices.
- **Editor stays per-scene-local** (8b-3 decision): 8b-4 does NOT add an in-editor master-timeline preview. The transition picker only sets data; transitions are previewed via export / `render_gif` / `render_frame` / the exported player. Do NOT touch `selectEditDuration`/`seek`/`usePlayback`/Stage time model.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm e2e`. Regenerate the runtime bundle with `node scripts/build-runtime.mjs` (or `pnpm build:runtime`) as the gated last step of Task 3. Commit after each task.

---

## File Structure

- `src/engine/scenes.ts` — `transitionOverlap` helper; `resolveTimeline` overlap-aware starts; `computeProjectDurationMulti` = last span end (incl. audio); `sceneAtTime` returns `outgoing` + `progress` during overlap, picks the incoming scene as primary.
- `src/runtime/frame.ts` — `computeFrame` appends the outgoing scene's items during a transition; `applyProjectFrame` shows both groups, ramps crossfade opacity / drives the dip overlay, applies both scene cameras.
- `src/runtime/runtimeSource.generated.ts` — regenerated bundle (Task 3, gated).
- `src/ui/store/slices/scenesSlice.ts` + `src/ui/store/store-internals.ts` — `setSceneTransition` editor action.
- `src/ui/components/SceneStrip/SceneStrip.tsx` (+ `.module.css`) — per-scene transition picker.
- Tests: `src/engine/scenes.test.ts`, `src/runtime/frame.test.ts`, `src/ui/store/scenes.test.ts`, `src/ui/components/SceneStrip/SceneStrip.test.tsx`, `e2e/` (crossfade export e2e).

---

## Task 1: Engine — transition overlap timeline

**Files:**
- Modify: `src/engine/scenes.ts` (`resolveTimeline`, `computeProjectDurationMulti`, `sceneAtTime`; add `transitionOverlap`)
- Test: `src/engine/scenes.test.ts`

**Interfaces:**
- Produces: `transitionOverlap(scene: Scene, prevScene: Scene): number` (exported for reuse/testing). `resolveTimeline`/`sceneAtTime`/`computeProjectDurationMulti` keep their signatures; `sceneAtTime` now populates `SceneSample.outgoing` during a transition.

- [ ] **Step 1: Write the failing tests.** In `src/engine/scenes.test.ts` add a `describe('transitions (8b-4)')`:

```ts
import { resolveTimeline, sceneAtTime, computeProjectDurationMulti } from './scenes';
import { createProject, createSceneObject } from '.';
import type { Scene } from './types';

function multi(scenes: Scene[]) {
  return { ...createProject(), objects: [], camera: undefined, scenes };
}
const sc = (id: string, duration: number, transitionIn?: Scene['transitionIn']): Scene =>
  ({ id, name: id, objects: [], duration, ...(transitionIn ? { transitionIn } : {}) });

describe('transitions (8b-4)', () => {
  it('crossfade overlaps the previous scene: starts d before it ends', () => {
    const p = multi([sc('a', 2), sc('b', 3, { kind: 'crossfade', duration: 1 })]);
    const spans = resolveTimeline(p);
    expect(spans[0]).toMatchObject({ start: 0, end: 2 });
    expect(spans[1].start).toBe(1);          // 2 - overlap(1)
    expect(spans[1].end).toBe(4);            // 1 + duration(3)
    expect(computeProjectDurationMulti(p)).toBe(4); // 2+3 - 1 overlap
  });

  it('overlap clamps to the shorter adjacent scene', () => {
    const p = multi([sc('a', 1), sc('b', 5, { kind: 'dip', duration: 4, color: '#000' })]);
    expect(resolveTimeline(p)[1].start).toBe(0); // overlap clamped to min(1,5)=1 → start 1-1=0
    expect(computeProjectDurationMulti(p)).toBe(5);
  });

  it('cut / scenes[0].transitionIn → no overlap (parity)', () => {
    const p = multi([sc('a', 2, { kind: 'crossfade', duration: 1 }), sc('b', 3)]); // transitionIn on [0] ignored
    expect(resolveTimeline(p).map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 5]]);
    expect(computeProjectDurationMulti(p)).toBe(5);
  });

  it('sceneAtTime returns outgoing with progress during the overlap window', () => {
    const p = multi([sc('a', 2), sc('b', 3, { kind: 'crossfade', duration: 1 })]); // overlap [1,2]
    const mid = sceneAtTime(p, 1.5);
    expect(mid.primary.scene.id).toBe('b');          // incoming is primary mid-transition
    expect(mid.primary.localTime).toBeCloseTo(0.5);  // 1.5 - start_b(1)
    expect(mid.outgoing!.scene.id).toBe('a');
    expect(mid.outgoing!.localTime).toBeCloseTo(1.5); // 1.5 - start_a(0)
    expect(mid.outgoing!.progress).toBeCloseTo(0.5);  // (1.5 - 1) / 1
  });

  it('sceneAtTime: before & after the overlap there is no outgoing', () => {
    const p = multi([sc('a', 2), sc('b', 3, { kind: 'crossfade', duration: 1 })]);
    expect(sceneAtTime(p, 0.5).outgoing).toBeUndefined();        // pure scene a
    expect(sceneAtTime(p, 0.5).primary.scene.id).toBe('a');
    expect(sceneAtTime(p, 3).outgoing).toBeUndefined();          // pure scene b (past overlap)
    expect(sceneAtTime(p, 3).primary.scene.id).toBe('b');
  });
});
```

- [ ] **Step 2: Run, verify fail.** Run: `pnpm test scenes` (engine) — Expected: FAIL (cut-only: no overlap, no outgoing).

- [ ] **Step 3: Implement the overlap math in `src/engine/scenes.ts`.** Add the helper and rewrite the three functions:

```ts
/** Seconds the transition INTO `scene` overlaps `prevScene`'s tail. `cut`/absent ⇒ 0. Clamped so a
 *  transition never consumes more than the shorter adjacent scene. */
export function transitionOverlap(scene: Scene, prevScene: Scene): number {
  const t = scene.transitionIn;
  if (!t || t.kind === 'cut') return 0;
  return Math.max(0, Math.min(t.duration, prevScene.duration, scene.duration));
}

export function resolveTimeline(project: Project): SceneSpan[] {
  const scenes = projectScenes(project);
  const spans: SceneSpan[] = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const overlap = index > 0 ? transitionOverlap(scene, scenes[index - 1]) : 0;
    const start = cursor - overlap;            // pull the incoming scene back over the prev tail
    const end = start + scene.duration;
    spans.push({ scene, index, start, end });
    cursor = end;
  });
  return spans;
}

/** Master length = the last scene's end (overlaps already folded into the cumulative starts) vs the
 *  furthest audio tail. Single-scene ⇒ today's value via the dispatcher. */
export function computeProjectDurationMulti(project: Project): number {
  const spans = resolveTimeline(project);
  let max = spans.length ? spans[spans.length - 1].end : 0;
  for (const clip of project.audioClips) {
    const end = clip.startTime + (clip.outPoint - clip.inPoint);
    if (end > max) max = end;
  }
  return max;
}

export function sceneAtTime(project: Project, t: number): SceneSample {
  const spans = resolveTimeline(project);
  if (spans.length === 0) {
    return { primary: { scene: { id: ROOT_SCENE_ID, name: 'Scene 1', objects: [], duration: 0 }, localTime: 0 } };
  }
  // Primary = the LAST span whose start <= t (the INCOMING scene wins mid-overlap), clamped to the
  // last span when t is past the end. For cut-only (contiguous spans) this equals the old
  // "first span with t < end" rule at every point incl. boundaries (boundary belongs to next scene).
  let pi = 0;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].start <= t) pi = i;
    else break;
  }
  const primarySpan = spans[pi];
  const localTime = Math.min(Math.max(0, t - primarySpan.start), primarySpan.scene.duration);
  const sample: SceneSample = { primary: { scene: primarySpan.scene, localTime } };
  // Mid-transition? The overlap window for the incoming scene is [start, start + overlap].
  if (pi > 0) {
    const overlap = transitionOverlap(primarySpan.scene, spans[pi - 1].scene);
    if (overlap > 0 && t < primarySpan.start + overlap) {
      const prev = spans[pi - 1];
      sample.outgoing = {
        scene: prev.scene,
        localTime: Math.min(Math.max(0, t - prev.start), prev.scene.duration),
        progress: (t - primarySpan.start) / overlap, // 0 at overlap start → 1 at overlap end
      };
    }
  }
  return sample;
}
```

  Keep the existing `ROOT_SCENE_ID`/`projectScenes`/`promoteToMultiScene`/`demoteToSingleScene` untouched. (`SceneSpan`/`SceneSample` interfaces already have the right shape.)

- [ ] **Step 4: Run, verify pass + parity.** Run: `pnpm test scenes` — Expected: PASS. Run `pnpm test` — Expected: 1696 still green. The existing cut-only `sceneAtTime`/`resolveTimeline` tests are the parity proof (overlap 0 → identical layout + the boundary rule preserved).

- [ ] **Step 5: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/engine/scenes.ts src/engine/scenes.test.ts
git commit -m "feat(8b-4): transition overlap timeline (resolveTimeline/sceneAtTime.outgoing/duration)"
```

---

## Task 2: Compute — dual-scene `computeFrame`

**Files:**
- Modify: `src/runtime/frame.ts` (`computeFrame`)
- Test: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `sceneAtTime.outgoing` (Task 1). `computeFrame` keeps its signature; during a transition it returns the incoming scene's items **plus** the outgoing scene's items (each scene-id-prefixed).

- [ ] **Step 1: Write the failing test.** In `src/runtime/frame.test.ts`:

```ts
it('computeFrame includes BOTH scenes prefixed items during a transition', () => {
  const a = createSceneObject('asset', { id: 'oa' });
  const b = createSceneObject('asset', { id: 'ob' });
  const project = { ...createProject(), assets: [/* a vector asset 'asset' */], objects: [], camera: undefined,
    scenes: [
      { id: 'sa', name: 'A', objects: [a], duration: 2 },
      { id: 'sb', name: 'B', objects: [b], duration: 3, transitionIn: { kind: 'crossfade', duration: 1 } },
    ] };
  const items = computeFrame(project, 1.5); // mid-overlap [1,2]
  const ids = items.map((it) => it.objectId);
  expect(ids).toContain('sb:ob'); // incoming (primary)
  expect(ids).toContain('sa:oa'); // outgoing
});

it('computeFrame outside a transition returns only the active scene (parity)', () => {
  // same project; at t=0.5 → only sa:oa; at t=2.5 → only sb:ob
});
```

(Use the same asset-construction the existing `frame.test.ts` multi-scene tests use; don't invent one.)

- [ ] **Step 2: Run, verify fail.** Run: `pnpm test frame` — Expected: FAIL (only primary items returned).

- [ ] **Step 3: Implement.** In `computeFrame`:

```ts
export function computeFrame(project: Project, time: number): FrameItem[] {
  if (!project.scenes) return computeFrameForScene(project, time, null);
  const { primary, outgoing } = sceneAtTime(project, time);
  const view = (scene: { objects: Project['objects'] }): Project => ({ ...project, objects: scene.objects, scenes: undefined });
  const items = computeFrameForScene(view(primary.scene), primary.localTime, primary.scene.id);
  if (outgoing) items.push(...computeFrameForScene(view(outgoing.scene), outgoing.localTime, outgoing.scene.id));
  return items;
}
```

  (Transition opacity is NOT applied to frame items — the runtime ramps the whole scene group's opacity in Task 3. The frame just carries both scenes' fresh per-object state so both groups paint correctly.)

- [ ] **Step 4: Run, verify pass + parity.** Run: `pnpm test frame` — Expected: PASS. Run `pnpm test` — Expected: green (no-transition + single-scene paths unchanged: `outgoing` undefined ⇒ identical to before).

- [ ] **Step 5: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/runtime/frame.ts src/runtime/frame.test.ts
git commit -m "feat(8b-4): computeFrame renders the outgoing scene during a transition"
```

---

## Task 3: Runtime — crossfade opacity + dip overlay + bundle regen

**Files:**
- Modify: `src/runtime/frame.ts` (`applyProjectFrame`; add small helpers)
- Modify: `src/runtime/runtimeSource.generated.ts` (regenerated — gated last step)
- Test: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `sceneAtTime` (Task 1), `computeFrame` (Task 2), `fmt`, `computeSceneCameraTransform`. `applyProjectFrame` keeps its signature; multi-scene now handles transitions.

- [ ] **Step 1: Write the failing tests (jsdom).** In `src/runtime/frame.test.ts`, build a 2-scene SVG matching the export structure (`<svg><g data-savig-scene="sa">…</g><g data-savig-scene="sb" style="display:none">…</g></svg>`) and a node map, then:

```ts
it('crossfade mid-transition: both groups visible, incoming opacity = progress', () => {
  // project: sa(2), sb(3, crossfade 1); overlap [1,2]; at t=1.5 progress 0.5
  applyProjectFrame(svg, nodes, project, 1.5);
  const ga = svg.querySelector('[data-savig-scene="sa"]') as SVGGElement;
  const gb = svg.querySelector('[data-savig-scene="sb"]') as SVGGElement;
  expect(ga.style.display).not.toBe('none');         // outgoing visible
  expect(gb.style.display).not.toBe('none');          // incoming visible
  expect(Number(gb.style.opacity)).toBeCloseTo(0.5);  // incoming fades in
  expect(ga.style.opacity === '' || Number(ga.style.opacity) === 1).toBe(true); // outgoing full
});

it('after the transition only the incoming group is visible, opacity reset', () => {
  applyProjectFrame(svg, nodes, project, 2.5);
  expect((svg.querySelector('[data-savig-scene="sa"]') as SVGGElement).style.display).toBe('none');
  const gb = svg.querySelector('[data-savig-scene="sb"]') as SVGGElement;
  expect(gb.style.display).not.toBe('none');
  expect(gb.style.opacity === '' || Number(gb.style.opacity) === 1).toBe(true); // ramp cleared
});

it('dip-to-color: a full-frame overlay rect ramps 0→1→0 with the dip color', () => {
  // project: sa(2), sb(3, dip 1 #ff0000); overlap [1,2]
  applyProjectFrame(svg, nodes, project, 1.5);         // progress 0.5 → overlay peak
  const overlay = svg.querySelector('[data-savig-dip]') as SVGRectElement;
  expect(overlay).toBeTruthy();                        // runtime created it
  expect(overlay.getAttribute('fill')).toBe('#ff0000');
  expect(Number(overlay.getAttribute('opacity'))).toBeCloseTo(1); // triangle peak at 0.5
  applyProjectFrame(svg, nodes, project, 2.5);         // past transition → overlay hidden
  expect((svg.querySelector('[data-savig-dip]') as SVGRectElement).style.display).toBe('none');
});

it('cut multi-scene + single-scene: unchanged (parity)', () => {
  // cut project: only active group visible, no overlay, no opacity ramp (as before 8b-4)
});
```

- [ ] **Step 2: Run, verify fail.** Run: `pnpm test frame` — Expected: FAIL.

- [ ] **Step 3: Implement `applyProjectFrame` + helpers.** Replace the multi-scene tail of `applyProjectFrame`:

```ts
const SVG_NS_RT = 'http://www.w3.org/2000/svg';

function setGroupState(g: Element, display: boolean, opacity: number | null): void {
  const style = (g as unknown as { style: CSSStyleDeclaration }).style;
  style.display = display ? '' : 'none';
  style.opacity = opacity === null ? '' : String(opacity);
}

// Apply scene `scene`'s camera at `localTime` to the camera group inside its scene group.
function applySceneGroupCamera(root: ParentNode, project: Project, sceneId: string, camera: import('../engine').Camera | undefined, localTime: number): void {
  const group = root.querySelector(`[data-savig-scene="${CSS.escape(sceneId)}"]`);
  const camEl = group ? group.querySelector('[data-savig-camera]') : null;
  if (!camEl) return;
  const t = computeSceneCameraTransform(camera, project.meta.width, project.meta.height, localTime);
  if (t !== null) camEl.setAttribute('transform', t);
}

// The shared full-frame dip overlay rect (created lazily, top z). null when root has no element host.
function ensureDipOverlay(root: ParentNode, project: Project): Element | null {
  const existing = root.querySelector('[data-savig-dip]');
  if (existing) return existing;
  const host = (root as Element).ownerDocument ? (root as Element) : null;
  const doc = (root as Element).ownerDocument ?? null;
  if (!doc || !host) return null;
  const rect = doc.createElementNS(SVG_NS_RT, 'rect');
  rect.setAttribute('data-savig-dip', '');
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width', fmt(project.meta.width));
  rect.setAttribute('height', fmt(project.meta.height));
  rect.setAttribute('opacity', '0');
  (rect as unknown as { style: CSSStyleDeclaration }).style.display = 'none';
  host.appendChild(rect); // last child ⇒ top z
  return rect;
}

export function applyProjectFrame(root: ParentNode, nodes: Map<string, Element>, project: Project, time: number): void {
  applyFrameToNodes(nodes, computeFrame(project, time));
  if (!project.scenes) {
    applyCamera(root, project, time);
    return;
  }
  const { primary, outgoing } = sceneAtTime(project, time);
  const overlay = root.querySelector('[data-savig-dip]'); // may be null until first dip
  const transition = outgoing ? primary.scene.transitionIn : undefined;
  const dip = transition && transition.kind === 'dip' ? transition : null;
  const crossfade = transition && transition.kind === 'crossfade';

  // Decide visibility + opacity per scene group.
  const showOutgoingId = outgoing ? outgoing.scene.id : null;
  let primaryVisible = true;
  let primaryOpacity: number | null = null;
  let outgoingVisible = !!outgoing;
  let outgoingOpacity: number | null = null;

  if (outgoing && crossfade) {
    primaryOpacity = outgoing.progress; // incoming fades in 0→1
    outgoingOpacity = null;             // outgoing stays full
  } else if (outgoing && dip) {
    // dip: show outgoing (first half) / incoming (second half); overlay covers the swap.
    const second = outgoing.progress >= 0.5;
    primaryVisible = second;
    outgoingVisible = !second;
  }

  root.querySelectorAll('[data-savig-scene]').forEach((g) => {
    const id = g.getAttribute('data-savig-scene');
    if (id === primary.scene.id) setGroupState(g, primaryVisible, primaryOpacity);
    else if (id === showOutgoingId) setGroupState(g, outgoingVisible, outgoingOpacity);
    else setGroupState(g, false, null);
  });

  applySceneGroupCamera(root, project, primary.scene.id, primary.scene.camera, primary.localTime);
  if (outgoing) applySceneGroupCamera(root, project, outgoing.scene.id, outgoing.scene.camera, outgoing.localTime);

  // Dip overlay: a triangle ramp 0→1→0 over the overlap, in the dip color.
  if (outgoing && dip) {
    const rect = overlay ?? ensureDipOverlay(root, project);
    if (rect) {
      const p = outgoing.progress;
      const cover = p < 0.5 ? p / 0.5 : (1 - p) / 0.5;
      rect.setAttribute('fill', dip.color);
      rect.setAttribute('opacity', fmt(cover));
      (rect as unknown as { style: CSSStyleDeclaration }).style.display = '';
    }
  } else if (overlay) {
    (overlay as unknown as { style: CSSStyleDeclaration }).style.display = 'none';
  }
}
```

  Import `fmt`/`computeSceneCameraTransform` already present in frame.ts. Cut-only multi-scene: `outgoing` undefined ⇒ `crossfade`/`dip` false ⇒ primary visible (opacity reset to ''), others hidden, no overlay — equivalent to the pre-8b-4 behavior (display toggle + primary camera). Parity holds.

- [ ] **Step 4: Run, verify pass + parity.** Run: `pnpm test frame` — Expected: PASS. Run `pnpm test` — Expected: green (single-scene + cut multi-scene tests unchanged).

- [ ] **Step 5: Regenerate the runtime bundle (gated).** Now that the runtime logic is green, regenerate the single generated artifact:

```bash
node scripts/build-runtime.mjs   # or: pnpm build:runtime
git diff --stat src/runtime/runtimeSource.generated.ts   # expect a size bump only
```

  Confirm the diff is the bundled `applyProjectFrame`/`sceneAtTime` changes (size grows; no unrelated churn).

- [ ] **Step 6: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/runtime/frame.ts src/runtime/frame.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "feat(8b-4): runtime transition rendering (crossfade opacity + dip overlay) + bundle regen"
```

---

## Task 4: Editor — `setSceneTransition` action + scene-strip picker

**Files:**
- Modify: `src/ui/store/slices/scenesSlice.ts` (+ `SceneKeys`)
- Modify: `src/ui/store/store-internals.ts` (add the action signature to the `EditorState` actions interface)
- Modify: `src/ui/components/SceneStrip/SceneStrip.tsx` (+ `SceneStrip.module.css`)
- Test: `src/ui/store/scenes.test.ts`, `src/ui/components/SceneStrip/SceneStrip.test.tsx`

**Interfaces:**
- Produces: store action `setSceneTransition(sceneId: string, transition: Transition): void` (delegates to core `setSceneTransition` via `commit`). SceneStrip renders a per-scene transition control (skipped for `scenes[0]`).

- [ ] **Step 1: Write the failing store-action test.** In `src/ui/store/scenes.test.ts`:

```ts
it('setSceneTransition sets the incoming scene transitionIn', () => {
  const e = useEditor.getState();
  e.addScene();                                   // 2 scenes
  const second = useEditor.getState().history.present.scenes![1].id;
  e.setSceneTransition(second, { kind: 'crossfade', duration: 0.5 });
  expect(useEditor.getState().history.present.scenes!.find((s) => s.id === second)!.transitionIn)
    .toEqual({ kind: 'crossfade', duration: 0.5 });
});
```

- [ ] **Step 2: Run, verify fail.** Run: `pnpm test scenes` (store) — Expected: FAIL (`setSceneTransition` not an action).

- [ ] **Step 3: Implement the store action.** In `scenesSlice.ts`: add `'setSceneTransition'` to `SceneKeys`; import the core builder (alias to avoid name clash, e.g. `import { setSceneTransition as coreSetSceneTransition } from '../../../core'` — match how the slice imports other core/engine helpers, or build inline). Implement:

```ts
setSceneTransition(sceneId, transition) {
  const present = get().history.present;
  if (!present.scenes) return;
  get().commit({
    ...present,
    scenes: present.scenes.map((s) => (s.id === sceneId ? { ...s, transitionIn: transition } : s)),
  });
},
```

  (Inline is simplest and avoids a core import in the UI slice; matches the existing `renameScene`/`setSceneDuration` inline style.) Add `setSceneTransition(sceneId: string, transition: Transition): void;` to the actions interface in `store-internals.ts` (import the `Transition` type from `../../engine`).

- [ ] **Step 4: Write the failing SceneStrip picker test.** In `SceneStrip.test.tsx`:

```ts
it('a transition picker on a non-first scene sets the transition', () => {
  useEditor.getState().addScene();
  render(<SceneStrip />);
  const second = useEditor.getState().history.present.scenes![1].id;
  // the second tile has a transition kind <select> labelled "Transition"
  const tile = screen.getByTestId(`scene-${second}`).closest('[role="listitem"]')!;
  fireEvent.change(within(tile as HTMLElement).getByLabelText('Transition'), { target: { value: 'crossfade' } });
  expect(useEditor.getState().history.present.scenes!.find((s) => s.id === second)!.transitionIn)
    .toMatchObject({ kind: 'crossfade' });
});

it('the first scene has no transition picker', () => {
  useEditor.getState().addScene();
  render(<SceneStrip />);
  const first = useEditor.getState().history.present.scenes![0].id;
  const tile = screen.getByTestId(`scene-${first}`).closest('[role="listitem"]')!;
  expect(within(tile as HTMLElement).queryByLabelText('Transition')).toBeNull();
});
```

- [ ] **Step 5: Run, verify fail.** Run: `pnpm test SceneStrip` — Expected: FAIL.

- [ ] **Step 6: Implement the picker in `SceneStrip.tsx`.** For each tile where `isMultiScene && index > 0` (a transition is from the previous scene; `scenes[0]` has none), render a transition control after the duration input:

```tsx
{isMultiScene && index > 0 && (
  <div className={styles.transition}>
    <select
      aria-label="Transition"
      value={scene.transitionIn?.kind ?? 'cut'}
      onChange={(e) => {
        const kind = e.target.value as 'cut' | 'crossfade' | 'dip';
        if (kind === 'cut') setSceneTransition(scene.id, { kind: 'cut' });
        else if (kind === 'crossfade') setSceneTransition(scene.id, { kind: 'crossfade', duration: scene.transitionIn && scene.transitionIn.kind !== 'cut' ? scene.transitionIn.duration : 0.5 });
        else setSceneTransition(scene.id, { kind: 'dip', duration: scene.transitionIn && scene.transitionIn.kind !== 'cut' ? scene.transitionIn.duration : 0.5, color: scene.transitionIn?.kind === 'dip' ? scene.transitionIn.color : '#000000' });
      }}
    >
      <option value="cut">Cut</option>
      <option value="crossfade">Crossfade</option>
      <option value="dip">Dip</option>
    </select>
    {scene.transitionIn && scene.transitionIn.kind !== 'cut' && (
      <input
        type="number" min={0} step={0.1} aria-label="Transition duration"
        value={scene.transitionIn.duration}
        onChange={(e) => {
          const duration = Number(e.target.value);
          const t = scene.transitionIn!;
          setSceneTransition(scene.id, t.kind === 'dip' ? { kind: 'dip', duration, color: t.color } : { kind: 'crossfade', duration });
        }}
      />
    )}
    {scene.transitionIn?.kind === 'dip' && (
      <input
        type="color" aria-label="Transition color" value={scene.transitionIn.color}
        onChange={(e) => setSceneTransition(scene.id, { kind: 'dip', duration: (scene.transitionIn as { duration: number }).duration, color: e.target.value })}
      />
    )}
  </div>
)}
```

  Pull `setSceneTransition` from `useEditor.getState()` alongside the other scene actions at the top of the component. Add a compact `.transition` style to `SceneStrip.module.css` (match the existing token style).

- [ ] **Step 7: Run, verify pass.** Run: `pnpm test scenes SceneStrip` — Expected: PASS. Run `pnpm test` — Expected: green (single-scene SceneStrip tests unaffected — picker only renders for `isMultiScene && index>0`).

- [ ] **Step 8: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/ui/store/slices/scenesSlice.ts src/ui/store/store-internals.ts src/ui/store/scenes.test.ts src/ui/components/SceneStrip
git commit -m "feat(8b-4): editor setSceneTransition action + scene-strip transition picker"
```

---

## Task 5: e2e — author + export a crossfade

**Files:**
- Create or extend: `e2e/scenes-transition.spec.ts` (or extend `e2e/multi-scene-export.spec.ts`)

**Interfaces:**
- Consumes: the full editor + the export/runtime path.

- [ ] **Step 1: Write the e2e.** Mirror `e2e/multi-scene-export.spec.ts` (it already builds a multi-scene project headlessly and checks scene-switch in a real browser). Add a transition case: build a 2-scene project with `scenes[1].transitionIn = { kind: 'crossfade', duration: 1 }` (via the core/DSL path the existing export e2e uses, or via the SceneStrip picker), export, load the exported SVG+runtime in the browser, scrub/seek to a master time inside the overlap window, and assert BOTH `[data-savig-scene]` groups are visible (`display !== 'none'`) and the incoming group's `style.opacity` is between 0 and 1. Scope object queries to the scene groups; do not use a bare `[data-savig-object]` count (logged lesson).

```ts
// sketch — adapt selectors/harness to the existing multi-scene-export.spec.ts
test('exported crossfade shows both scenes mid-transition', async ({ page }) => {
  // ... build 2-scene crossfade project, export, load in page ...
  await page.evaluate((t) => (window as any).savigSeek?.(t), /* master time in overlap */);
  const groups = page.locator('[data-savig-scene]');
  // both visible, incoming opacity in (0,1)
});
```

  If the existing export harness exposes a seek/apply hook, use it; otherwise drive `applyProjectFrame` via the bundled runtime the export embeds (match how `multi-scene-export.spec.ts` advances time).

- [ ] **Step 2: Kill stale vite, run.** Run: `pkill -f vite; pnpm e2e scenes-transition` (or the extended spec) — Expected: PASS.

- [ ] **Step 3: Full e2e — no regressions.** Run: `pnpm e2e` — Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git add e2e/
git commit -m "test(8b-4): e2e — exported crossfade shows both scenes mid-transition"
```

---

## Self-Review Notes (spec §9 coverage)

- **Cut (default):** `transitionOverlap` = 0 ⇒ contiguous spans, no `outgoing` ⇒ byte-identical parity (Task 1).
- **Crossfade:** overlap pulls the incoming scene back; `sceneAtTime` returns `outgoing` + `progress`; `computeFrame` paints both; runtime ramps incoming group opacity 0→1, outgoing stays full (Tasks 1-3).
- **Dip-to-color:** outgoing shown first half / incoming second half; full-frame overlay rect (runtime-created, top z) ramps `0→1→0` in the dip color over the overlap (Task 3).
- **Master-timeline accounting:** `computeProjectDurationMulti` = last span end = Σ duration − Σ overlap; `resolveTimeline` folds overlap into starts (Task 1).
- **Duration clamp:** `min(d, prevScene.duration, thisScene.duration)` in `transitionOverlap` (Task 1).
- **`transitionIn` on `scenes[0]` ignored:** `resolveTimeline`/`sceneAtTime` only consider overlap for `index > 0` (Task 1); validator already warns.
- **No export markup change / goldens frozen:** transitions are runtime DOM mutation; dip rect runtime-created (Task 3). `renderDocument.test.ts` untouched.
- **Headless preview works:** `applyProjectFrame` is shared by `core/render.ts renderFrameSvg` (8b-2d) ⇒ `render_gif`/`render_frame`/`export_svg` show transitions — the preview path for the chosen scope.
- **Editor authoring:** `setSceneTransition` action + scene-strip picker (Task 4). Editor time model untouched (per-scene-local; in-editor master preview deferred by decision).
- **MCP/DSL already cover transition DATA** (8b-5 `set_scene_transition` / `ShortScene.transitionIn`); 8b-4 makes that data RENDER.
