import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, createSceneObject, createVectorAsset } from '@savig/engine';
import type { Project } from '@savig/engine';
import { applyFrameToNodes } from './frame';
import './index'; // registers globalThis.SavigRuntime as a side effect

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('applyFrameToNodes', () => {
  it('applies transform/opacity to the wrapper and geometry to the inner shape', () => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-savig-object', 'v1');
    const rect = document.createElementNS(SVG_NS, 'rect');
    g.appendChild(rect);
    const nodes = new Map<string, Element>([['v1', g]]);

    applyFrameToNodes(nodes, [
      {
        objectId: 'v1',
        transform: 'translate(1, 2)',
        opacity: '0.5',
        geometry: { x: '0', y: '0', width: '120', height: '80' },
      },
    ]);

    expect(g.getAttribute('transform')).toBe('translate(1, 2)');
    expect(g.getAttribute('opacity')).toBe('0.5');
    expect(rect.getAttribute('width')).toBe('120');
    expect(rect.getAttribute('height')).toBe('80');
  });

  it('leaves nodes without geometry untouched on the inner element', () => {
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('data-savig-object', 'o1');
    const nodes = new Map<string, Element>([['o1', use]]);
    applyFrameToNodes(nodes, [{ objectId: 'o1', transform: 't', opacity: '1' }]);
    expect(use.getAttribute('transform')).toBe('t');
  });
});

// M9 interactivity/scripting (Task 6): `SavigRuntime.create` builds an interactive session +
// wires DOM listeners only when the project is actually interactive. The real behavioral proof
// lives in Task 8's bundle e2e (a real exported HTML file in a real browser); these are narrower
// jsdom checks of the gating + wiring contract this file owns.
describe('SavigRuntime.create interactivity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    // Some tests assign `window.AudioContext` directly (jsdom has no real implementation to spy
    // on) rather than via vi.spyOn, so `vi.restoreAllMocks()` above doesn't undo it.
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  function buildSvg(ids: string[]): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement;
    for (const id of ids) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('data-savig-object', id);
      g.appendChild(document.createElementNS(SVG_NS, 'rect'));
      svg.appendChild(g);
    }
    document.body.appendChild(svg);
    return svg;
  }

  // Captures whatever `loop` callback is currently scheduled so a test can advance the runtime's
  // RAF-driven playback deterministically, one frame at a time. `callCount()` also lets a test
  // observe whether the loop RE-SCHEDULED itself after a flush (clock.playing stayed true) or not
  // (clock.playing went false) without reaching into the runtime's private `clock` closure.
  function stubRaf(): { flush: () => void; callCount: () => number } {
    let cb: FrameRequestCallback | null = null;
    let calls = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn: FrameRequestCallback) => {
      cb = fn;
      calls++;
      return 1;
    });
    return {
      flush: () => {
        const fn = cb;
        cb = null;
        fn?.(performance.now());
      },
      callCount: () => calls,
    };
  }

  function runtime(): { create: (options: { svg: SVGSVGElement; project: Project; audio: Record<string, string> }) => void } {
    return (globalThis as unknown as {
      SavigRuntime: { create: (options: { svg: SVGSVGElement; project: Project; audio: Record<string, string> }) => void };
    }).SavigRuntime;
  }

  it('adds zero DOM listeners when the project has no interactions and no behaviors', () => {
    const project = createProject();
    const asset = createVectorAsset('rect');
    project.assets.push(asset);
    project.objects.push(createSceneObject(asset.id, { id: 'o1' }));

    const svg = buildSvg(['o1']);
    const addSpy = vi.spyOn(svg, 'addEventListener');
    stubRaf();

    runtime().create({ svg, project, audio: {} });

    expect(addSpy).not.toHaveBeenCalled();
  });

  it('click on an object -> firePointer -> setOpacity override, applied on the next frame', () => {
    const project = createProject();
    const asset = createVectorAsset('rect');
    project.assets.push(asset);
    project.objects.push(
      createSceneObject(asset.id, {
        id: 'o1',
        behaviors: [{ id: 'b1', event: 'click', actions: [{ kind: 'setOpacity', args: { value: '0.25' } }] }],
      }),
    );

    const svg = buildSvg(['o1']);
    const raf = stubRaf();
    runtime().create({ svg, project, audio: {} });
    raf.flush(); // first scheduled frame after load

    const node = svg.querySelector('[data-savig-object="o1"]')!;
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Overrides land on the NEXT frame's post-pass (tickTo runs once per frame; this proves the
    // wiring reaches the session AND that the RAF loop, not the click itself, paints it).
    expect(node.getAttribute('opacity')).not.toBe('0.25');
    raf.flush();

    expect(node.getAttribute('opacity')).toBe('0.25');
  });

  it('ownerDocument keydown fires a global handler; repeat keydowns are ignored', () => {
    const project = createProject();
    const asset = createVectorAsset('rect');
    project.assets.push(asset);
    project.objects.push(createSceneObject(asset.id, { id: 'o1' }));
    project.interactions = {
      handlers: [{ id: 'h1', event: 'keydown', key: 'a', actions: [{ kind: 'hide', args: { targetId: 'o1' } }] }],
    };

    const svg = buildSvg(['o1']);
    const raf = stubRaf();
    runtime().create({ svg, project, audio: {} });
    raf.flush();

    const node = svg.querySelector('[data-savig-object="o1"]')!;
    expect(node.hasAttribute('display')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', repeat: true }));
    raf.flush();
    expect(node.hasAttribute('display')).toBe(false); // repeat ignored, no hide fired

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    raf.flush();
    expect(node.getAttribute('display')).toBe('none'); // real keydown fires
  });

  // Review fix (Important): the initial `sceneStart` handler fires SYNCHRONOUSLY inside
  // `createSession`, before the runtime decides whether to autoplay — a "click-to-start" bundle
  // that pauses from that handler must not be silently overridden by the runtime's own default
  // autoplay a few lines later.
  it('a sceneStart -> pause handler starts the bundle paused, with no startAudio call; a later play behavior resumes it', () => {
    const project = createProject();
    const asset = createVectorAsset('rect');
    project.assets.push(asset);
    project.objects.push(
      createSceneObject(asset.id, {
        id: 'o1',
        behaviors: [{ id: 'b1', event: 'click', actions: [{ kind: 'play' }] }],
      }),
    );
    // An audio clip makes "no startAudio call" observable: createAudioStarter only ever
    // constructs an AudioContext when clips.length > 0.
    project.audioClips.push({ id: 'c1', assetId: 'aud1', startTime: 0, inPoint: 0, outPoint: 1, volume: 1 });
    project.interactions = {
      handlers: [{ id: 'h1', event: 'sceneStart', actions: [{ kind: 'pause' }] }],
    };

    // jsdom has no real Web Audio implementation to spy on; install a minimal stub constructor
    // so "was AudioContext ever constructed" is directly observable.
    const audioCtor = vi.fn(function fakeAudioContext(this: Record<string, unknown>) {
      this.currentTime = 0;
      this.destination = {};
      this.createGain = () => ({
        gain: { value: 0, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
        connect: () => {},
      });
      this.createBufferSource = () => ({ connect: () => {}, start: () => {} });
      this.decodeAudioData = () => Promise.resolve({});
    });
    (window as unknown as { AudioContext: unknown }).AudioContext = audioCtor;

    const svg = buildSvg(['o1']);
    const raf = stubRaf();
    runtime().create({ svg, project, audio: {} });

    // One "repaint only" frame is still scheduled (the paused first frame gets painted)...
    expect(raf.callCount()).toBe(1);
    raf.flush();
    // ...but it did NOT reschedule itself, because clock.playing is false (paused-start honored).
    expect(raf.callCount()).toBe(1);
    expect(audioCtor).not.toHaveBeenCalled();

    // A later `play` behavior action (fired via a real click) resumes it.
    const node = svg.querySelector('[data-savig-object="o1"]')!;
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(raf.callCount()).toBe(2); // host.play() -> scheduleLoop() queued a new frame

    raf.flush();
    expect(raf.callCount()).toBe(3); // that frame ran with clock.playing true -> it rescheduled itself
  });

  // Review fix (Important, spec §5): the HOST clamps `seek`'s upper bound to project duration,
  // matching the editor's own seek (transportPrefsSlice.ts) — the engine session only floors a
  // `seek` action's time at 0 (script/session.ts), so this contract is the runtime host's alone.
  it('a seek behavior past project duration clamps the clock to duration, not the raw target', () => {
    const project = createProject({ durationMode: 'manual', duration: 5 });
    const asset = createVectorAsset('rect');
    project.assets.push(asset);
    project.objects.push(
      createSceneObject(asset.id, {
        id: 'o1',
        behaviors: [
          {
            id: 'b1',
            event: 'click',
            actions: [
              { kind: 'seek', args: { time: '9999' } },
              // `time` (SavigScript built-in) reads back whatever the host actually clamped the
              // clock to, evaluated in the SAME action cascade right after the seek runs above.
              // Dividing by 10000 keeps the result inside setOpacity's own [0,1] clamp either way
              // (0.0005 if clamped to duration=5, 0.9999 if the raw 9999 target leaked through).
              { kind: 'setOpacity', args: { value: 'time / 10000' } },
            ],
          },
        ],
      }),
    );

    const svg = buildSvg(['o1']);
    const raf = stubRaf();
    runtime().create({ svg, project, audio: {} });
    raf.flush(); // first scheduled frame after load

    const node = svg.querySelector('[data-savig-object="o1"]')!;
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    raf.flush(); // overrides land on the next frame's post-pass, as in the click test above

    expect(node.getAttribute('opacity')).toBe('0.0005'); // 5 / 10000, i.e. clamped to duration

    // Not frozen past-range: the clock landed exactly ON duration (not stuck out-of-bounds at the
    // raw 9999 target), so the next tick's own end-of-timeline handling — non-looping playback
    // stopping at duration — runs normally instead of the loop erroring or hanging on an
    // out-of-range time.
    expect(() => raf.flush()).not.toThrow();
  });
});
