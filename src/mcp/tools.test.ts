import { describe, it, expect } from 'vitest';
import { createProject } from '../engine';
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
});
