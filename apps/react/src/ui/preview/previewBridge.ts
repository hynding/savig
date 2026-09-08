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

export const previewBridge = {
  setSession(s: InteractiveSession | null): void {
    session = s;
  },
  getSession(): InteractiveSession | null {
    return session;
  },
  /** Called from `applyFrame` on every paint. No-op outside preview. Drives the session's clock
   *  (`tickTo`, so scene-identity events fire on every applied frame — spec §5) BEFORE expanding
   *  and applying whatever overrides that produced onto the freshly-painted nodes. */
  postApply(nodes: Map<string, SVGGraphicsElement>, project: Project, time: number): void {
    const s = session;
    if (!s) return;
    const playing = useEditor.getState().playing;
    s.tickTo(time, playing);
    const expanded: Map<string, ObjectOverride> = expandOverrides(project, s.overrides(), nodes.keys());
    applyOverridesPass(nodes, expanded);
  },
};
