import { describe, it, expect } from 'vitest';
import { createProject } from '@savig/engine';
import { tools, type Session, type ToolResult } from './tools';

const tool = (name: string) => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const textOf = (r: ToolResult) => r.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
const imageOf = (r: ToolResult) => r.content.find((c) => c.type === 'image') as { data: string } | undefined;

function freshSession(): Session {
  return { project: createProject() };
}

describe('mcp/tools', () => {
  it('every tool has a name, description, and object inputSchema', () => {
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(10);
      expect((t.inputSchema as { type: string }).type).toBe('object');
    }
  });

  it('new_short resets the working project and returns a describe + thumbnail', () => {
    const s = freshSession();
    const r = tool('new_short').run(s, { name: 'Demo', width: 320, height: 240, fps: 24 });
    expect(s.project.meta.name).toBe('Demo');
    expect(s.project.meta.width).toBe(320);
    expect(textOf(r)).toContain('"Demo"');
    expect(imageOf(r)).toBeTruthy(); // thumbnail PNG present
    expect(imageOf(r)!.data).toMatch(/^iVBOR/); // base64 PNG magic
  });

  it('add_rect mutates the session and reports the new id', () => {
    const s = freshSession();
    const r = tool('add_rect').run(s, { x: 10, y: 20, width: 50, height: 50, id: 'box', fill: '#f00' });
    expect(s.project.objects.map((o) => o.id)).toEqual(['box']);
    const asset = s.project.assets.find((a) => a.id === 'box-asset')!;
    expect(asset.kind === 'vector' && asset.style.fill).toBe('#f00');
    expect(textOf(r)).toContain('box');
  });

  it('set_keyframe + describe reflect the animation', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_keyframe').run(s, { objectId: 'r', property: 'x', time: 0, value: 0 });
    tool('set_keyframe').run(s, { objectId: 'r', property: 'x', time: 2, value: 100, easing: 'easeInOut' });
    expect(s.project.objects[0].tracks.x!.map((k) => k.time)).toEqual([0, 2]);
    expect(textOf(tool('describe').run(s, {}))).toContain('x@[0,2]');
  });

  it("set_keyframe with a typo'd property surfaces the validation error", () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    expect(() => tool('set_keyframe').run(s, { objectId: 'r', property: 'xPos', time: 0, value: 0 })).toThrow(
      /savig\/core: unknown animatable property "xPos"/,
    );
    expect(s.project.objects[0].tracks).toEqual({});
  });

  it('move_to and fade macros mutate via the session', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('move_to').run(s, { objectId: 'r', x: 200, duration: 1 });
    expect(s.project.objects[0].tracks.x!.map((k) => k.value)).toEqual([0, 200]);
    tool('fade').run(s, { objectId: 'r', direction: 'in', duration: 0.5 });
    expect(s.project.objects[0].tracks.opacity!.map((k) => k.value)).toEqual([0, 1]);
  });

  it('load_dsl compiles a ShortDoc into the session', () => {
    const s = freshSession();
    const r = tool('load_dsl').run(s, { doc: { meta: { name: 'X' }, objects: [{ type: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 }] } });
    expect(s.project.objects.map((o) => o.id)).toEqual(['a']);
    expect(textOf(r)).toContain('no validation issues');
  });

  it('render_frame returns a PNG image', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r', fill: '#00f' });
    const r = tool('render_frame').run(s, { time: 0, width: 64 });
    expect(imageOf(r)!.data).toMatch(/^iVBOR/);
  });

  it('list_templates + load_template load a built-in short', () => {
    const s = freshSession();
    expect(textOf(tool('list_templates').run(s, {}))).toContain('bouncing-ball');
    const r = tool('load_template').run(s, { id: 'bouncing-ball' });
    expect(s.project.objects.some((o) => o.id === 'ball')).toBe(true);
    expect(imageOf(r)!.data).toMatch(/^iVBOR/);
    expect(tool('load_template').run(s, { id: 'nope' }).isError).toBe(true);
  });

  it('validate reports issues; export_svg + get_dsl return text', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 9999, y: 0, width: 10, height: 10, id: 'r' }); // off-artboard
    expect(textOf(tool('validate').run(s, {}))).toMatch(/off-artboard/);
    expect(textOf(tool('export_svg').run(s, {}))).toContain('<svg');
    expect(textOf(tool('get_dsl').run(s, {}))).toContain('"type": "rect"');
  });

  // --- Task 3: Session.currentSceneId + scene-aware routing ---

  it('load_dsl sets currentSceneId to first scene id for multi-scene doc', () => {
    const s = freshSession();
    tool('load_dsl').run(s, {
      doc: {
        scenes: [
          { duration: 2, objects: [] },
          { duration: 2, objects: [] },
        ],
      },
    });
    expect(s.currentSceneId).toBe(s.project.scenes![0].id);
  });

  it('single-scene object tools unchanged (parity)', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r1' });
    expect(s.project.objects.map((o) => o.id)).toEqual(['r1']);
    expect(s.project.scenes).toBeUndefined();
    expect(s.currentSceneId).toBeUndefined();
  });

  it('object tools write into the current scene when multi-scene', () => {
    const s = freshSession();
    // Drive multi-scene via load_dsl (Task 2) — sets currentSceneId = scenes[0].id
    tool('load_dsl').run(s, {
      doc: {
        scenes: [
          { duration: 2, objects: [{ type: 'rect', id: 'existing', x: 0, y: 0, width: 10, height: 10 }] },
          { duration: 2, objects: [] },
        ],
      },
    });
    const sceneId = s.currentSceneId!;
    expect(sceneId).toBeTruthy();
    // Add a rect — should land in the current scene (scenes[0]), not root
    tool('add_rect').run(s, { x: 5, y: 5, width: 20, height: 20, id: 'r1' });
    expect(s.project.objects).toEqual([]); // root stays empty
    const scene0 = s.project.scenes!.find((sc) => sc.id === sceneId)!;
    expect(scene0.objects.map((o) => o.id)).toContain('r1');
    // The other scene must NOT receive r1
    const scene1 = s.project.scenes!.find((sc) => sc.id !== sceneId)!;
    expect(scene1.objects.map((o) => o.id)).not.toContain('r1');
  });

  it('edited() thumbnail uses currentSceneTime (no error; returns PNG)', () => {
    const s = freshSession();
    tool('load_dsl').run(s, {
      doc: {
        scenes: [
          { duration: 1, objects: [] },
          { duration: 1, objects: [] },
        ],
      },
    });
    // Switch to scene 1 (start time = 1s)
    s.currentSceneId = s.project.scenes![1].id;
    const r = tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r2' });
    expect(imageOf(r)!.data).toMatch(/^iVBOR/); // thumbnail renders without error
  });

  // --- Task 4: scene tools ---

  it('add_scene promotes + selects the new scene; object adds then target it', () => {
    const s = freshSession();
    const r = tool('add_scene').run(s, { name: 'Intro', duration: 2 });
    expect(s.project.scenes!.length).toBe(2);          // root + new
    expect(s.currentSceneId).toBe(s.project.scenes![1].id);
    expect(imageOf(r)!.data).toMatch(/^iVBOR/);
  });

  it('select_scene switches the target; remove_scene reselects a survivor / demotes', () => {
    const s = freshSession();
    tool('add_scene').run(s, {});                       // 2 scenes, current = scene[1]
    const first = s.project.scenes![0].id;
    tool('select_scene').run(s, { sceneId: first });
    expect(s.currentSceneId).toBe(first);
    tool('remove_scene').run(s, { sceneId: s.project.scenes![1].id }); // remove the non-current → demote to single
    expect(s.project.scenes).toBeUndefined();
    expect(s.currentSceneId).toBeUndefined();
  });

  it('reorder_scene / set_scene_duration / set_scene_transition mutate the project', () => {
    const s = freshSession();
    tool('add_scene').run(s, {});
    const [a, b] = s.project.scenes!.map((sc) => sc.id);
    tool('reorder_scene').run(s, { sceneId: b, toIndex: 0 });
    expect(s.project.scenes!.map((sc) => sc.id)).toEqual([b, a]);
    tool('set_scene_duration').run(s, { sceneId: a, duration: 3 });
    expect(s.project.scenes!.find((sc) => sc.id === a)!.duration).toBe(3);
    tool('set_scene_transition').run(s, { sceneId: a, kind: 'dip', duration: 0.4, color: '#000' });
    expect(s.project.scenes!.find((sc) => sc.id === a)!.transitionIn).toEqual({ kind: 'dip', duration: 0.4, color: '#000' });
  });

  it('list_scenes lists ids/names/durations and marks the current scene', () => {
    const s = freshSession();
    tool('add_scene').run(s, { name: 'Two' });
    const out = textOf(tool('list_scenes').run(s, {}));   // textOf = first text content
    expect(out).toContain(s.currentSceneId!);
    expect(out).toMatch(/current|→|\*/i);                // some current-marker
  });

  it('select_scene throws on unknown id', () => {
    const s = freshSession();
    tool('add_scene').run(s, {});
    expect(() => tool('select_scene').run(s, { sceneId: 'nope' })).toThrow();
  });

  // --- Fix 1: export_svg routes multi-scene via renderProjectDocument ---

  it('export_svg returns non-empty SVG for a multi-scene session', () => {
    const s = freshSession();
    // Promote to multi-scene and add a rect into scene 1
    tool('add_scene').run(s, { name: 'Scene2', duration: 2 });
    // currentSceneId is now scenes[1] — add a rect into it
    tool('add_rect').run(s, { x: 10, y: 10, width: 40, height: 40, id: 'ms-rect', fill: '#0f0' });
    const svg = textOf(tool('export_svg').run(s, {}));
    // Must not be an empty document — must contain the shape element
    expect(svg).toContain('data-savig-object');
    expect(svg).toContain('ms-rect');
  });

  it('export_svg single-scene output is unchanged (parity)', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'solo', fill: '#f00' });
    const svg = textOf(tool('export_svg').run(s, {}));
    expect(svg).toContain('<svg');
    expect(svg).toContain('data-savig-object');
    expect(svg).toContain('solo');
  });

  // --- Task 7: export_svg defaults to SMIL-animated; animated:false = static snapshot ---

  it('export_svg returns SMIL-animated markup by default and static with animated:false', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_keyframe').run(s, { objectId: 'r', property: 'x', time: 0, value: 0 });
    tool('set_keyframe').run(s, { objectId: 'r', property: 'x', time: 1, value: 100 });
    const animated = textOf(tool('export_svg').run(s, {}));
    expect(animated).toContain('animateTransform');
    const still = textOf(tool('export_svg').run(s, { animated: false }));
    expect(still).not.toContain('animateTransform');
  });

  // --- Fix 2: set_scene_transition fail-loud on missing duration/color ---

  it('set_scene_transition throws when crossfade is given no duration', () => {
    const s = freshSession();
    tool('add_scene').run(s, {});
    const sceneId = s.project.scenes![0].id;
    expect(() => tool('set_scene_transition').run(s, { sceneId, kind: 'crossfade' })).toThrow(
      /duration/,
    );
  });

  it('set_scene_transition throws when dip is given no duration', () => {
    const s = freshSession();
    tool('add_scene').run(s, {});
    const sceneId = s.project.scenes![0].id;
    expect(() => tool('set_scene_transition').run(s, { sceneId, kind: 'dip', color: '#000' })).toThrow(
      /duration/,
    );
  });

  it('set_scene_transition throws when dip is given no color', () => {
    const s = freshSession();
    tool('add_scene').run(s, {});
    const sceneId = s.project.scenes![0].id;
    expect(() => tool('set_scene_transition').run(s, { sceneId, kind: 'dip', duration: 0.5 })).toThrow(
      /color/,
    );
  });

  it('set_scene_transition well-formed crossfade and dip still succeed', () => {
    const s = freshSession();
    tool('add_scene').run(s, {});
    const sceneId = s.project.scenes![0].id;
    // crossfade with duration
    tool('set_scene_transition').run(s, { sceneId, kind: 'crossfade', duration: 0.3 });
    expect(s.project.scenes!.find((sc) => sc.id === sceneId)!.transitionIn).toEqual({ kind: 'crossfade', duration: 0.3 });
    // dip with duration + color
    tool('set_scene_transition').run(s, { sceneId, kind: 'dip', duration: 0.5, color: '#fff' });
    expect(s.project.scenes!.find((sc) => sc.id === sceneId)!.transitionIn).toEqual({ kind: 'dip', duration: 0.5, color: '#fff' });
    // cut (no extra fields needed)
    tool('set_scene_transition').run(s, { sceneId, kind: 'cut' });
    expect(s.project.scenes!.find((sc) => sc.id === sceneId)!.transitionIn).toEqual({ kind: 'cut' });
  });

  // --- Task 12: set_trim / draw_on ---

  it('set_trim without time sets the base trim value', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_trim').run(s, { objectId: 'r', prop: 'end', value: 0.5 });
    expect(s.project.objects[0].trim?.end).toBe(0.5);
  });

  it('set_trim with time upserts a trim keyframe', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_trim').run(s, { objectId: 'r', prop: 'end', value: 0.75, time: 1, easing: 'easeInOut' });
    expect(s.project.objects[0].trim?.endTrack?.map((k) => k.time)).toEqual([1]);
    expect(s.project.objects[0].trim?.endTrack?.map((k) => k.value)).toEqual([0.75]);
  });

  it('draw_on produces a two-keyframe end trim track', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('draw_on').run(s, { objectId: 'r', start: 0, duration: 1 });
    expect(s.project.objects[0].trim?.endTrack?.map((k) => k.time)).toEqual([0, 1]);
    expect(s.project.objects[0].trim?.endTrack?.map((k) => k.value)).toEqual([0, 1]);
  });

  it('set_trim and draw_on respect session.currentSceneId', () => {
    const s = freshSession();
    tool('add_scene').run(s, { name: 'Two' });
    const sceneId = s.currentSceneId!;
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_trim').run(s, { objectId: 'r', prop: 'start', value: 0.2 });
    tool('draw_on').run(s, { objectId: 'r' });
    expect(s.project.objects).toEqual([]); // root stays empty
    const scene = s.project.scenes!.find((sc) => sc.id === sceneId)!;
    const obj = scene.objects.find((o) => o.id === 'r')!;
    expect(obj.trim?.start).toBe(0.2);
    expect(obj.trim?.endTrack?.map((k) => k.value)).toEqual([0, 1]);
  });

  // --- Task 6: set_repeat ---

  it('set_repeat merges a partial spec over defaults', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_repeat').run(s, { objectId: 'r', count: 4, dx: 10 });
    expect(s.project.objects[0].repeat).toEqual({ count: 4, dx: 10, dy: 0, rotate: 0, scale: 1, stagger: 0 });
  });

  it('set_repeat with count <= 1 clears the repeat', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_repeat').run(s, { objectId: 'r', count: 3 });
    expect(s.project.objects[0].repeat).toBeDefined();
    tool('set_repeat').run(s, { objectId: 'r', count: 1 });
    expect(s.project.objects[0].repeat).toBeUndefined();
  });

  it('set_repeat respects session.currentSceneId', () => {
    const s = freshSession();
    tool('add_scene').run(s, { name: 'Two' });
    const sceneId = s.currentSceneId!;
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_repeat').run(s, { objectId: 'r', count: 3, stagger: 0.2 });
    expect(s.project.objects).toEqual([]); // root stays empty
    const scene = s.project.scenes!.find((sc) => sc.id === sceneId)!;
    const obj = scene.objects.find((o) => o.id === 'r')!;
    expect(obj.repeat).toEqual({ count: 3, dx: 0, dy: 0, rotate: 0, scale: 1, stagger: 0.2 });
  });

  // --- Task 3 (outline-stroke): outline_stroke ---

  it('outline_stroke swaps a path\'s stroke for filled geometry', () => {
    const s = freshSession();
    tool('load_dsl').run(s, {
      doc: {
        objects: [
          {
            type: 'path',
            id: 'p',
            path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
            style: { fill: 'none', stroke: '#000000', strokeWidth: 2 },
          },
        ],
      },
    });
    expect(s.currentSceneId).toBeUndefined(); // single-scene (parity)

    tool('outline_stroke').run(s, { objectId: 'p' });

    const obj = s.project.objects.find((o) => o.id === 'p')!;
    const asset = s.project.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.kind === 'vector' && asset.style.fill).toBe('#000000');
    expect(asset.kind === 'vector' && asset.style.stroke).toBe('none');
    expect(obj.anchorMode).toBe('absolute'); // pinned by the outline
  });

  it('outline_stroke respects session.currentSceneId (scene-scoped routing)', () => {
    const s = freshSession();
    tool('load_dsl').run(s, {
      doc: {
        scenes: [
          {
            duration: 2,
            objects: [
              {
                type: 'path',
                id: 'p',
                path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
                style: { fill: 'none', stroke: '#000000', strokeWidth: 2 },
              },
            ],
          },
          { duration: 2, objects: [] },
        ],
      },
    });
    const sceneId = s.currentSceneId!;
    expect(sceneId).toBe(s.project.scenes![0].id);

    tool('outline_stroke').run(s, { objectId: 'p' });

    expect(s.project.objects).toEqual([]); // root stays empty
    const scene = s.project.scenes!.find((sc) => sc.id === sceneId)!;
    const obj = scene.objects.find((o) => o.id === 'p')!;
    const asset = s.project.assets.find((a) => a.id === obj.assetId)!; // assets are project-level, not per-scene
    expect(asset.kind === 'vector' && asset.style.fill).toBe('#000000');
    // The other scene must be untouched.
    const scene1 = s.project.scenes!.find((sc) => sc.id !== sceneId)!;
    expect(scene1.objects).toEqual([]);
  });

  it('outline_stroke surfaces the builder\'s gate error (no visible stroke) as a thrown error', () => {
    const s = freshSession();
    tool('load_dsl').run(s, {
      doc: {
        objects: [
          {
            type: 'path',
            id: 'p',
            path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
            style: { fill: 'none', stroke: 'none', strokeWidth: 0 },
          },
        ],
      },
    });
    expect(() => tool('outline_stroke').run(s, { objectId: 'p' })).toThrow(/no visible stroke/);
  });

  // --- Task 3 (blend): blend ---

  function loadTwoPathsForBlend(s: Session): void {
    tool('load_dsl').run(s, {
      doc: {
        objects: [
          {
            type: 'path',
            id: 'a',
            path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
            style: { fill: 'none', stroke: '#000000', strokeWidth: 1 },
          },
          {
            type: 'path',
            id: 'b',
            path: { closed: false, nodes: [{ anchor: { x: 0, y: 40 } }, { anchor: { x: 100, y: 40 } }] },
            style: { fill: 'none', stroke: '#000000', strokeWidth: 1 },
          },
        ],
      },
    });
  }

  it('blend creates count new intermediate path objects between aId and bId', () => {
    const s = freshSession();
    loadTwoPathsForBlend(s);
    const before = s.project.objects.length;

    const r = tool('blend').run(s, { aId: 'a', bId: 'b', count: 3 });

    expect(s.project.objects.length).toBe(before + 3);
    const newObjs = s.project.objects.filter((o) => o.name.startsWith('Blend '));
    expect(newObjs).toHaveLength(3);
    expect(textOf(r)).toContain('Blended "a" -> "b" into 3 object(s).');
    expect(imageOf(r)).toBeTruthy();
  });

  it('blend respects session.currentSceneId (scene-scoped routing)', () => {
    const s = freshSession();
    tool('load_dsl').run(s, {
      doc: {
        scenes: [
          {
            duration: 2,
            objects: [
              {
                type: 'path',
                id: 'a',
                path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
                style: { fill: 'none', stroke: '#000000', strokeWidth: 1 },
              },
              {
                type: 'path',
                id: 'b',
                path: { closed: false, nodes: [{ anchor: { x: 0, y: 40 } }, { anchor: { x: 100, y: 40 } }] },
                style: { fill: 'none', stroke: '#000000', strokeWidth: 1 },
              },
            ],
          },
          { duration: 2, objects: [] },
        ],
      },
    });
    const sceneId = s.currentSceneId!;

    tool('blend').run(s, { aId: 'a', bId: 'b', count: 2 });

    expect(s.project.objects).toEqual([]); // root stays empty
    const scene = s.project.scenes!.find((sc) => sc.id === sceneId)!;
    expect(scene.objects.filter((o) => o.name.startsWith('Blend '))).toHaveLength(2);
    const scene1 = s.project.scenes!.find((sc) => sc.id !== sceneId)!;
    expect(scene1.objects).toEqual([]); // the other scene is untouched
  });

  it('blend rejects a bad easing value with a clear error, without mutating the session', () => {
    const s = freshSession();
    loadTwoPathsForBlend(s);
    const before = s.project;

    const r = tool('blend').run(s, { aId: 'a', bId: 'b', count: 2, easing: 'bounce' });

    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/invalid easing/);
    expect(s.project).toBe(before); // no mutation on rejection
  });

  it('blend accepts each of the 4 named easings', () => {
    for (const easing of ['linear', 'easeIn', 'easeOut', 'easeInOut']) {
      const s = freshSession();
      loadTwoPathsForBlend(s);
      const r = tool('blend').run(s, { aId: 'a', bId: 'b', count: 1, easing });
      expect(r.isError).toBeFalsy();
    }
  });

  it('blend surfaces the builder\'s gate error (ineligible target) as a thrown error', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    expect(() => tool('blend').run(s, { aId: 'r', bId: 'r', count: 2 })).toThrow(/not a vector path/);
  });

  // Task 1 hardening: `count` is a raw MCP input (agent-supplied, no schema-level integer/range
  // enforcement) — sanitize it in the tool itself rather than trusting it straight into
  // blendPaths (which only guards `count >= 1`, not fractional/absurd/non-finite values).
  it('blend floors a fractional count (2.5 -> 2 intermediates), no error', () => {
    const s = freshSession();
    loadTwoPathsForBlend(s);

    const r = tool('blend').run(s, { aId: 'a', bId: 'b', count: 2.5 });

    expect(r.isError).toBeFalsy();
    const newObjs = s.project.objects.filter((o) => o.name.startsWith('Blend '));
    expect(newObjs).toHaveLength(2);
  });

  it('blend rejects an out-of-range or non-finite count with a clear error naming the 1..100 bound, without mutating the session', () => {
    const s = freshSession();
    loadTwoPathsForBlend(s);
    const before = s.project;

    const rHuge = tool('blend').run(s, { aId: 'a', bId: 'b', count: 1e6 });
    expect(rHuge.isError).toBe(true);
    expect(textOf(rHuge)).toMatch(/1.*100/);
    expect(s.project).toBe(before);

    const rNaN = tool('blend').run(s, { aId: 'a', bId: 'b', count: NaN });
    expect(rNaN.isError).toBe(true);
    expect(textOf(rNaN)).toMatch(/1.*100/);
    expect(s.project).toBe(before);
    expect(s.project.objects.filter((o) => o.name.startsWith('Blend '))).toHaveLength(0);
  });
});

// --- Task 5 (animatable-primitives): MCP pin — `set_keyframe`'s `property` input is a plain
// string (no enum), so an animatable-primitive property name like `starPoints` lands on
// `obj.tracks.starPoints` via the same generic path as `x`/`opacity`/etc., with no MCP-specific
// support needed. ---
describe('mcp/tools animatable primitives', () => {
  it('set_keyframe with property "starPoints" lands on obj.tracks.starPoints', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_keyframe').run(s, { objectId: 'r', property: 'starPoints', time: 0, value: 5 });
    tool('set_keyframe').run(s, { objectId: 'r', property: 'starPoints', time: 2, value: 9, easing: 'easeInOut' });
    expect(s.project.objects[0].tracks.starPoints!.map((k) => k.time)).toEqual([0, 2]);
    expect(s.project.objects[0].tracks.starPoints!.map((k) => k.value)).toEqual([5, 9]);
    expect(s.project.objects[0].tracks.starPoints![1].easing).toBe('easeInOut');
    expect(textOf(tool('describe').run(s, {}))).toContain('starPoints@[0,2]');
  });
});

// --- Friction fixes (2026-08-14): the imperative surface could not draw a line — a stick figure
// (or any stroke art) was unreachable without load_dsl — and could not move a rotation pivot off
// the bbox centre. add_path/add_line/set_anchor close both gaps. ---
describe('mcp/tools add_path / add_line / set_anchor', () => {
  it('add_path adds a normalized path leaf with base at the bbox top-left', () => {
    const s = freshSession();
    const r = tool('add_path').run(s, {
      path: { closed: false, nodes: [{ anchor: { x: 30, y: 40 } }, { anchor: { x: 80, y: 90 } }] },
      id: 'seg',
      stroke: '#123456',
      strokeWidth: 5,
    });
    const o = s.project.objects.find((x) => x.id === 'seg')!;
    expect([o.base.x, o.base.y]).toEqual([30, 40]);
    const asset = s.project.assets.find((a) => a.id === o.assetId)!;
    expect(asset.kind === 'vector' && asset.style.stroke).toBe('#123456');
    expect(textOf(r)).toContain('seg');
  });

  it('add_line adds a 2-node open path with a visible stroke by default', () => {
    const s = freshSession();
    tool('add_line').run(s, { x1: 10, y1: 20, x2: 10, y2: 80, id: 'limb' });
    const o = s.project.objects.find((x) => x.id === 'limb')!;
    const asset = s.project.assets.find((a) => a.id === o.assetId)!;
    if (asset.kind !== 'vector') throw new Error('expected vector asset');
    expect(asset.path!.nodes).toHaveLength(2);
    expect(asset.path!.closed).toBe(false);
    expect(asset.style.stroke).not.toBe('none'); // visible with zero style args
    expect(asset.style.strokeWidth).toBeGreaterThan(0);
  });

  it('set_anchor moves the pivot, keeping the builder anchorMode when mode is omitted', () => {
    const s = freshSession();
    tool('add_line').run(s, { x1: 0, y1: 0, x2: 0, y2: 40, id: 'limb' });
    tool('set_anchor').run(s, { objectId: 'limb', x: 0.5, y: 0 }); // pivot at the joint end
    const o = s.project.objects.find((x) => x.id === 'limb')!;
    expect([o.anchorX, o.anchorY, o.anchorMode]).toEqual([0.5, 0, 'fraction']);
  });

  it('set_anchor with mode switches to absolute units', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('set_anchor').run(s, { objectId: 'r', x: 5, y: 10, mode: 'absolute' });
    const o = s.project.objects[0];
    expect([o.anchorX, o.anchorY, o.anchorMode]).toEqual([5, 10, 'absolute']);
  });

  it('set_anchor throws on an unknown object id', () => {
    expect(() => tool('set_anchor').run(freshSession(), { objectId: 'nope', x: 0, y: 0 })).toThrow(/nope/);
  });

  it('add_line and set_anchor target the current scene when multi-scene', () => {
    const s = freshSession();
    tool('load_dsl').run(s, { doc: { scenes: [{ duration: 2, objects: [] }, { duration: 2, objects: [] }] } });
    const sceneId = s.currentSceneId!;
    tool('add_line').run(s, { x1: 0, y1: 0, x2: 10, y2: 10, id: 'l1' });
    tool('set_anchor').run(s, { objectId: 'l1', x: 0, y: 0, mode: 'absolute' });
    expect(s.project.objects).toEqual([]); // root stays empty
    const scene0 = s.project.scenes!.find((sc) => sc.id === sceneId)!;
    const l1 = scene0.objects.find((o) => o.id === 'l1')!;
    expect(l1.anchorMode).toBe('absolute');
    const scene1 = s.project.scenes!.find((sc) => sc.id !== sceneId)!;
    expect(scene1.objects.map((o) => o.id)).not.toContain('l1');
  });

  it('add_path rejects a malformed path with a clear error (no raw TypeError)', () => {
    const s = freshSession();
    const r = tool('add_path').run(s, { path: { closed: false } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/nodes/);
    expect(s.project.objects).toEqual([]); // nothing half-added
  });
});

describe('mcp/tools multitrack audio', () => {
  function withAudioAsset(s: Session): void {
    s.project = { ...s.project, assets: [...s.project.assets, { id: 'a1', kind: 'audio', name: 'a1', mimeType: 'audio/mpeg', duration: 10 }] };
  }

  it('add_audio_track adds a track with defaults and reports the new id', () => {
    const s = freshSession();
    const r = tool('add_audio_track').run(s, {});
    expect(s.project.audioTracks).toHaveLength(1);
    const t = s.project.audioTracks![0];
    expect(t.name).toBe('Audio 1');
    expect(t.gain).toBe(1);
    expect(textOf(r)).toContain(t.id);
  });

  it('add_audio_track accepts name/gain/pan/filter', () => {
    const s = freshSession();
    tool('add_audio_track').run(s, { name: 'Music', gain: 0.5, pan: 0.3, filter_kind: 'lowpass', filter_frequency: 500 });
    const t = s.project.audioTracks![0];
    expect(t.name).toBe('Music');
    expect(t.gain).toBe(0.5);
    expect(t.pan).toBe(0.3);
    expect(t.filter).toEqual({ kind: 'lowpass', frequency: 500 });
  });

  it('add_audio_track defaults filter_frequency to 1000 when a kind is given without one', () => {
    const s = freshSession();
    tool('add_audio_track').run(s, { filter_kind: 'highpass' });
    expect(s.project.audioTracks![0].filter).toEqual({ kind: 'highpass', frequency: 1000 });
  });

  it('set_audio_track updates name/gain/muted/solo', () => {
    const s = freshSession();
    tool('add_audio_track').run(s, {});
    const trackId = s.project.audioTracks![0].id;
    tool('set_audio_track').run(s, { trackId, name: 'Renamed', gain: 0.2, muted: true, solo: true });
    const t = s.project.audioTracks![0];
    expect(t.name).toBe('Renamed');
    expect(t.gain).toBe(0.2);
    expect(t.muted).toBe(true);
    expect(t.solo).toBe(true);
  });

  it('set_audio_track pan 0 clears pan; filter_kind "none" clears the filter', () => {
    const s = freshSession();
    tool('add_audio_track').run(s, { pan: 0.5, filter_kind: 'lowpass', filter_frequency: 500 });
    const trackId = s.project.audioTracks![0].id;
    tool('set_audio_track').run(s, { trackId, pan: 0 });
    expect(s.project.audioTracks![0].pan).toBeUndefined();
    tool('set_audio_track').run(s, { trackId, filter_kind: 'none' });
    expect(s.project.audioTracks![0].filter).toBeUndefined();
  });

  it('set_audio_track throws on an unknown trackId', () => {
    const s = freshSession();
    expect(() => tool('set_audio_track').run(s, { trackId: 'ghost', gain: 0.5 })).toThrow(/ghost/);
  });

  it('add_audio_clip adds a clip mapping at/inPoint/outPoint onto the model fields', () => {
    const s = freshSession();
    withAudioAsset(s);
    const r = tool('add_audio_clip').run(s, { assetId: 'a1', at: 2, inPoint: 0, outPoint: 5 });
    const c = s.project.audioClips[0];
    expect(c).toMatchObject({ assetId: 'a1', startTime: 2, inPoint: 0, outPoint: 5, volume: 1 });
    expect(textOf(r)).toContain(c.id);
  });

  it('add_audio_clip accepts trackId/volume/fadeIn/fadeOut', () => {
    const s = freshSession();
    withAudioAsset(s);
    tool('add_audio_track').run(s, {});
    const trackId = s.project.audioTracks![0].id;
    tool('add_audio_clip').run(s, { assetId: 'a1', trackId, at: 0, inPoint: 0, outPoint: 4, volume: 0.6, fadeIn: 0.5, fadeOut: 0.5 });
    const c = s.project.audioClips[0];
    expect(c.trackId).toBe(trackId);
    expect(c.volume).toBe(0.6);
    expect(c.fadeIn).toBe(0.5);
    expect(c.fadeOut).toBe(0.5);
  });

  it('set_audio_clip updates timing/volume and clears a fade at 0', () => {
    const s = freshSession();
    withAudioAsset(s);
    tool('add_audio_clip').run(s, { assetId: 'a1', at: 0, inPoint: 0, outPoint: 4, fadeIn: 1 });
    const clipId = s.project.audioClips[0].id;
    tool('set_audio_clip').run(s, { clipId, at: 1, outPoint: 3, volume: 0.5, fadeIn: 0 });
    const c = s.project.audioClips[0];
    expect(c.startTime).toBe(1);
    expect(c.outPoint).toBe(3);
    expect(c.volume).toBe(0.5);
    expect(c.fadeIn).toBeUndefined();
  });

  it('set_audio_clip trackId "" clears back to the default lane', () => {
    const s = freshSession();
    withAudioAsset(s);
    tool('add_audio_track').run(s, {});
    const trackId = s.project.audioTracks![0].id;
    tool('add_audio_clip').run(s, { assetId: 'a1', trackId, at: 0, inPoint: 0, outPoint: 4 });
    const clipId = s.project.audioClips[0].id;
    tool('set_audio_clip').run(s, { clipId, trackId: '' });
    expect(s.project.audioClips[0].trackId).toBeUndefined();
  });

  it('set_audio_clip throws on an unknown clipId', () => {
    const s = freshSession();
    expect(() => tool('set_audio_clip').run(s, { clipId: 'ghost', volume: 0.5 })).toThrow(/ghost/);
  });

  it('remove_audio_track removes the track and strips trackId off its clips (not the clips)', () => {
    const s = freshSession();
    withAudioAsset(s);
    tool('add_audio_track').run(s, {});
    const trackId = s.project.audioTracks![0].id;
    tool('add_audio_clip').run(s, { assetId: 'a1', trackId, at: 0, inPoint: 0, outPoint: 4, id: 'c1' });
    tool('remove_audio_track').run(s, { trackId });
    expect(s.project.audioTracks).toBeUndefined();
    expect(s.project.audioClips).toHaveLength(1);
    expect(s.project.audioClips[0].trackId).toBeUndefined();
  });

  it('remove_audio_clip removes the clip', () => {
    const s = freshSession();
    withAudioAsset(s);
    tool('add_audio_clip').run(s, { assetId: 'a1', at: 0, inPoint: 0, outPoint: 4 });
    const clipId = s.project.audioClips[0].id;
    tool('remove_audio_clip').run(s, { clipId });
    expect(s.project.audioClips).toEqual([]);
  });

  it('describe reflects audio tracks and clips', () => {
    const s = freshSession();
    withAudioAsset(s);
    tool('add_audio_track').run(s, { name: 'Music' });
    const trackId = s.project.audioTracks![0].id;
    tool('add_audio_clip').run(s, { assetId: 'a1', trackId, at: 0, inPoint: 0, outPoint: 4 });
    const r = tool('describe').run(s, {});
    expect(textOf(r)).toContain('Audio: 1 clip(s), 1 track(s)');
    expect(textOf(r)).toContain('"Music"');
  });
});

describe('mcp/tools interactivity (M9)', () => {
  it('every one of the 5 interactivity tool descriptions embeds the SavigScript cheat-sheet', () => {
    const cheatsheet = 'no loops/functions/member access; ≤500 chars.';
    for (const name of ['add_behavior', 'set_behavior', 'remove_behavior', 'set_variable', 'remove_variable']) {
      expect(tool(name).description).toContain(cheatsheet);
    }
  });

  it('add_behavior attaches a pointer behavior to an object', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    const r = tool('add_behavior').run(s, { objectId: 'r', event: 'click', actions: [{ kind: 'setVar', args: { name: 'n', value: '1' } }] });
    const obj = s.project.objects.find((o) => o.id === 'r')!;
    expect(obj.behaviors).toHaveLength(1);
    expect(obj.behaviors![0].event).toBe('click');
    expect(textOf(r)).toContain(obj.behaviors![0].id);
  });

  it('add_behavior with no objectId adds a project-level global handler', () => {
    const s = freshSession();
    tool('add_behavior').run(s, { event: 'keydown', key: 'ArrowLeft', actions: [] });
    expect(s.project.interactions!.handlers).toHaveLength(1);
    expect(s.project.interactions!.handlers![0].key).toBe('ArrowLeft');
  });

  it('add_behavior locates the object across scenes, not just the currently-selected one', () => {
    const s = freshSession();
    tool('add_scene').run(s, { name: 'A' });
    const sceneA = s.project.scenes![0].id;
    s.currentSceneId = sceneA;
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'o1' });
    tool('add_scene').run(s, { name: 'B' }); // a second scene; select_scene isn't called
    s.currentSceneId = s.project.scenes![1].id; // "current" scene is now B, not A — where o1 lives
    tool('add_behavior').run(s, { objectId: 'o1', event: 'click', actions: [] });
    expect(s.project.scenes!.find((sc) => sc.id === sceneA)!.objects[0].behaviors).toHaveLength(1);
  });

  it('add_behavior throws on an unknown objectId', () => {
    const s = freshSession();
    expect(() => tool('add_behavior').run(s, { objectId: 'ghost', event: 'click', actions: [] })).toThrow(/ghost/);
  });

  it('set_behavior patches an existing behavior', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('add_behavior').run(s, { objectId: 'r', event: 'click', actions: [] });
    const behaviorId = s.project.objects[0].behaviors![0].id;
    tool('set_behavior').run(s, { objectId: 'r', behaviorId, event: 'pointerdown' });
    expect(s.project.objects[0].behaviors![0].event).toBe('pointerdown');
  });

  it('set_behavior throws on an unknown behaviorId', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    expect(() => tool('set_behavior').run(s, { objectId: 'r', behaviorId: 'ghost', event: 'click' })).toThrow(/ghost/);
  });

  it('remove_behavior removes a behavior from an object', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    tool('add_behavior').run(s, { objectId: 'r', event: 'click', actions: [] });
    const behaviorId = s.project.objects[0].behaviors![0].id;
    tool('remove_behavior').run(s, { objectId: 'r', behaviorId });
    expect(s.project.objects[0].behaviors).toBeUndefined();
  });

  it('remove_behavior removes a project-level handler when objectId is omitted', () => {
    const s = freshSession();
    tool('add_behavior').run(s, { event: 'tick', actions: [] });
    const behaviorId = s.project.interactions!.handlers![0].id;
    tool('remove_behavior').run(s, { behaviorId });
    expect(s.project.interactions).toBeUndefined();
  });

  it('set_variable declares/upserts a variable', () => {
    const s = freshSession();
    tool('set_variable').run(s, { name: 'score', initial: 0 });
    expect(s.project.interactions!.variables).toEqual([{ name: 'score', initial: 0 }]);
    tool('set_variable').run(s, { name: 'score', initial: 5 });
    expect(s.project.interactions!.variables).toEqual([{ name: 'score', initial: 5 }]);
  });

  it('set_variable accepts string/boolean initials', () => {
    const s = freshSession();
    tool('set_variable').run(s, { name: 's', initial: 'hi' });
    tool('set_variable').run(s, { name: 'b', initial: true });
    expect(s.project.interactions!.variables).toEqual([{ name: 's', initial: 'hi' }, { name: 'b', initial: true }]);
  });

  it('remove_variable removes a declared variable', () => {
    const s = freshSession();
    tool('set_variable').run(s, { name: 'score', initial: 0 });
    tool('remove_variable').run(s, { name: 'score' });
    expect(s.project.interactions).toBeUndefined();
  });

  it('remove_variable throws on an unknown name', () => {
    const s = freshSession();
    expect(() => tool('remove_variable').run(s, { name: 'ghost' })).toThrow(/ghost/);
  });

  it('describe reflects behaviors and variables', () => {
    const s = freshSession();
    tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r' }); // default name "Rectangle 1"
    tool('set_variable').run(s, { name: 'score', initial: 0 });
    tool('add_behavior').run(s, { objectId: 'r', event: 'click', actions: [{ kind: 'setVar' }, { kind: 'setText' }] });
    tool('add_behavior').run(s, { event: 'keydown', key: 'ArrowLeft', actions: [{ kind: 'setPosition' }] });
    const r = tool('describe').run(s, {});
    expect(textOf(r)).toContain('Interactions: 1 variable(s), 1 handler(s)');
    expect(textOf(r)).toContain('  - score = 0');
    expect(textOf(r)).toContain('  - "Rectangle 1": click → 2 action(s)');
    expect(textOf(r)).toContain('  - keydown[ArrowLeft] → 1 action(s)');
  });

  it('validate flags a bad interaction (smoke)', () => {
    const s = freshSession();
    tool('add_behavior').run(s, { event: 'keydown', actions: [] }); // no key
    const r = tool('validate').run(s, {});
    expect(textOf(r)).toContain('behavior-key-missing');
  });
  describe('frame-by-frame tools', () => {
    const fbf = () => {
      const s: Session = { project: createProject({ fps: 10 }) };
      tool('add_frame_layer').run(s, { id: 'L', keys: [0, 0.2], labels: ['a'], end: 0.4, x: 5 });
      return s;
    };
    const layer = (s: Session) => s.project.objects.find((o) => o.id === 'L')!;

    it('add_frame_layer creates a layer with keys and labels', () => {
      const s = fbf();
      expect(layer(s).frames!.keys.map((k) => [k.time, k.label])).toEqual([[0, 'a'], [0.2, undefined]]);
      expect(layer(s).base.x).toBe(5);
    });

    it('add_* with layerId + time draws on that frame, creating the key if missing', () => {
      const s = fbf();
      const r = tool('add_ellipse').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'b', layerId: 'L', time: 0.3 });
      expect(textOf(r)).toContain('on layer "L" at 0.3s');
      const key = layer(s).frames!.keys.find((k) => Math.abs(k.time - 0.3) < 1e-6)!;
      const b = s.project.objects.find((o) => o.id === 'b')!;
      expect([b.parentId, b.frameKeyId]).toEqual(['L', key.id]);
      tool('add_line').run(s, { x1: 0, y1: 0, x2: 5, y2: 5, id: 'ln', layerId: 'L', time: 0 });
      expect(s.project.objects.find((o) => o.id === 'ln')!.frameKeyId).toBe(layer(s).frames!.keys[0].id);
      expect(() => tool('add_rect').run(s, { x: 0, y: 0, width: 1, height: 1, layerId: 'L' })).toThrow(/time/);
    });

    it('add_frame_key copy_previous, insert/remove frames, clear key', () => {
      const s = fbf();
      tool('add_rect').run(s, { x: 0, y: 0, width: 4, height: 4, id: 'r', layerId: 'L', time: 0 });
      tool('add_frame_key').run(s, { layerId: 'L', time: 0.1, copy_previous: true, id: 'k1' });
      expect(s.project.objects.filter((o) => o.frameKeyId === 'k1')).toHaveLength(1);
      tool('insert_frames').run(s, { layerId: 'L', time: 0, count: 2 });
      expect(layer(s).frames!.keys.map((k) => k.time)).toEqual([0, 0.3, 0.4]);
      tool('remove_frames').run(s, { layerId: 'L', time: 0 });
      expect(layer(s).frames!.keys.map((k) => k.time)).toEqual([0, 0.2, 0.3]);
      tool('clear_frame_key').run(s, { layerId: 'L', keyId: 'k1' });
      expect(s.project.objects.some((o) => o.frameKeyId === 'k1')).toBe(false);
      expect(textOf(tool('validate').run(s, {}))).toContain('no validation issues');
    });

    it('flipbook lays drawings out on twos; describe shows the keys', () => {
      const s: Session = { project: createProject({ fps: 10 }) };
      tool('add_frame_layer').run(s, { id: 'L' });
      for (const id of ['a', 'b', 'c']) tool('add_rect').run(s, { x: 0, y: 0, width: 4, height: 4, id });
      const r = tool('flipbook').run(s, { layerId: 'L', drawings: [['a'], ['b'], ['c']], hold: 2 });
      expect(layer(s).frames!.keys.map((k) => k.time)).toEqual([0, 0.2, 0.4]);
      expect(layer(s).frames!.end).toBeCloseTo(0.6);
      expect(textOf(r)).toContain('L-k1 0.2–0.4s 1 obj');
      expect(tool('flipbook').run(s, { layerId: 'L', drawings: 'nope' }).isError).toBe(true);
    });

    it('get_dsl round-trips a frame layer through load_dsl', () => {
      const s = fbf();
      tool('add_rect').run(s, { x: 0, y: 0, width: 4, height: 4, id: 'r', layerId: 'L', time: 0.2 });
      const dsl = JSON.parse(textOf(tool('get_dsl').run(s, {})));
      const t: Session = freshSession();
      tool('load_dsl').run(t, { doc: dsl });
      expect(t.project).toEqual(s.project);
    });
  });

  describe('bones (spec 2026-11-13-bone-tool, slice 3)', () => {
    it('add_bone chains, attach_to_bone, pose_ik keys the chain, set_bone_rotation; describe shows bones', () => {
      const s: Session = { project: createProject({ fps: 10, duration: 2, durationMode: 'manual' }) };
      tool('add_bone').run(s, { id: 'upper', x: 100, y: 100, length: 100 });
      tool('add_bone').run(s, { id: 'lower', parentId: 'upper', length: 80, min: -120, max: 0 });
      tool('add_rect').run(s, { id: 'hand', x: 270, y: 90, width: 20, height: 20 });
      tool('attach_to_bone').run(s, { boneId: 'lower', objectIds: ['hand'] });
      const r = tool('pose_ik').run(s, { boneId: 'lower', x: 200, y: 20, time: 1, easing: 'easeInOut' });
      expect(r.isError).toBeFalsy();
      expect(textOf(r)).toMatch(/lower "Bone 2" \(bone\).*limits -120°\.\.0°.*→ hand/);
      const o = (id: string) => s.project.objects.find((x) => x.id === id)!;
      expect(o('hand').parentId).toBe('lower');
      expect(o('upper').tracks.rotation).toHaveLength(1);
      expect(o('lower').tracks.rotation![0].easing).toBe('easeInOut');
      tool('set_bone_rotation').run(s, { boneId: 'lower', rotation: 30 });
      expect(o('lower').base.rotation).toBe(0); // clamped to max 0
      tool('set_bone_rotation').run(s, { boneId: 'upper', rotation: -10, time: 0 });
      expect(o('upper').tracks.rotation).toHaveLength(2);
    });

    it('validates input and surfaces core errors', () => {
      const s = freshSession();
      expect(tool('pose_ik').run(s, { boneId: 'x', x: 0, y: 0, time: 0, easing: 'wobble' }).isError).toBe(true);
      expect(tool('attach_to_bone').run(s, { boneId: 'x', objectIds: 'nope' }).isError).toBe(true);
      expect(() => tool('add_bone').run(s, { length: 10 })).toThrow(/root bone needs x and y/);
      expect(() => tool('pose_ik').run(s, { boneId: 'nope', x: 0, y: 0, time: 0 })).toThrow(/no object/);
    });

    it('bind_skin bends a drawing with the bones; unbind_skin removes it', () => {
      const s: Session = { project: createProject({ fps: 10 }) };
      tool('add_bone').run(s, { id: 'b1', x: 0, y: 100, length: 100 });
      tool('add_bone').run(s, { id: 'b2', parentId: 'b1', length: 100 });
      tool('add_rect').run(s, { id: 'tail', x: 0, y: 95, width: 200, height: 10 });
      const r = tool('bind_skin').run(s, { objectId: 'tail', boneIds: ['b1', 'b2'] });
      expect(r.isError).toBeFalsy();
      expect(textOf(r)).toMatch(/tail .*skin → b1, b2/);
      expect(tool('bind_skin').run(s, { objectId: 'tail', boneIds: 'b1' }).isError).toBe(true);
      expect(() => tool('bind_skin').run(s, { objectId: 'tail', boneIds: ['nope'] })).toThrow(/no object/);
      tool('unbind_skin').run(s, { objectId: 'tail' });
      expect(s.project.objects.find((o) => o.id === 'tail')!.skin).toBeUndefined();
    });

    it('load_dsl accepts a bone tree and get_dsl returns it', () => {
      const s = freshSession();
      tool('load_dsl').run(s, {
        doc: { objects: [{ type: 'bone', id: 'b', x: 10, y: 10, length: 50, children: [{ type: 'rect', id: 'r', x: 10, y: 5, width: 50, height: 10 }] }] },
      });
      const dsl = JSON.parse(textOf(tool('get_dsl').run(s, {})));
      expect(dsl.objects).toHaveLength(1);
      expect(dsl.objects[0]).toMatchObject({ type: 'bone', id: 'b', children: [{ type: 'rect', id: 'r' }] });
    });
  });

  describe('shape tween (spec 2026-11-13-shape-tween, slice 2)', () => {
    function twoKeys(): Session {
      const s: Session = { project: createProject({ fps: 10 }) };
      tool('add_frame_layer').run(s, { id: 'L', keys: [0, 1], end: 2 });
      tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r', layerId: 'L', time: 0 });
      tool('add_ellipse').run(s, { x: 50, y: 0, width: 20, height: 20, id: 'e', layerId: 'L', time: 1 });
      return s;
    }
    const L = (s: Session) => s.project.objects.find((o) => o.id === 'L')!;

    it('shape_tween by time, describe shows it, remove_shape_tween by key id', () => {
      const s = twoKeys();
      const r = tool('shape_tween').run(s, { layerId: 'L', time: 0.5, easing: 'easeOut' });
      expect(r.isError).toBeFalsy();
      expect(L(s).frames!.keys[0].tween).toEqual({ kind: 'shape', easing: 'easeOut' });
      expect(textOf(tool('describe').run(s, {}))).toContain('→tween(easeOut)');
      tool('remove_shape_tween').run(s, { layerId: 'L', keyId: L(s).frames!.keys[0].id });
      expect(L(s).frames!.keys[0].tween).toBeUndefined();
    });

    it('rejects a missing key, a bad easing, and the last key', () => {
      const s = twoKeys();
      expect(tool('shape_tween').run(s, { layerId: 'L' }).isError).toBe(true);
      expect(tool('shape_tween').run(s, { layerId: 'L', time: 0, easing: 'wobble' }).isError).toBe(true);
      expect(() => tool('shape_tween').run(s, { layerId: 'L', time: 1.5 })).toThrow(/following keyframe/);
    });

    it('get_dsl round-trips a tweened layer through load_dsl', () => {
      const s = twoKeys();
      tool('shape_tween').run(s, { layerId: 'L', time: 0 });
      const dsl = JSON.parse(textOf(tool('get_dsl').run(s, {})));
      expect(dsl.objects[0].keys[0].tween).toBe('shape');
      const t: Session = freshSession();
      tool('load_dsl').run(t, { doc: dsl });
      expect(JSON.parse(textOf(tool('get_dsl').run(t, {})))).toEqual(dsl);
      expect(t.project.objects.find((o) => o.id === 'r')!.shapeTrack).toHaveLength(2);
    });
    it('shape_tween takes hints; describe counts them; bad hints error', () => {
      const s = twoKeys();
      const hints = [{ a: { x: 0, y: 0 }, b: { x: 60, y: 0 } }];
      expect(tool('shape_tween').run(s, { layerId: 'L', time: 0, hints }).isError).toBeFalsy();
      expect(L(s).frames!.keys[0].tween!.hints).toEqual(hints);
      expect(textOf(tool('describe').run(s, {}))).toContain('hints×1');
      expect(() => tool('shape_tween').run(s, { layerId: 'L', time: 0, hints: [{ a: { x: 0 }, b: { x: 0, y: 0 } }] })).toThrow(/finite/);
    });
  });

  describe('mask layers (spec 2026-11-13, slice 3)', () => {
    function twoBoxes(): Session {
      const s = freshSession();
      tool('add_rect').run(s, { x: 0, y: 0, width: 100, height: 50, id: 'card' });
      tool('add_rect').run(s, { x: 0, y: 0, width: 40, height: 50, id: 'm' });
      return s;
    }
    const obj = (s: Session, id: string) => s.project.objects.find((o) => o.id === id)!;

    it('create_mask links targets; describe shows both sides; release_mask undoes it', () => {
      const s = twoBoxes();
      const r = tool('create_mask').run(s, { maskId: 'm', targetIds: ['card'] });
      expect(obj(s, 'm').isMask).toBe(true);
      expect(obj(s, 'card').maskedBy).toBe('m');
      expect(textOf(r)).toContain('MASK (not drawn) reveals: card');
      expect(textOf(r)).toContain('maskedBy=m');
      tool('release_mask').run(s, { maskId: 'm' });
      expect(obj(s, 'm').isMask).toBeUndefined();
      expect(obj(s, 'card').maskedBy).toBeUndefined();
    });

    it('rejects bad input', () => {
      const s = twoBoxes();
      expect(tool('create_mask').run(s, { maskId: 'm', targetIds: 'card' }).isError).toBe(true);
      expect(() => tool('create_mask').run(s, { maskId: 'm', targetIds: ['m'] })).toThrow();
      expect(() => tool('release_mask').run(s, { maskId: 'card' })).toThrow();
    });

    it('reveal adds an animated wipe mask over the targets', () => {
      const s = twoBoxes();
      const r = tool('reveal').run(s, { targetIds: ['card'], id: 'w', from: 'right', duration: 2 });
      const w = obj(s, 'w');
      expect(w.isMask).toBe(true);
      expect(w.anchorX).toBe(1);
      expect(w.tracks.scaleX!.map((k) => [k.time, k.value])).toEqual([[0, 0], [2, 1]]);
      expect(obj(s, 'card').maskedBy).toBe('w');
      expect(textOf(r)).toContain('Reveal mask "w"');
    });

    it('get_dsl round-trips masks through load_dsl', () => {
      const s = twoBoxes();
      tool('create_mask').run(s, { maskId: 'm', targetIds: ['card'] });
      const dsl = JSON.parse(textOf(tool('get_dsl').run(s, {})));
      expect(dsl.objects.find((o: { id: string }) => o.id === 'm').mask).toBe(true);
      const t: Session = freshSession();
      tool('load_dsl').run(t, { doc: dsl });
      expect(t.project).toEqual(s.project);
    });
  });

  describe('filters (spec 2026-11-13-filters, slice 3)', () => {
    function box(): Session {
      const s = freshSession();
      tool('add_rect').run(s, { x: 0, y: 0, width: 100, height: 50, id: 'card' });
      return s;
    }
    const obj = (s: Session, id: string) => s.project.objects.find((o) => o.id === id)!;

    it('add_filter / set_filter / animate_filter / remove_filter; describe shows the stack', () => {
      const s = box();
      const r = tool('add_filter').run(s, { objectId: 'card', kind: 'glow', id: 'g', params: { blur: 5 }, color: '#ff00ff' });
      expect(obj(s, 'card').filters![0]).toMatchObject({ id: 'g', kind: 'glow', params: { blur: 5 }, color: '#ff00ff' });
      expect(textOf(r)).toContain('filters: glow:g');
      tool('set_filter').run(s, { objectId: 'card', filterId: 'g', enabled: false });
      expect(obj(s, 'card').filters![0].enabled).toBe(false);
      const a = tool('animate_filter').run(s, { objectId: 'card', filterId: 'g', param: 'strength', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 2 }] });
      expect(obj(s, 'card').filterTracks!['g.strength']).toHaveLength(2);
      expect(textOf(a)).toContain('[strength@[0,1]]');
      tool('remove_filter').run(s, { objectId: 'card', filterId: 'g' });
      expect(obj(s, 'card').filters).toBeUndefined();
    });

    it('rejects bad input', () => {
      const s = box();
      expect(() => tool('add_filter').run(s, { objectId: 'card', kind: 'sparkle' })).toThrow();
      expect(() => tool('add_filter').run(s, { objectId: 'card', kind: 'blur', params: { dx: 1 } })).toThrow();
      expect(tool('animate_filter').run(s, { objectId: 'card', filterId: 'x', param: 'blur', keyframes: 'no' }).isError).toBe(true);
    });

    it('get_dsl round-trips filters through load_dsl', () => {
      const s = box();
      tool('add_filter').run(s, { objectId: 'card', kind: 'dropShadow', id: 'ds', params: { dx: 9 } });
      tool('animate_filter').run(s, { objectId: 'card', filterId: 'ds', param: 'opacity', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 1 }] });
      const dsl = JSON.parse(textOf(tool('get_dsl').run(s, {})));
      expect(dsl.objects[0].filters[0]).toMatchObject({ kind: 'dropShadow', id: 'ds', dx: 9 });
      const t: Session = freshSession();
      tool('load_dsl').run(t, { doc: dsl });
      expect(t.project).toEqual(s.project);
    });
  });
});
