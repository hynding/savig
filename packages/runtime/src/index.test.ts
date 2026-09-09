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
  // RAF-driven playback deterministically, one frame at a time.
  function stubRaf(): { flush: () => void } {
    let cb: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn: FrameRequestCallback) => {
      cb = fn;
      return 1;
    });
    return {
      flush: () => {
        const fn = cb;
        cb = null;
        fn?.(performance.now());
      },
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
});
