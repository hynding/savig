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
