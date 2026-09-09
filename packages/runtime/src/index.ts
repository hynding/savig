import {
  advance,
  computeProjectDuration,
  createClock,
  createSession,
  expandOverrides,
  fadeEnvelopePoints,
  pause,
  play,
  projectScenes,
  resolveActiveClips,
  resolveAuthoredChain,
  resolveTrackState,
  seek,
} from '@savig/engine';
import type {
  AudioClip,
  AudioTrack,
  InteractiveSession,
  ObjectOverride,
  PointerEventKind,
  Project,
  SessionHost,
} from '@savig/engine';
import { applyProjectFrame } from './frame';

interface CreateOptions {
  svg: SVGSVGElement;
  project: Project;
  audio: Record<string, string>; // assetId -> base64
}

const POINTER_KINDS: readonly PointerEventKind[] = ['click', 'pointerdown', 'pointerup'];

// M9 interactivity/scripting: true when the project has ANY armed interactivity — a project-level
// `interactions` model (even an empty one, matching the editor's gate) or at least one object
// carrying `behaviors`. Gates whether `create()` builds a session/host and wires ANY DOM listeners
// at all — a non-interactive project (the overwhelming majority, pre-M9) pays zero extra cost.
function hasInteractivity(project: Project): boolean {
  if (project.interactions) return true;
  for (const scene of projectScenes(project)) {
    for (const o of scene.objects) {
      if (o.behaviors && o.behaviors.length > 0) return true;
    }
  }
  return false;
}

// M9 interactivity/scripting: the runtime's own copy of the editor's DOM override post-pass
// (apps/react/src/ui/preview/applyOverridesPass.ts) — the bundle cannot import from apps/, so it
// is duplicated here verbatim (parity locked by the shared `ObjectOverride` shape + Task 8's
// bundle e2e). Runs immediately after a frame paint so every mapped renderId is written from
// scratch each time — a flipped override can never leave a stale attribute behind, and a fresh
// frame paint always rewrites `transform` before this runs again (no double-prepend).
function applyOverridesPassRuntime(nodes: Map<string, Element>, expanded: Map<string, ObjectOverride>): void {
  for (const [renderId, o] of expanded) {
    const node = nodes.get(renderId);
    if (!node) continue;
    if (o.hidden !== undefined) node.setAttribute('display', o.hidden ? 'none' : '');
    if (o.opacity !== undefined) node.setAttribute('opacity', String(o.opacity));
    if (o.dx !== undefined || o.dy !== undefined) {
      node.setAttribute('transform', `translate(${o.dx ?? 0} ${o.dy ?? 0}) ${node.getAttribute('transform') ?? ''}`);
    }
    if (o.text !== undefined) {
      // Text leaves are <g data-savig-object> WRAPPERS around the actual <text> element (never
      // the <text> itself) — a bare `node.tagName === 'text'` check would be a permanent no-op in
      // practice. A <text> with a bound textPath (spec §7) carries its rendered glyphs in the
      // <textPath> CHILD, whose binding must be preserved — replace only its textContent, never
      // <text>'s own children.
      const textEl = node.tagName.toLowerCase() === 'text' ? node : node.querySelector('text');
      if (textEl) {
        const container = textEl.querySelector('textPath') ?? textEl;
        container.textContent = o.text;
      }
    }
  }
}

// Self-contained player bundled into savig-runtime.js. Drives the SVG
// imperatively from the shared engine core and schedules audio via Web Audio.
function create(options: CreateOptions): void {
  const { svg, project, audio } = options;
  const duration = computeProjectDuration(project);
  const nodes = new Map<string, Element>();
  svg.querySelectorAll('[data-savig-object]').forEach((node) => {
    const id = node.getAttribute('data-savig-object');
    if (id) nodes.set(id, node);
  });

  const apply = (time: number): void => {
    applyProjectFrame(svg, nodes, project, time);
  };

  let clock = createClock();
  let interactiveSession: InteractiveSession | null = null;
  // Autoplay intent (review fix — Important): `createSession` fires the initial `sceneStart`
  // event SYNCHRONOUSLY during construction, before the runtime has decided whether to autoplay.
  // A "click-to-start"/"wait-for-input" bundle can arm a `sceneStart -> pause` (or `stop`)
  // handler that must win over the runtime's own default autoplay — without this flag, the
  // unconditional `play()`/`startAudio()` below would silently override it every time. Defaults
  // to true (existing, pre-M9 behavior: every export autoplays); `host.pause()` clears it,
  // `host.play()` sets it back (so an explicit `play` in the SAME initial handler, or later,
  // still autoplays/resumes normally).
  let autoplayIntent = true;

  // Repaints the CURRENT overrides on top of whatever frame is already painted — never calls
  // `tickTo`/`fire*` (binding contract: the paused-repaint path must repaint ONLY, or a `tick`/
  // behavior handler that mutates state every notify would recurse forever).
  const repaintOverridesOnly = (): void => {
    if (!interactiveSession) return;
    applyOverridesPassRuntime(nodes, expandOverrides(project, interactiveSession.overrides(), nodes.keys()));
  };

  // Guards against scheduling more than one pending RAF for `loop` at a time — `host.play()` can
  // resume a loop that stopped (paused, or ran off the end of a non-looping project) from a
  // behavior handler, independent of the loop's own tail-call scheduling.
  let loopPending = false;
  const scheduleLoop = (): void => {
    if (loopPending) return;
    loopPending = true;
    requestAnimationFrame(loop);
  };
  function loop(timestamp: number): void {
    loopPending = false;
    clock = advance(clock, timestamp / 1000, duration, project.meta.loop);
    apply(clock.time);
    if (interactiveSession) {
      // tickTo runs exactly once per frame, BEFORE the overrides pass (binding contract).
      interactiveSession.tickTo(clock.time, clock.playing);
      repaintOverridesOnly();
    }
    if (clock.playing) scheduleLoop();
  }

  if (hasInteractivity(project)) {
    const host: SessionHost = {
      play: () => {
        clock = play(clock, performance.now() / 1000);
        autoplayIntent = true;
        scheduleLoop();
      },
      pause: () => {
        clock = pause(clock);
        autoplayIntent = false;
      },
      seek: (t: number) => {
        // seek preserves the current playing state (`pause`/`seek` never touch `.playing`); it
        // also re-applies the frame + overrides immediately, not just on the next RAF tick.
        clock = seek(clock, t);
        apply(clock.time);
        repaintOverridesOnly();
      },
      now: () => clock.time,
      random: Math.random,
      warn: (m: string) => console.warn('[savig]', m),
    };
    const session = createSession(project, host);
    interactiveSession = session;

    // Paused repaint (binding contract): fires after any handled event/tick that changed vars or
    // overrides. Repaints ONLY (frame + overrides pass) — never tickTo/fire* — since the RAF loop
    // already owns tickTo while playing.
    session.onChange(() => {
      if (!clock.playing) {
        apply(clock.time);
        repaintOverridesOnly();
      }
    });

    const chainFromTarget = (target: EventTarget | null): string[] => {
      const el = target instanceof Element ? target.closest('[data-savig-object]') : null;
      const renderId = el?.getAttribute('data-savig-object');
      return renderId ? resolveAuthoredChain(project, renderId) : [];
    };

    for (const kind of POINTER_KINDS) {
      svg.addEventListener(kind, (e: Event) => {
        const chain = chainFromTarget(e.target);
        if (chain.length > 0) session.firePointer(kind, chain);
      });
    }
    svg.addEventListener('pointerover', (e: Event) => {
      const chain = chainFromTarget(e.target);
      session.pointerAt(chain.length > 0 ? chain : null);
    });
    // pointerout only matters for "left the stage entirely" — a transition to another element
    // still inside the root is covered by that element's own pointerover.
    svg.addEventListener('pointerout', (e: PointerEvent) => {
      const related = e.relatedTarget;
      if (related instanceof Node && svg.contains(related)) return;
      session.pointerAt(null);
    });

    const doc = svg.ownerDocument;
    doc.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      session.fireKey('keydown', e.key);
    });
    doc.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.repeat) return;
      session.fireKey('keyup', e.key);
    });
  }

  // `clock.time` is still 0 here UNLESS an initial sceneStart handler (fired synchronously
  // inside `createSession` above, before `interactiveSession` was assigned) already called
  // `host.seek` — painting the literal current time (not a hardcoded 0) keeps that seek's
  // effect visible in the very first frame instead of briefly flashing frame 0.
  apply(clock.time);
  if (autoplayIntent) {
    clock = play(clock, performance.now() / 1000);
    createAudioStarter(project.audioClips, project.audioTracks, audio)();
  }
  // else: an initial sceneStart handler called `host.pause()`/the `stop` action (a "click-to-
  // start" bundle) — `clock.playing` is already false from that call, so leave it there and skip
  // starting audio entirely (it starts, if at all, from whatever later `play` behavior resumes
  // the session). Listeners are armed unconditionally above, so a click/key can still fire that
  // `play` action. `scheduleLoop()` below still runs the loop ONCE either way (`loop`'s own tail
  // only reschedules `if (clock.playing)`), which paints this first frame's tickTo + overrides
  // pass — the paused start is still visibly correct, just not advancing.
  scheduleLoop();

  // Expose a seek hook so tests can apply a deterministic frame without timing dependence.
  // Calling savigSeek(t) applies the frame at master time `t` synchronously; a subsequent
  // RAF tick will resume normal playback. Tests that need a stable snapshot should call
  // savigSeek AND read the DOM in the same page.evaluate() call (single JS task = no RAF
  // can interject between the two).
  // NOTE: this bypasses `session.tickTo` entirely (no scene-identity events fire from a
  // savigSeek call, unlike `host.seek`/the RAF loop) — a scrub across a scene boundary via this
  // hook will NOT fire sceneStart/sceneEnd. A test asserting scene-event side effects (not just
  // the painted frame) must drive real playback/host.seek, not this hook.
  (globalThis as unknown as { savigSeek: (t: number) => void }).savigSeek = (t: number) => {
    apply(t);
    repaintOverridesOnly();
  };
}

function createAudioStarter(
  clips: AudioClip[],
  tracks: AudioTrack[] | undefined,
  audio: Record<string, string>,
): () => void {
  return () => {
    if (clips.length === 0) return;
    const Ctx = (window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)!;
    const ctx = new Ctx();
    const decoded = new Map<string, AudioBuffer>();
    const decodeAll = clips.map(async (clip) => {
      if (decoded.has(clip.assetId) || !audio[clip.assetId]) return;
      const bytes = Uint8Array.from(atob(audio[clip.assetId]), (c) => c.charCodeAt(0));
      decoded.set(clip.assetId, await ctx.decodeAudioData(bytes.buffer));
    });
    void Promise.all(decodeAll).then(() => {
      const chains = new Map<string, GainNode>(); // trackId|'' -> chain INPUT node
      for (const { clip } of resolveActiveClips(clips, 0)) {
        schedule(ctx, decoded, clip, chainInput(ctx, chains, tracks, clip.trackId));
      }
      for (const clip of clips) {
        if (clip.startTime > 0) schedule(ctx, decoded, clip, chainInput(ctx, chains, tracks, clip.trackId));
      }
    });
  };
}

// Builds (and memoizes, per playback session) the mixer chain for one track: gain -> pan ->
// filter -> destination, mirroring the services audioEngine so exported playback matches the
// editor. Clips with no (or a dangling) trackId share the '' key = the implicit default track.
function chainInput(
  ctx: AudioContext,
  chains: Map<string, GainNode>,
  tracks: AudioTrack[] | undefined,
  trackId: string | undefined,
): GainNode {
  const key = trackId && tracks?.some((t) => t.id === trackId) ? trackId : '';
  const hit = chains.get(key);
  if (hit) return hit;
  const state = resolveTrackState(tracks, key || undefined);
  const input = ctx.createGain();
  input.gain.value = state.audible ? state.gain : 0;
  let tail: AudioNode = input;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = state.pan;
    tail.connect(p);
    tail = p;
  }
  if (state.filter) {
    const f = ctx.createBiquadFilter();
    f.type = state.filter.kind;
    f.frequency.value = state.filter.frequency;
    tail.connect(f);
    tail = f;
  }
  tail.connect(ctx.destination);
  chains.set(key, input);
  return input;
}

// The runtime always starts playback at time 0, so envelope timeline-times map directly onto
// ctx offsets from `base = ctx.currentTime` (unlike the editor engine's fromTime remap).
function schedule(ctx: AudioContext, decoded: Map<string, AudioBuffer>, clip: AudioClip, into: AudioNode): void {
  const buffer = decoded.get(clip.assetId);
  if (!buffer) return;
  const gain = ctx.createGain();
  const envelope = fadeEnvelopePoints(clip, 0);
  if (((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0) && envelope.length) {
    const base = ctx.currentTime;
    gain.gain.setValueAtTime(clip.volume * envelope[0].gain, base + envelope[0].t);
    for (const p of envelope.slice(1)) gain.gain.linearRampToValueAtTime(clip.volume * p.gain, base + p.t);
  } else {
    gain.gain.value = clip.volume;
  }
  gain.connect(into);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start(ctx.currentTime + Math.max(0, clip.startTime), clip.inPoint, clip.outPoint - clip.inPoint);
}

(globalThis as unknown as { SavigRuntime: { create: typeof create } }).SavigRuntime = { create };
