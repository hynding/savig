// M9 interactivity: mounted ONCE in Stage. Owns the interactive-preview session's whole
// lifecycle — spec §6 ("Editor: preview mode + authoring UI") + §5's SessionHost contract.
//
// On `previewMode` flip to true: builds the editor SessionHost (play/pause/seek route to the
// existing transport intents; `seek` is the store's plain `seek`, which never touches `playing`
// — the host contract's "seek preserves playing state" holds by construction), creates the
// session, publishes it to `previewBridge` (so the shared `applyFrame` paint path drives
// `tickTo` + the override post-pass on every frame — see previewBridge.ts), and wires DOM
// listeners on the Stage SVG root: click/pointerdown/pointerup resolve the event target's
// `data-savig-object` renderId to an authored chain (`resolveAuthoredChain`) and fire the
// session; bubbling pointerover/pointerout diff hover (pointerout only clears — `pointerAt(null)`
// — when the pointer actually leaves the root, matching spec §5's chain-diffing note); keydown/
// keyup drive `fireKey` (auto-repeat ignored; Escape exits preview instead of firing a behavior).
//
// A second, no-dep effect re-applies the current frame + overrides after EVERY React commit
// while `previewMode` (spec §6 "React-commit interplay": a pause/seek commits time to the store
// and React re-renders Stage, which would otherwise clobber textContent/display overrides with
// nothing running to restore them). `session.onChange` re-applies immediately too, so var/
// override changes repaint even while paused — via `reapplyOverridesOnly` (repaints geometry +
// overrides directly, NEVER calls `tickTo`; see the inline note at its definition and
// previewBridge.ts's `inPostApply` guard — `onChange` fires synchronously from inside a
// `tickTo`/`fire*` call, so routing it back through `tickTo` would look like a fresh external
// tick and can recurse forever when a tick/behavior handler mutates state every time). A store
// subscription additionally re-applies on a seek made WHILE PAUSED (a time change that did not
// originate from the RAF playback loop, which already drives `applyFrame` itself every tick).
//
// On flip to false / unmount: listeners removed, `previewBridge.setSession(null)`, `session.
// reset()`, and one plain `applyFrame` restores DOM attributes (display/opacity/transform) —
// text nodes are restored by the React re-render that exiting the mode (and its selection/tool
// state changes) already triggers.
import { useEffect } from 'react';
import type { InteractiveSession, PointerEventKind, Project } from '@savig/engine';
import { createSession, resolveAuthoredChain } from '@savig/engine';
import { applyFrameToNodes, computeFrame } from '@savig/runtime/frame';
import { useEditor } from '../store/store';
import { selectEditProject } from '../store/selectors';
import { applyFrame } from '../playback/applyFrame';
import { previewBridge, mulberry32 } from './previewBridge';

const POINTER_KINDS: readonly PointerEventKind[] = ['click', 'pointerdown', 'pointerup'];

function chainFromTarget(target: EventTarget | null, project: Project): string[] {
  const el = target instanceof Element ? target.closest('[data-savig-object]') : null;
  const renderId = el?.getAttribute('data-savig-object');
  return renderId ? resolveAuthoredChain(project, renderId) : [];
}

export function usePreviewSession(
  getSvgRoot: () => SVGSVGElement | null,
  getNodes: () => Map<string, SVGGraphicsElement>,
): void {
  const previewMode = useEditor((s) => s.previewMode);

  // Session lifecycle: created/torn down exactly on the previewMode flip.
  useEffect(() => {
    if (!previewMode) return;
    const st = () => useEditor.getState();

    const host = {
      play: () => st().setPlaying(true),
      pause: () => st().setPlaying(false),
      seek: (t: number) => st().seek(t),
      now: () => st().time,
      random: mulberry32(Date.now() >>> 0),
      warn: (m: string) => console.warn('[savig preview]', m),
    };
    const session: InteractiveSession = createSession(selectEditProject(st()), host);
    previewBridge.setSession(session);

    const reapply = (): void => {
      const s = st();
      applyFrame(getNodes(), selectEditProject(s), s.time);
    };
    // Review fix (Finding 1 — CRITICAL): `session.onChange` fires SYNCHRONOUSLY from inside a
    // `tickTo`/`fire*` call (the session clears its own re-entrancy flag before `notify()` runs
    // — see previewBridge.ts's `inPostApply` note). Calling the FULL `reapply()` here would run
    // `applyFrame` -> `postApply` -> `tickTo` again, which looks like a fresh EXTERNAL tick to
    // the session; a `tick` handler that mutates state on every invocation (e.g. a counter) would
    // then recurse forever on the very first playing frame. This path repaints geometry +
    // overrides directly and NEVER calls tickTo.
    const reapplyOverridesOnly = (): void => {
      const s = st();
      const proj = selectEditProject(s);
      applyFrameToNodes(getNodes(), computeFrame(proj, s.time));
      previewBridge.repaintOverrides(getNodes(), proj);
    };

    const root = getSvgRoot();

    const firePointerFrom = (kind: PointerEventKind) => (e: Event) => {
      const chain = chainFromTarget(e.target, selectEditProject(st()));
      if (chain.length > 0) session.firePointer(kind, chain);
    };
    const pointerListeners = POINTER_KINDS.map((kind) => [kind, firePointerFrom(kind)] as const);

    const onPointerOver = (e: Event): void => {
      const chain = chainFromTarget(e.target, selectEditProject(st()));
      session.pointerAt(chain.length > 0 ? chain : null);
    };
    // pointerout only matters here for the "left the stage entirely" case — a transition to
    // another element still inside the root is covered by that element's own pointerover.
    const onPointerOut = (e: PointerEvent): void => {
      const related = e.relatedTarget;
      if (root && related instanceof Node && root.contains(related)) return;
      session.pointerAt(null);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      if (e.key === 'Escape') {
        st().exitPreview();
        return;
      }
      session.fireKey('keydown', e.key);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      session.fireKey('keyup', e.key);
    };

    if (root) {
      for (const [kind, listener] of pointerListeners) root.addEventListener(kind, listener);
      root.addEventListener('pointerover', onPointerOver);
      root.addEventListener('pointerout', onPointerOut);
      root.addEventListener('keydown', onKeyDown);
      root.addEventListener('keyup', onKeyUp);
      root.focus();
    }

    const unsubChange = session.onChange(() => reapplyOverridesOnly());
    // Seeks made WHILE PAUSED don't otherwise reach the session (the RAF loop, which already
    // drives applyFrame/tickTo every tick, isn't running) — mirror them in explicitly.
    const unsubTime = useEditor.subscribe((s, prev) => {
      if (s.time !== prev.time && !s.playing) {
        session.tickTo(s.time, s.playing);
        reapply();
      }
    });

    return () => {
      if (root) {
        for (const [kind, listener] of pointerListeners) root.removeEventListener(kind, listener);
        root.removeEventListener('pointerover', onPointerOver);
        root.removeEventListener('pointerout', onPointerOut);
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('keyup', onKeyUp);
      }
      unsubChange();
      unsubTime();
      previewBridge.setSession(null);
      session.reset();
      // Attribute restore (display/opacity/transform); text nodes restore via the React
      // re-render that exiting preview (selection/tool state reset) already triggers.
      const s = st();
      applyFrame(getNodes(), selectEditProject(s), s.time);
    };
  }, [previewMode, getSvgRoot, getNodes]);

  // React-commit re-apply (spec §6): runs after EVERY commit while previewMode, so a paused
  // re-render can't clobber the last-applied overrides with nothing running to restore them.
  useEffect(() => {
    if (!previewMode) return;
    const s = useEditor.getState();
    applyFrame(getNodes(), selectEditProject(s), s.time);
  });
}
