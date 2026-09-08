// M9 interactivity: the one interactive-session seam shared by the editor's preview mode and the
// exported runtime (spec §5). Pure state machine — never touches DOM or WebAudio; all playback
// intents and clock reads go through the injected `SessionHost`.

import { projectScenes, resolveTimeline, sceneAtTime } from '../scenes';
import type { Behavior, BehaviorAction, GlobalEventKind, ObjectOverride, PointerEventKind, Project, SceneObject } from '../types';
import { parse, type ParseResult, type Value } from './parse';
import { evaluate, type EvalEnv } from './evaluate';

/** Injected by the consumer (editor preview / exported runtime). The session never touches DOM
 *  or WebAudio directly — every playback intent and clock read goes through this. `seek(t)`
 *  preserves the current playing state (a running game is never paused by `gotoScene`). */
export interface SessionHost {
  play(): void;
  pause(): void;
  seek(t: number): void;
  /** Master time (seconds), for the `time`/`sceneTime`/`sceneIndex` SavigScript built-ins. */
  now(): number;
  /** Seeded in tests; backs the `random()` built-in. */
  random(): number;
  warn(message: string): void;
}

export interface InteractiveSession {
  /** chain = authored ancestor ids, leaf-first (see `resolveAuthoredChain`). */
  firePointer(kind: PointerEventKind, chain: string[]): void;
  fireKey(kind: 'keydown' | 'keyup', key: string): void;
  /** Hover tracking via chain diffing; `null` = pointer left the stage. */
  pointerAt(authoredChain: string[] | null): void;
  /** Consumers call on EVERY applied frame and on ANY seek — scene-identity events fire even
   *  while scrubbing/jumping paused. */
  tickTo(masterTime: number, playing: boolean): void;
  overrides(): ReadonlyMap<string, ObjectOverride>;
  vars(): ReadonlyMap<string, Value>;
  /** Fires after any handled event or tick that changed vars or overrides. */
  onChange(cb: () => void): () => void;
  reset(): void;
}

const CASCADE_LIMIT = 8;

export function createSession(project: Project, host: SessionHost): InteractiveSession {
  // --- Behaviors index (built once) -------------------------------------------------------
  const objectBehaviors = new Map<string, Behavior[]>();
  for (const scene of projectScenes(project)) {
    for (const o of scene.objects) {
      if (o.behaviors && o.behaviors.length > 0) objectBehaviors.set(o.id, o.behaviors);
    }
  }
  const globalHandlers: Behavior[] = project.interactions?.handlers ?? [];

  // --- State --------------------------------------------------------------------------------
  const declaredInitials = new Map<string, Value>();
  for (const v of project.interactions?.variables ?? []) declaredInitials.set(v.name, v.initial);
  const vars = new Map<string, Value>(declaredInitials);
  const overrides = new Map<string, ObjectOverride>();
  let hoverChain: string[] = [];
  let lastSceneId: string | null = null;
  let processing = false;
  let pendingTime: number | null = null;
  let changed = false;
  const listeners = new Set<() => void>();
  const warnedMessages = new Set<string>();
  const parseCache = new Map<string, ParseResult>();

  // --- SavigScript plumbing -------------------------------------------------------------------
  function getAst(src: string): ParseResult {
    let r = parseCache.get(src);
    if (!r) {
      r = parse(src);
      parseCache.set(src, r);
    }
    return r;
  }

  function warnOnce(message: string): void {
    if (warnedMessages.has(message)) return;
    warnedMessages.add(message);
    host.warn(message);
  }

  function env(): EvalEnv {
    const t = host.now();
    const sample = sceneAtTime(project, t);
    const spans = resolveTimeline(project);
    const index = spans.findIndex((s) => s.scene.id === sample.primary.scene.id);
    return {
      vars,
      time: t,
      sceneIndex: index < 0 ? 0 : index,
      sceneTime: sample.primary.localTime,
      random: host.random,
    };
  }

  /** Evaluates a SavigScript source string; returns the value, or `null` (and warns once per
   *  distinct message) on a parse/eval error — the caller skips whatever it was building. */
  function evalArg(src: string): Value | null {
    const parsed = getAst(src);
    if (!parsed.ok) {
      warnOnce(parsed.message);
      return null;
    }
    const result = evaluate(parsed.ast, env());
    if (!result.ok) {
      warnOnce(result.message);
      return null;
    }
    return result.value;
  }

  function evalGuard(src: string): boolean {
    return evalArg(src) === true; // non-boolean (incl. the error sentinel) => skip
  }

  // --- Object lookup (top-level authored objects across every scene) ------------------------
  function findObject(id: string): SceneObject | undefined {
    for (const scene of projectScenes(project)) {
      const o = scene.objects.find((x) => x.id === id);
      if (o) return o;
    }
    return undefined;
  }

  function isTextObject(id: string): boolean {
    const obj = findObject(id);
    if (!obj) return false;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    return asset?.kind === 'text';
  }

  // --- Overrides ------------------------------------------------------------------------------
  function setOverride(id: string, patch: Partial<ObjectOverride>): void {
    const prev = overrides.get(id) ?? {};
    overrides.set(id, { ...prev, ...patch });
    changed = true;
  }

  // --- Playback: session-observed seek (see spec §5 re-entrancy note) -----------------------
  function seekAndRecord(t: number): void {
    host.seek(t);
    pendingTime = t;
  }

  // --- Actions --------------------------------------------------------------------------------
  function runAction(action: BehaviorAction, ownerObjectId: string | null): void {
    const targetId = action.args?.targetId ?? ownerObjectId ?? undefined;
    switch (action.kind) {
      case 'play':
        host.play();
        return;
      case 'pause':
        host.pause();
        return;
      case 'stop':
        host.pause();
        seekAndRecord(0);
        return;
      case 'seek': {
        const raw = action.args?.time;
        if (raw === undefined) return;
        const v = evalArg(raw);
        if (typeof v !== 'number') return;
        seekAndRecord(Math.max(0, v));
        return;
      }
      case 'gotoScene': {
        const sceneId = action.args?.sceneId;
        if (!sceneId) return;
        const span = resolveTimeline(project).find((s) => s.scene.id === sceneId);
        if (!span) return;
        seekAndRecord(span.start);
        return;
      }
      case 'setVar': {
        const name = action.args?.name;
        const raw = action.args?.value;
        if (!name || raw === undefined) return;
        const v = evalArg(raw);
        if (v === null) return;
        vars.set(name, v);
        changed = true;
        return;
      }
      case 'show':
      case 'hide': {
        if (!targetId) return;
        setOverride(targetId, { hidden: action.kind === 'hide' });
        return;
      }
      case 'setOpacity': {
        if (!targetId) return;
        const raw = action.args?.value;
        if (raw === undefined) return;
        const v = evalArg(raw);
        if (typeof v !== 'number') return;
        setOverride(targetId, { opacity: Math.min(1, Math.max(0, v)) });
        return;
      }
      case 'setPosition': {
        if (!targetId) return;
        const patch: ObjectOverride = {};
        const dxSrc = action.args?.dx;
        const dySrc = action.args?.dy;
        if (dxSrc !== undefined) {
          const v = evalArg(dxSrc);
          if (typeof v !== 'number') return; // errored arg skips the WHOLE action
          patch.dx = v;
        }
        if (dySrc !== undefined) {
          const v = evalArg(dySrc);
          if (typeof v !== 'number') return;
          patch.dy = v;
        }
        if (Object.keys(patch).length === 0) return;
        setOverride(targetId, patch);
        return;
      }
      case 'setText': {
        if (!targetId) return;
        if (!isTextObject(targetId)) return; // runtime no-op on a non-text target (defense in depth)
        const raw = action.args?.value;
        if (raw === undefined) return;
        const v = evalArg(raw);
        if (v === null) return;
        setOverride(targetId, { text: typeof v === 'string' ? v : String(v) });
        return;
      }
    }
  }

  function runActions(behavior: Behavior, ownerObjectId: string | null): void {
    for (const action of behavior.actions) {
      if (action.if !== undefined && !evalGuard(action.if)) continue; // skip THIS action only
      runAction(action, ownerObjectId);
    }
  }

  // --- Dispatch -------------------------------------------------------------------------------
  function fireForOwner(ownerId: string, kind: PointerEventKind): void {
    const behaviors = objectBehaviors.get(ownerId) ?? [];
    for (const b of behaviors) {
      if (b.event === kind) runActions(b, ownerId);
    }
  }

  function fireSceneEvent(event: 'sceneStart' | 'sceneEnd', sceneId: string): void {
    for (const b of globalHandlers) {
      if (b.event === event && (b.sceneId === undefined || b.sceneId === sceneId)) {
        runActions(b, null);
      }
    }
  }

  function fireGlobal(event: GlobalEventKind): void {
    for (const b of globalHandlers) {
      if (b.event === event) runActions(b, null);
    }
  }

  function emitSceneChange(t: number): void {
    const id = sceneAtTime(project, t).primary.scene.id;
    if (id !== lastSceneId) {
      if (lastSceneId !== null) fireSceneEvent('sceneEnd', lastSceneId);
      fireSceneEvent('sceneStart', id);
      lastSceneId = id;
    }
  }

  function diffHover(chain: string[] | null): void {
    const next = chain ?? [];
    const prevSet = new Set(hoverChain);
    const nextSet = new Set(next);
    for (const id of hoverChain) {
      if (!nextSet.has(id)) fireForOwner(id, 'hoverLeave');
    }
    for (const id of next) {
      if (!prevSet.has(id)) fireForOwner(id, 'hoverEnter');
    }
    hoverChain = next;
  }

  function notify(): void {
    for (const cb of listeners) cb();
  }

  // --- Cascade guard / re-entrancy (spec §5) --------------------------------------------------
  // External entry points funnel through here. Re-entrant calls made WHILE a handler chain is
  // executing (incl. a consumer's tickTo reacting synchronously to an action's own host.seek) do
  // not recurse: tickTo's re-entrant time is recorded as pendingTime, everything else is dropped.
  // After the outer call's own work, the drain loop processes up to CASCADE_LIMIT chained scene
  // transitions; if one remains queued past the cap, `host.warn` fires once and processing stops
  // (the playhead keeps whatever the last successful seek left it at).
  function withProcessing(fn: () => void, reentrantTime?: number): void {
    if (processing) {
      if (reentrantTime !== undefined) pendingTime = reentrantTime;
      return;
    }
    processing = true;
    changed = false;
    try {
      fn();
      let hops = 0;
      while (pendingTime !== null && hops < CASCADE_LIMIT) {
        const t = pendingTime;
        pendingTime = null;
        hops++;
        emitSceneChange(t);
      }
      if (pendingTime !== null) {
        host.warn(`interaction: cascade limit (${CASCADE_LIMIT}) exceeded; stopping`);
        pendingTime = null;
      }
    } finally {
      processing = false;
    }
    if (changed) notify();
  }

  // --- Public API -----------------------------------------------------------------------------
  function firePointer(kind: PointerEventKind, chain: string[]): void {
    withProcessing(() => {
      for (const id of chain) fireForOwner(id, kind);
    });
  }

  function fireKey(kind: 'keydown' | 'keyup', key: string): void {
    withProcessing(() => {
      for (const b of globalHandlers) {
        if (b.event === kind && b.key === key) runActions(b, null);
      }
    });
  }

  function pointerAt(chain: string[] | null): void {
    withProcessing(() => diffHover(chain));
  }

  function tickTo(masterTime: number, playing: boolean): void {
    withProcessing(() => {
      emitSceneChange(masterTime);
      if (playing) fireGlobal('tick');
    }, masterTime);
  }

  function reset(): void {
    vars.clear();
    for (const [k, v] of declaredInitials) vars.set(k, v);
    overrides.clear();
    hoverChain = []; // cleared WITHOUT emitting synthetic hoverLeave events
    lastSceneId = null; // the next scene-identity emit is treated as a fresh session start
    notify(); // vars/overrides were just cleared — always a change
    withProcessing(() => emitSceneChange(host.now()));
  }

  // Initial sceneStart for whichever scene contains the current playhead (createSession time).
  withProcessing(() => emitSceneChange(host.now()));

  return {
    firePointer,
    fireKey,
    pointerAt,
    tickTo,
    overrides: () => overrides,
    vars: () => vars,
    onChange: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    reset,
  };
}
