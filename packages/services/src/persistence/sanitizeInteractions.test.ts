import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject, createVectorAsset } from '@savig/engine';
import type { Behavior, BehaviorAction, InteractionModel, Project, Scene, SceneObject } from '@savig/engine';
import { sanitizeInteractionsModel } from './sanitizeInteractions';

function project(overrides: Partial<Project> = {}): Project {
  return { ...createProject({ name: 'Sanitize' }), ...overrides };
}

function behavior(overrides: Partial<Behavior> = {}): Behavior {
  return { id: 'b1', event: 'click', actions: [], ...overrides };
}

function action(overrides: Partial<BehaviorAction> = {}): BehaviorAction {
  return { kind: 'play', ...overrides };
}

function objectWithBehaviors(behaviors: unknown): SceneObject {
  const asset = createVectorAsset('rect');
  const obj = createSceneObject(asset.id, { name: 'o' });
  return { ...obj, behaviors: behaviors as Behavior[] };
}

describe('sanitizeInteractionsModel — identity / parity', () => {
  it('leaves a project with NO interactions and NO object behaviors byte-identical (=== same reference)', () => {
    const p = project({ objects: [createSceneObject(createVectorAsset('rect').id, { name: 'o' })] });
    const out = sanitizeInteractionsModel(p);
    expect(out).toBe(p);
  });

  it('leaves an entirely-valid interactions model + object behaviors byte-identical (=== same reference)', () => {
    const obj = objectWithBehaviors([behavior({ id: 'b1', event: 'click', actions: [action({ kind: 'play' })] })]);
    const p = project({
      objects: [obj],
      interactions: {
        variables: [{ name: 'score', initial: 0 }],
        handlers: [behavior({ id: 'h1', event: 'tick', actions: [action({ kind: 'pause' })] })],
      },
    });
    const out = sanitizeInteractionsModel(p);
    expect(out).toBe(p);
    expect(out.objects[0]).toBe(obj);
    expect(out.interactions).toBe(p.interactions);
  });
});

describe('sanitizeInteractionsModel — object behaviors located wherever they live', () => {
  it('sanitizes a behavior on a root-level object', () => {
    const obj = objectWithBehaviors([behavior({ event: 'bogus' as unknown as Behavior['event'] })]);
    const p = project({ objects: [obj] });
    const out = sanitizeInteractionsModel(p);
    expect(out.objects[0].behaviors).toEqual([]);
  });

  it('sanitizes a behavior on an object living inside scenes[i].objects', () => {
    const obj = objectWithBehaviors([behavior({ event: 'bogus' as unknown as Behavior['event'] })]);
    const scene: Scene = { id: 's1', name: 'Scene 1', objects: [obj], duration: 1 };
    const p = project({ scenes: [scene] });
    const out = sanitizeInteractionsModel(p);
    expect(out.scenes![0].objects[0].behaviors).toEqual([]);
  });
});

describe('sanitizeInteractionsModel — unknown event/action kinds dropped', () => {
  it('drops an object behavior with an unknown `event`', () => {
    const obj = objectWithBehaviors([
      behavior({ id: 'good', event: 'click' }),
      behavior({ id: 'bad', event: 'nonsense' as unknown as Behavior['event'] }),
    ]);
    const p = project({ objects: [obj] });
    const out = sanitizeInteractionsModel(p);
    expect(out.objects[0].behaviors).toHaveLength(1);
    expect(out.objects[0].behaviors![0].id).toBe('good');
  });

  it('drops an action with an unknown `kind`', () => {
    const obj = objectWithBehaviors([
      behavior({ actions: [action({ kind: 'play' }), action({ kind: 'nuke' as unknown as BehaviorAction['kind'] })] }),
    ]);
    const p = project({ objects: [obj] });
    const out = sanitizeInteractionsModel(p);
    expect(out.objects[0].behaviors![0].actions).toEqual([{ kind: 'play' }]);
  });

  it('pointer kind in `interactions.handlers` is NOT the sanitizer\'s job — kept verbatim', () => {
    const p = project({ interactions: { handlers: [behavior({ id: 'h1', event: 'click' })] } });
    const out = sanitizeInteractionsModel(p);
    expect(out.interactions!.handlers![0].event).toBe('click');
  });

  it('global kind on an OBJECT behavior is NOT the sanitizer\'s job — kept verbatim', () => {
    const obj = objectWithBehaviors([behavior({ event: 'tick' })]);
    const p = project({ objects: [obj] });
    const out = sanitizeInteractionsModel(p);
    expect(out.objects[0].behaviors![0].event).toBe('tick');
  });
});

describe('sanitizeInteractionsModel — args', () => {
  it('a 9-entry args object truncates to the first 8 (stable order) — a valid key past position 8 is lost to the cap, not spared by its own validity', () => {
    const args: Record<string, string> = {};
    for (let i = 1; i <= 6; i++) args[`junk${i}`] = 'x'; // positions 1..6
    args.targetId = 'obj1'; // position 7
    args.dx = '1'; // position 8
    args.dy = '2'; // position 9 -> truncated away by the entries cap, even though it's a known key
    const obj = objectWithBehaviors([behavior({ actions: [action({ kind: 'setPosition', args })] })]);
    const p = project({ objects: [obj] });
    const out = sanitizeInteractionsModel(p);
    expect(out.objects[0].behaviors![0].actions[0].args).toEqual({ targetId: 'obj1', dx: '1' });
  });

  it('drops an arg key not in the kind\'s known set', () => {
    const obj = objectWithBehaviors([behavior({ actions: [action({ kind: 'seek', args: { time: '1', bogus: 'x' } })] })]);
    const p = project({ objects: [obj] });
    const out = sanitizeInteractionsModel(p);
    expect(out.objects[0].behaviors![0].actions[0].args).toEqual({ time: '1' });
  });

  it('gotoScene keeps sceneId', () => {
    const obj = objectWithBehaviors([behavior({ actions: [action({ kind: 'gotoScene', args: { sceneId: 's1', extra: 'x' } })] })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(out.objects[0].behaviors![0].actions[0].args).toEqual({ sceneId: 's1' });
  });

  it('setVar keeps name+value; setOpacity/setText keep targetId+value; show/hide keep targetId only', () => {
    const obj = objectWithBehaviors([
      behavior({
        id: 'b1',
        actions: [
          action({ kind: 'setVar', args: { name: 'n', value: '1', bogus: 'x' } }),
          action({ kind: 'setOpacity', args: { targetId: 't', value: '0.5', bogus: 'x' } }),
          action({ kind: 'setText', args: { targetId: 't', value: 'hi', bogus: 'x' } }),
          action({ kind: 'show', args: { targetId: 't', bogus: 'x' } }),
          action({ kind: 'hide', args: { targetId: 't', bogus: 'x' } }),
        ],
      }),
    ]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    const acts = out.objects[0].behaviors![0].actions;
    expect(acts[0].args).toEqual({ name: 'n', value: '1' });
    expect(acts[1].args).toEqual({ targetId: 't', value: '0.5' });
    expect(acts[2].args).toEqual({ targetId: 't', value: 'hi' });
    expect(acts[3].args).toEqual({ targetId: 't' });
    expect(acts[4].args).toEqual({ targetId: 't' });
  });

  it('play/pause/stop strip ALL args (their known set is empty)', () => {
    const obj = objectWithBehaviors([behavior({ actions: [action({ kind: 'play', args: { anything: 'x' } })] })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(out.objects[0].behaviors![0].actions[0].args).toEqual({});
  });

  it('truncates an oversized arg VALUE to 500 chars (survives, length-capped)', () => {
    const long = 'x'.repeat(600);
    const obj = objectWithBehaviors([behavior({ actions: [action({ kind: 'seek', args: { time: long } })] })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(out.objects[0].behaviors![0].actions[0].args!.time).toBe('x'.repeat(500));
  });

  it('drops a non-string arg value', () => {
    const obj = objectWithBehaviors([
      behavior({ actions: [action({ kind: 'seek', args: { time: 42 as unknown as string } })] }),
    ]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(out.objects[0].behaviors![0].actions[0].args).toEqual({});
  });

  it('drops a non-object `args` shape entirely (field removed)', () => {
    const obj = objectWithBehaviors([
      behavior({ actions: [{ kind: 'play', args: 'nope' as unknown as Record<string, string> }] }),
    ]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect('args' in out.objects[0].behaviors![0].actions[0]).toBe(false);
  });
});

describe('sanitizeInteractionsModel — the `if` guard expression', () => {
  it('truncates an oversized `if` expression to 500 chars', () => {
    const long = 'x'.repeat(600);
    const obj = objectWithBehaviors([behavior({ actions: [{ kind: 'play', if: long }] })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(out.objects[0].behaviors![0].actions[0].if).toBe('x'.repeat(500));
  });

  it('drops a non-string `if`', () => {
    const obj = objectWithBehaviors([behavior({ actions: [{ kind: 'play', if: 42 as unknown as string }] })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect('if' in out.objects[0].behaviors![0].actions[0]).toBe(false);
  });
});

describe('sanitizeInteractionsModel — hostile-unicode names/keys survive only length-capped', () => {
  it('truncates a behavior.key beyond 32 chars (survives, not dropped)', () => {
    const long = '💥'.repeat(50);
    const obj = objectWithBehaviors([behavior({ event: 'keydown', key: long })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(out.objects[0].behaviors![0].key).toBe(long.slice(0, 32));
    expect(out.objects[0].behaviors![0].key!.length).toBe(32);
  });

  it('truncates a variable name beyond 64 chars (survives, not dropped)', () => {
    const long = 'ë'.repeat(100);
    const p = project({ interactions: { variables: [{ name: long, initial: 1 }] } });
    const out = sanitizeInteractionsModel(p);
    expect(out.interactions!.variables![0].name).toBe(long.slice(0, 64));
    expect(out.interactions!.variables![0].name.length).toBe(64);
  });

  it('drops a non-string behavior.key', () => {
    const obj = objectWithBehaviors([behavior({ event: 'keydown', key: 42 as unknown as string })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect('key' in out.objects[0].behaviors![0]).toBe(false);
  });

  it('drops a non-string sceneId', () => {
    const obj = objectWithBehaviors([behavior({ event: 'sceneStart', sceneId: 42 as unknown as string })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect('sceneId' in out.objects[0].behaviors![0]).toBe(false);
  });
});

describe('sanitizeInteractionsModel — hostile __proto__ keys never pollute Object.prototype', () => {
  it('a behavior object literally carrying a "__proto__" own-property (JSON.parse shape) does not pollute', () => {
    const hostile = JSON.parse('{"id":"b1","event":"click","actions":[],"__proto__":{"polluted":true}}') as Behavior;
    const obj = objectWithBehaviors([hostile]);
    sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('an args object literally carrying a "__proto__" own-property does not pollute, and is dropped as an unknown key', () => {
    const hostileArgs = JSON.parse('{"time":"1","__proto__":{"polluted":true}}') as Record<string, string>;
    const obj = objectWithBehaviors([behavior({ actions: [action({ kind: 'seek', args: hostileArgs })] })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out.objects[0].behaviors![0].actions[0].args).toEqual({ time: '1' });
  });
});

describe('sanitizeInteractionsModel — non-array shapes never throw (behaviors/handlers/variables)', () => {
  it('drops object.behaviors entirely when it is not an array, and does not throw', () => {
    const obj = objectWithBehaviors({} as unknown);
    const p = project({ objects: [obj] });
    expect(() => sanitizeInteractionsModel(p)).not.toThrow();
    const out = sanitizeInteractionsModel(p);
    expect('behaviors' in out.objects[0]).toBe(false);
  });

  it('drops interactions.handlers entirely when it is not an array, and does not throw', () => {
    const p = project({ interactions: { handlers: {} as unknown as Behavior[] } });
    expect(() => sanitizeInteractionsModel(p)).not.toThrow();
    const out = sanitizeInteractionsModel(p);
    expect('handlers' in out.interactions!).toBe(false);
  });

  it('drops interactions.variables entirely when it is not an array, and does not throw', () => {
    const p = project({ interactions: { variables: {} as unknown as InteractionModel['variables'] } });
    expect(() => sanitizeInteractionsModel(p)).not.toThrow();
    const out = sanitizeInteractionsModel(p);
    expect('variables' in out.interactions!).toBe(false);
  });

  it('drops interactions entirely when it is not an object, and does not throw', () => {
    const p = project({ interactions: 'nope' as unknown as InteractionModel });
    expect(() => sanitizeInteractionsModel(p)).not.toThrow();
    const out = sanitizeInteractionsModel(p);
    expect('interactions' in out).toBe(false);
  });

  it('malformed behavior entries (not an object / missing id / non-array actions) are dropped, valid ones kept', () => {
    const obj = objectWithBehaviors([
      42,
      { event: 'click', actions: [] }, // missing id
      { id: 'b1', event: 'click', actions: 'nope' }, // actions not an array
      behavior({ id: 'good' }),
    ]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(out.objects[0].behaviors).toHaveLength(1);
    expect(out.objects[0].behaviors![0].id).toBe('good');
  });
});

describe('sanitizeInteractionsModel — non-scalar variable initials dropped', () => {
  it('drops a variable whose initial is an object/array/null', () => {
    const p = project({
      interactions: {
        variables: [
          { name: 'ok', initial: 1 },
          { name: 'bad1', initial: { x: 1 } as unknown as number },
          { name: 'bad2', initial: [1, 2] as unknown as number },
          { name: 'bad3', initial: null as unknown as number },
        ],
      },
    });
    const out = sanitizeInteractionsModel(p);
    expect(out.interactions!.variables).toEqual([{ name: 'ok', initial: 1 }]);
  });
});

describe('sanitizeInteractionsModel — count caps', () => {
  it('caps object behaviors at 64, keeping the first 64', () => {
    const behaviors = Array.from({ length: 70 }, (_, i) => behavior({ id: `b${i}` }));
    const obj = objectWithBehaviors(behaviors);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(out.objects[0].behaviors).toHaveLength(64);
    expect(out.objects[0].behaviors![0].id).toBe('b0');
    expect(out.objects[0].behaviors![63].id).toBe('b63');
  });

  it('caps global handlers at 256, keeping the first 256', () => {
    const handlers = Array.from({ length: 300 }, (_, i) => behavior({ id: `h${i}`, event: 'tick' }));
    const p = project({ interactions: { handlers } });
    const out = sanitizeInteractionsModel(p);
    expect(out.interactions!.handlers).toHaveLength(256);
    expect(out.interactions!.handlers![0].id).toBe('h0');
  });

  it('caps actions per behavior at 32, keeping the first 32', () => {
    const actions = Array.from({ length: 40 }, () => action({ kind: 'play' }));
    const obj = objectWithBehaviors([behavior({ actions })]);
    const out = sanitizeInteractionsModel(project({ objects: [obj] }));
    expect(out.objects[0].behaviors![0].actions).toHaveLength(32);
  });

  it('caps declared variables at 64, keeping the first 64', () => {
    const variables = Array.from({ length: 70 }, (_, i) => ({ name: `v${i}`, initial: i }));
    const p = project({ interactions: { variables } });
    const out = sanitizeInteractionsModel(p);
    expect(out.interactions!.variables).toHaveLength(64);
    expect(out.interactions!.variables![0].name).toBe('v0');
  });
});
