import { describe, expect, it, vi } from 'vitest';
import { createSession, type SessionHost } from './session';
import {
  createProject,
  createSceneObject,
  createVectorAsset,
  createTextAsset,
} from '../project';
import type { Behavior, InteractionModel, Project, Scene, SceneObject } from '../types';

function fakeHost(overrides: Partial<SessionHost> = {}): SessionHost & { calls: string[]; time: number; playing: boolean } {
  const state = {
    calls: [] as string[],
    time: 0,
    playing: false,
  };
  const host: SessionHost & { calls: string[]; time: number; playing: boolean } = {
    calls: state.calls,
    get time() {
      return state.time;
    },
    set time(v: number) {
      state.time = v;
    },
    get playing() {
      return state.playing;
    },
    set playing(v: boolean) {
      state.playing = v;
    },
    play: () => {
      state.playing = true;
      state.calls.push('play');
    },
    pause: () => {
      state.playing = false;
      state.calls.push('pause');
    },
    seek: (t: number) => {
      state.time = t;
      state.calls.push(`seek:${t}`);
    },
    now: () => state.time,
    random: () => 0.5,
    warn: (m: string) => {
      state.calls.push(`warn:${m}`);
    },
    ...overrides,
  };
  return host;
}

const rect = createVectorAsset('rect');

function withBehaviors(objects: SceneObject[], interactions?: InteractionModel, assets: Project['assets'] = [rect]): Project {
  return { ...createProject(), assets, objects, interactions };
}

function behaviorObject(id: string, behaviors: Behavior[]): SceneObject {
  return createSceneObject(rect.id, { id, behaviors });
}

describe('createSession — guards', () => {
  it('guard true fires action; guard false / eval-error / non-boolean skips THAT action, later actions still run', () => {
    const obj = behaviorObject('o1', [
      {
        id: 'b1',
        event: 'click',
        actions: [
          { kind: 'setVar', args: { name: 'a', value: '1' }, if: 'true' },
          { kind: 'setVar', args: { name: 'b', value: '1' }, if: 'false' },
          { kind: 'setVar', args: { name: 'c', value: '1' }, if: 'nope(' }, // parse error
          { kind: 'setVar', args: { name: 'd', value: '1' }, if: 'unknownVar' }, // eval error
          { kind: 'setVar', args: { name: 'e', value: '1' }, if: '1' }, // non-boolean
          { kind: 'setVar', args: { name: 'f', value: '1' } }, // no guard, always runs
        ],
      },
    ]);
    const project = withBehaviors([obj]);
    const host = fakeHost();
    const session = createSession(project, host);

    session.firePointer('click', ['o1']);

    const vars = session.vars();
    expect(vars.get('a')).toBe(1);
    expect(vars.has('b')).toBe(false);
    expect(vars.has('c')).toBe(false);
    expect(vars.has('d')).toBe(false);
    expect(vars.has('e')).toBe(false);
    expect(vars.get('f')).toBe(1);
  });
});

describe('createSession — chain walk', () => {
  it('behavior on a group fires when a leaf chain is passed; nearest-first order; array order within object', () => {
    // Ordering via string-concat onto a shared 'order' variable.
    const leaf = createSceneObject(rect.id, {
      id: 'leaf',
      parentId: 'g1',
      behaviors: [
        {
          id: 'b-leaf-1',
          event: 'click',
          actions: [{ kind: 'setVar', args: { name: 'order', value: 'order + "leaf1"' } }],
        },
        {
          id: 'b-leaf-2',
          event: 'click',
          actions: [{ kind: 'setVar', args: { name: 'order', value: 'order + ",leaf2"' } }],
        },
      ],
    });
    const group = createSceneObject('', {
      id: 'g1',
      isGroup: true,
      behaviors: [
        {
          id: 'b-group',
          event: 'click',
          actions: [{ kind: 'setVar', args: { name: 'order', value: 'order + ",group"' } }],
        },
      ],
    });
    const interactions: InteractionModel = { variables: [{ name: 'order', initial: '' }] };
    const project = withBehaviors([leaf, group], interactions);
    const host = fakeHost();
    const session = createSession(project, host);

    session.firePointer('click', ['leaf', 'g1']);

    expect(session.vars().get('order')).toBe('leaf1,leaf2,group');
  });
});

describe('createSession — vars', () => {
  it('undeclared setVar creates; reset() restores declared initials and deletes dynamics', () => {
    const obj = behaviorObject('o1', [
      {
        id: 'b1',
        event: 'click',
        actions: [
          { kind: 'setVar', args: { name: 'declared', value: '"changed"' } },
          { kind: 'setVar', args: { name: 'dynamic', value: '42' } },
        ],
      },
    ]);
    const interactions: InteractionModel = { variables: [{ name: 'declared', initial: 'init' }] };
    const project = withBehaviors([obj], interactions);
    const host = fakeHost();
    const session = createSession(project, host);

    session.firePointer('click', ['o1']);
    expect(session.vars().get('declared')).toBe('changed');
    expect(session.vars().get('dynamic')).toBe(42);

    session.reset();
    expect(session.vars().get('declared')).toBe('init');
    expect(session.vars().has('dynamic')).toBe(false);
  });
});

describe('createSession — overrides', () => {
  it('hide then show yields explicit hidden:false entry', () => {
    const obj = behaviorObject('o1', [
      { id: 'b-hide', event: 'click', actions: [{ kind: 'hide', args: { targetId: 'o1' } }] },
      { id: 'b-show', event: 'pointerup', actions: [{ kind: 'show', args: { targetId: 'o1' } }] },
    ]);
    const project = withBehaviors([obj]);
    const session = createSession(project, fakeHost());

    session.firePointer('click', ['o1']);
    expect(session.overrides().get('o1')).toEqual({ hidden: true });

    session.firePointer('pointerup', ['o1']);
    expect(session.overrides().get('o1')).toEqual({ hidden: false });
  });

  it('setOpacity clamps 0..1', () => {
    const obj = behaviorObject('o1', [
      { id: 'b1', event: 'click', actions: [{ kind: 'setOpacity', args: { targetId: 'o1', value: '5' } }] },
    ]);
    const project = withBehaviors([obj]);
    const session = createSession(project, fakeHost());
    session.firePointer('click', ['o1']);
    expect(session.overrides().get('o1')).toEqual({ opacity: 1 });
  });

  it('setOpacity clamps negative to 0', () => {
    const obj = behaviorObject('o1', [
      { id: 'b1', event: 'click', actions: [{ kind: 'setOpacity', args: { targetId: 'o1', value: '-5' } }] },
    ]);
    const project = withBehaviors([obj]);
    const session = createSession(project, fakeHost());
    session.firePointer('click', ['o1']);
    expect(session.overrides().get('o1')).toEqual({ opacity: 0 });
  });

  it('setText on non-text target is a no-op', () => {
    const obj = behaviorObject('o1', [
      { id: 'b1', event: 'click', actions: [{ kind: 'setText', args: { targetId: 'o1', value: '"hi"' } }] },
    ]);
    const project = withBehaviors([obj]);
    const session = createSession(project, fakeHost());
    session.firePointer('click', ['o1']);
    expect(session.overrides().has('o1')).toBe(false);
  });

  it('setText on a text target sets text; last-write-wins', () => {
    const textAsset = createTextAsset({ id: 'txt' });
    const obj = createSceneObject('txt', {
      id: 't1',
      behaviors: [
        { id: 'b1', event: 'click', actions: [{ kind: 'setText', args: { targetId: 't1', value: '"first"' } }] },
        { id: 'b2', event: 'pointerup', actions: [{ kind: 'setText', args: { targetId: 't1', value: '"second"' } }] },
      ],
    });
    const project = withBehaviors([obj], undefined, [rect, textAsset]);
    const session = createSession(project, fakeHost());
    session.firePointer('click', ['t1']);
    expect(session.overrides().get('t1')).toEqual({ text: 'first' });
    session.firePointer('pointerup', ['t1']);
    expect(session.overrides().get('t1')).toEqual({ text: 'second' });
  });
});

describe('createSession — playback', () => {
  it('play/pause call host', () => {
    const obj = behaviorObject('o1', [
      { id: 'b1', event: 'click', actions: [{ kind: 'play' }] },
      { id: 'b2', event: 'pointerup', actions: [{ kind: 'pause' }] },
    ]);
    const project = withBehaviors([obj]);
    const host = fakeHost();
    const session = createSession(project, host);
    session.firePointer('click', ['o1']);
    expect(host.calls).toContain('play');
    session.firePointer('pointerup', ['o1']);
    expect(host.calls).toContain('pause');
  });

  it('stop = host.pause + host.seek(0); vars survive', () => {
    const obj = behaviorObject('o1', [
      { id: 'b0', event: 'click', actions: [{ kind: 'setVar', args: { name: 'score', value: '10' } }] },
      { id: 'b1', event: 'pointerup', actions: [{ kind: 'stop' }] },
    ]);
    const project = withBehaviors([obj]);
    const host = fakeHost();
    host.time = 5;
    const session = createSession(project, host);
    session.firePointer('click', ['o1']);
    session.firePointer('pointerup', ['o1']);
    expect(host.calls).toContain('pause');
    expect(host.calls).toContain('seek:0');
    expect(session.vars().get('score')).toBe(10);
  });

  it('seek.time expression evaluated, negative clamps to 0', () => {
    const obj = behaviorObject('o1', [
      { id: 'b1', event: 'click', actions: [{ kind: 'seek', args: { time: '0 - 5' } }] },
    ]);
    const project = withBehaviors([obj]);
    const host = fakeHost();
    const session = createSession(project, host);
    session.firePointer('click', ['o1']);
    expect(host.calls).toContain('seek:0');
  });

  it('gotoScene seeks the span start (multi-scene project)', () => {
    const sceneA: Scene = { id: 'sceneA', name: 'A', objects: [], duration: 2 };
    const objB = behaviorObject('gotoB', [
      { id: 'b1', event: 'click', actions: [{ kind: 'gotoScene', args: { sceneId: 'sceneB' } }] },
    ]);
    const sceneAWithBehavior: Scene = { ...sceneA, objects: [objB] };
    const sceneB: Scene = { id: 'sceneB', name: 'B', objects: [], duration: 3 };
    const project: Project = { ...createProject(), assets: [rect], scenes: [sceneAWithBehavior, sceneB] };
    const host = fakeHost();
    const session = createSession(project, host);
    session.firePointer('click', ['gotoB']);
    expect(host.calls).toContain('seek:2');
  });
});

describe('createSession — scene identity', () => {
  function twoScenes(handlers: Behavior[] = []): Project {
    const sceneA: Scene = { id: 'sceneA', name: 'A', objects: [], duration: 2 };
    const sceneB: Scene = { id: 'sceneB', name: 'B', objects: [], duration: 3 };
    return { ...createProject(), assets: [rect], scenes: [sceneA, sceneB], interactions: { handlers } };
  }

  it('session start fires initial sceneStart', () => {
    const order: string[] = [];
    const handlers: Behavior[] = [
      { id: 'h1', event: 'sceneStart', actions: [{ kind: 'setVar', args: { name: 'log', value: '"start"' } }] },
    ];
    const project = twoScenes(handlers);
    const session = createSession(project, fakeHost());
    void order;
    expect(session.vars().get('log')).toBe('start');
  });

  it('tickTo across a span boundary fires sceneEnd(a) then sceneStart(b)', () => {
    const handlers: Behavior[] = [
      { id: 'end', event: 'sceneEnd', actions: [{ kind: 'setVar', args: { name: 'log', value: 'log + "end;"' } }] },
      { id: 'start', event: 'sceneStart', actions: [{ kind: 'setVar', args: { name: 'log', value: 'log + "start;"' } }] },
    ];
    const project: Project = {
      ...twoScenes(handlers),
      interactions: { variables: [{ name: 'log', initial: '' }], handlers },
    };
    const host = fakeHost();
    const session = createSession(project, host);
    // initial sceneStart at t=0 fires 'start' once.
    expect(session.vars().get('log')).toBe('start;');
    session.tickTo(2.5, true); // crosses into sceneB
    expect(session.vars().get('log')).toBe('start;end;start;');
  });

  it('seek-while-paused fires scene identity events too', () => {
    const handlers: Behavior[] = [
      { id: 'start', event: 'sceneStart', actions: [{ kind: 'setVar', args: { name: 'n', value: 'n + 1' } }] },
    ];
    const project: Project = {
      ...twoScenes(handlers),
      interactions: { variables: [{ name: 'n', initial: 0 }], handlers },
    };
    const session = createSession(project, fakeHost());
    expect(session.vars().get('n')).toBe(1); // initial
    session.tickTo(2.5, false); // paused seek across boundary
    expect(session.vars().get('n')).toBe(2);
  });

  it('sceneId-filtered handlers only fire for their scene', () => {
    const handlers: Behavior[] = [
      { id: 'onlyA', event: 'sceneStart', sceneId: 'sceneA', actions: [{ kind: 'setVar', args: { name: 'aCount', value: 'aCount + 1' } }] },
      { id: 'onlyB', event: 'sceneStart', sceneId: 'sceneB', actions: [{ kind: 'setVar', args: { name: 'bCount', value: 'bCount + 1' } }] },
    ];
    const project: Project = {
      ...twoScenes(handlers),
      interactions: { variables: [{ name: 'aCount', initial: 0 }, { name: 'bCount', initial: 0 }], handlers },
    };
    const session = createSession(project, fakeHost());
    expect(session.vars().get('aCount')).toBe(1);
    expect(session.vars().get('bCount')).toBe(0);
    session.tickTo(2.5, false);
    expect(session.vars().get('aCount')).toBe(1);
    expect(session.vars().get('bCount')).toBe(1);
  });
});

describe('createSession — cascade guard & re-entrancy', () => {
  // A leading neutral scene (no handlers) keeps createSession's OWN initial sceneStart from
  // triggering the mutual loop — the cascade under test is provoked only by the explicit
  // tickTo() call below, so the assertions aren't polluted by construction-time side effects.
  function mutualLoopProject(): Project {
    const neutral: Scene = { id: 'neutral', name: 'N', objects: [], duration: 10 };
    const sceneA: Scene = { id: 'sceneA', name: 'A', objects: [], duration: 2 };
    const sceneB: Scene = { id: 'sceneB', name: 'B', objects: [], duration: 2 };
    const handlers: Behavior[] = [
      { id: 'a-to-b', event: 'sceneStart', sceneId: 'sceneA', actions: [{ kind: 'gotoScene', args: { sceneId: 'sceneB' } }] },
      { id: 'b-to-a', event: 'sceneStart', sceneId: 'sceneB', actions: [{ kind: 'gotoScene', args: { sceneId: 'sceneA' } }] },
      { id: 'tick-count', event: 'tick', actions: [{ kind: 'setVar', args: { name: 'ticks', value: 'ticks + 1' } }] },
    ];
    return {
      ...createProject(),
      assets: [rect],
      scenes: [neutral, sceneA, sceneB],
      interactions: { variables: [{ name: 'ticks', initial: 0 }], handlers },
    };
  }

  it('a 2-scene mutual gotoScene loop stops after 8 transitions with exactly ONE host.warn; tick fires at most once', () => {
    const host = fakeHost();
    const session = createSession(mutualLoopProject(), host);
    expect(host.calls.filter((c) => c.startsWith('warn:'))).toHaveLength(0); // construction: neutral scene, no cascade yet

    session.tickTo(10, true); // enters sceneA -> mutual gotoScene loop

    const warnCalls = host.calls.filter((c) => c.startsWith('warn:'));
    expect(warnCalls).toHaveLength(1);
    expect(session.vars().get('ticks')).toBe(1); // tick fired exactly once for this external call
  });

  it('re-entrancy: host.seek synchronously calling session.tickTo does not recurse', () => {
    const log: string[] = [];
    const neutral: Scene = { id: 'neutral', name: 'N', objects: [], duration: 10 };
    const sceneA: Scene = { id: 'sceneA', name: 'A', objects: [], duration: 2 };
    const sceneB: Scene = { id: 'sceneB', name: 'B', objects: [], duration: 2 };
    const handlers: Behavior[] = [
      {
        id: 'go',
        event: 'sceneStart',
        sceneId: 'sceneA',
        actions: [{ kind: 'setVar', args: { name: 'runs', value: 'runs + 1' } }, { kind: 'gotoScene', args: { sceneId: 'sceneB' } }],
      },
    ];
    const project: Project = {
      ...createProject(),
      assets: [rect],
      scenes: [neutral, sceneA, sceneB],
      interactions: { variables: [{ name: 'runs', initial: 0 }], handlers },
    };
    let session!: ReturnType<typeof createSession>;
    const host = fakeHost({
      seek: (t: number) => {
        log.push(`seek:${t}`);
        session.tickTo(t, false); // simulate a consumer whose seek is synchronous
      },
    });
    session = createSession(project, host);
    log.push('---external tickTo---');
    session.tickTo(10.1, false); // enters sceneA -> handler runs, gotoScene(sceneB)
    log.push('---done---');

    // The handler ('go') ran exactly once — no recursive re-entry via the synchronous seek.
    expect(session.vars().get('runs')).toBe(1);
    expect(log.filter((l) => l === 'seek:12')).toHaveLength(1);
  });
});

describe('createSession — keyboard & hover', () => {
  it("fireKey('keydown', 'ArrowLeft') matches only handlers with that key", () => {
    const handlers: Behavior[] = [
      { id: 'left', event: 'keydown', key: 'ArrowLeft', actions: [{ kind: 'setVar', args: { name: 'left', value: 'true' } }] },
      { id: 'right', event: 'keydown', key: 'ArrowRight', actions: [{ kind: 'setVar', args: { name: 'right', value: 'true' } }] },
    ];
    const project: Project = { ...createProject(), assets: [rect], interactions: { handlers } };
    const session = createSession(project, fakeHost());
    session.fireKey('keydown', 'ArrowLeft');
    expect(session.vars().get('left')).toBe(true);
    expect(session.vars().has('right')).toBe(false);
  });

  it('hoverEnter/hoverLeave via pointerAt chain diffs; no spurious leave/enter for a shared group', () => {
    const group = createSceneObject('', { id: 'g1', isGroup: true });
    const leafA = createSceneObject(rect.id, {
      id: 'a',
      parentId: 'g1',
      behaviors: [
        { id: 'aEnter', event: 'hoverEnter', actions: [{ kind: 'setVar', args: { name: 'log', value: 'log + "aEnter;"' } }] },
        { id: 'aLeave', event: 'hoverLeave', actions: [{ kind: 'setVar', args: { name: 'log', value: 'log + "aLeave;"' } }] },
      ],
    });
    const leafB = createSceneObject(rect.id, {
      id: 'b',
      parentId: 'g1',
      behaviors: [
        { id: 'bEnter', event: 'hoverEnter', actions: [{ kind: 'setVar', args: { name: 'log', value: 'log + "bEnter;"' } }] },
        { id: 'bLeave', event: 'hoverLeave', actions: [{ kind: 'setVar', args: { name: 'log', value: 'log + "bLeave;"' } }] },
      ],
    });
    group.behaviors = [
      { id: 'gEnter', event: 'hoverEnter', actions: [{ kind: 'setVar', args: { name: 'log', value: 'log + "gEnter;"' } }] },
      { id: 'gLeave', event: 'hoverLeave', actions: [{ kind: 'setVar', args: { name: 'log', value: 'log + "gLeave;"' } }] },
    ];
    const project: Project = {
      ...createProject(),
      assets: [rect],
      objects: [leafA, leafB, group],
      interactions: { variables: [{ name: 'log', initial: '' }] },
    };
    const session = createSession(project, fakeHost());

    session.pointerAt(['a', 'g1']);
    expect(session.vars().get('log')).toBe('aEnter;gEnter;');

    // Move to sibling leaf b, still within group g1 — no spurious group leave/enter.
    session.pointerAt(['b', 'g1']);
    expect(session.vars().get('log')).toBe('aEnter;gEnter;aLeave;bEnter;');

    session.pointerAt(null);
    expect(session.vars().get('log')).toBe('aEnter;gEnter;aLeave;bEnter;bLeave;gLeave;');
  });

  it("reset() clears hover without synthetic hoverLeave", () => {
    const leafA = createSceneObject(rect.id, {
      id: 'a',
      behaviors: [
        { id: 'aLeave', event: 'hoverLeave', actions: [{ kind: 'setVar', args: { name: 'log', value: 'log + "aLeave;"' } }] },
      ],
    });
    const project: Project = {
      ...createProject(),
      assets: [rect],
      objects: [leafA],
      interactions: { variables: [{ name: 'log', initial: '' }] },
    };
    const session = createSession(project, fakeHost());
    session.pointerAt(['a']);
    session.reset();
    expect(session.vars().get('log')).toBe(''); // no synthetic hoverLeave fired
    // Confirm hover state was actually cleared: re-entering 'a' fires hoverEnter's absence of a
    // spurious leave means a subsequent leave-of-'a' should fire once more (not be suppressed).
    session.pointerAt(['a']);
    session.pointerAt(null);
    expect(session.vars().get('log')).toBe('aLeave;');
  });
});

describe('createSession — onChange', () => {
  it('fires when vars/overrides change, not for a no-op event; unsub works', () => {
    const obj = behaviorObject('o1', [
      { id: 'b1', event: 'click', actions: [{ kind: 'setVar', args: { name: 'x', value: '1' } }] },
      { id: 'b2', event: 'pointerup', actions: [] }, // no-op
    ]);
    const project = withBehaviors([obj]);
    const session = createSession(project, fakeHost());
    const cb = vi.fn();
    const unsub = session.onChange(cb);

    session.firePointer('pointerup', ['o1']); // no-op, no vars/overrides change
    expect(cb).not.toHaveBeenCalled();

    session.firePointer('click', ['o1']);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    session.firePointer('click', ['o1']);
    expect(cb).toHaveBeenCalledTimes(1); // still 1, unsub worked
  });
});
