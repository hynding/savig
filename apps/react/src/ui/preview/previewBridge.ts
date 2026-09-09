// M9 interactivity: the editor's one integration point into the shared imperative paint path
// (applyFrame.ts). A module-singleton so `applyFrame` — called from both the RAF playback loop
// and Stage's paused-path repaint effect — can drive the active preview session without those
// call sites needing to know a session exists. `postApply` is a NO-OP when no session is set, so
// normal editing (outside preview) pays zero cost.
import type { InteractiveSession, ObjectOverride, Project } from '@savig/engine';
import { expandOverrides } from '@savig/engine';
import { useEditor } from '../store/store';
import { applyOverridesPass } from './applyOverridesPass';

/** Deterministic seeded PRNG (mulberry32) backing the SessionHost's `random()` built-in — the
 *  editor seeds it from Date.now() (session.ts spec) while tests inject their own seed for
 *  reproducibility. Kept tiny and dependency-free; not cryptographic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let session: InteractiveSession | null = null;

// Reentrancy guard for `postApply` (review fix, Finding 1 — CRITICAL). `tickTo` can
// synchronously run behavior actions (e.g. a `tick` handler) that mutate vars/overrides and
// fire `session.onChange` BEFORE `tickTo` returns — the session clears its own `processing`
// flag in `withProcessing`'s `finally`, which runs BEFORE `notify()`, so a listener that turns
// around and calls `tickTo` again looks like a fresh EXTERNAL call to the session, not a
// re-entrant one. If an `onChange` listener were to call `postApply` again from inside this
// window, `tickTo` would refire unconditionally-while-playing `tick`, which can mutate state
// again, notify again, and recurse forever on the very first playing tick of any tick-driven
// project. The primary fix is that `usePreviewSession`'s `onChange` handler calls
// `repaintOverrides` (below), never `postApply`/`tickTo`, from inside that window — this guard
// is the "belt" for any other caller that might re-enter `postApply` itself.
let inPostApply = false;

export const previewBridge = {
  setSession(s: InteractiveSession | null): void {
    session = s;
  },
  getSession(): InteractiveSession | null {
    return session;
  },
  /** Called from `applyFrame` on every paint. No-op outside preview. Drives the session's clock
   *  (`tickTo`, so scene-identity events fire on every applied frame — spec §5) BEFORE expanding
   *  and applying whatever overrides that produced onto the freshly-painted nodes. Never calls
   *  itself re-entrantly (see `inPostApply` above) — a nested call (which would otherwise refire
   *  `tickTo` as a "fresh" external call) is dropped instead. */
  postApply(nodes: Map<string, SVGGraphicsElement>, project: Project, time: number): void {
    const s = session;
    if (!s || inPostApply) return;
    inPostApply = true;
    try {
      const playing = useEditor.getState().playing;
      s.tickTo(time, playing);
      previewBridge.repaintOverrides(nodes, project);
    } finally {
      inPostApply = false;
    }
  },
  /** Overrides-only repaint — expands + applies the session's CURRENT overrides, with no
   *  `tickTo` call. This is the safe primitive for `session.onChange` (see the reentrancy note
   *  above): the caller is expected to have already repainted the frame's base geometry
   *  (`applyFrameToNodes`/`computeFrame`) first if the transform/opacity attributes might
   *  otherwise still carry a PREVIOUS override's prepend. */
  repaintOverrides(nodes: Map<string, SVGGraphicsElement>, project: Project): void {
    const s = session;
    if (!s) return;
    const expanded: Map<string, ObjectOverride> = expandOverrides(project, s.overrides(), nodes.keys());
    applyOverridesPass(nodes, expanded);
  },
};
