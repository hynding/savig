/** Savig MCP tools — the agent-facing surface. Each tool's LOGIC lives here as a pure handler over
 *  a stateful `Session` (the in-progress Project), independent of the MCP transport, so it's
 *  directly unit-testable. `server.ts` wires this table to the protocol. Mutating tools return a
 *  describe + a thumbnail image so the agent sees the effect of each edit. */
import { createProject } from '../engine';
import type { Easing, AnimatableProperty, Project, VectorStyle } from '../engine';
import { renderSvgDocument } from '../services/export/renderDocument';
import {
  addRect,
  addEllipse,
  setKeyframe,
  describeProject,
  validateProject,
  renderFramePng,
  renderThumbnail,
  renderGif,
  compileShort,
  decompileProject,
  fadeIn,
  fadeOut,
  moveTo,
  templates,
  getTemplate,
  type ShortDoc,
} from '../core';
import { toBase64 } from './base64';

export interface Session {
  project: Project;
}

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };
export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(session: Session, args: Record<string, unknown>): ToolResult;
}

const text = (s: string): Content => ({ type: 'text', text: s });
const pngImage = (png: Uint8Array): Content => ({ type: 'image', data: toBase64(png), mimeType: 'image/png' });

/** Mutating-tool result: a status line + the current describe + a fresh thumbnail. */
function edited(session: Session, status: string): ToolResult {
  return { content: [text(`${status}\n\n${describeProject(session.project)}`), pngImage(renderThumbnail(session.project))] };
}

function validationText(project: Project): string {
  const issues = validateProject(project);
  if (issues.length === 0) return '✓ no validation issues';
  return issues.map((i) => `[${i.severity}] ${i.code}: ${i.message}`).join('\n');
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const num = { type: 'number' };
const str = { type: 'string' };

export const tools: ToolDef[] = [
  {
    name: 'new_short',
    description: 'Start a new, empty animated short (resets the working project). Sets artboard size and fps.',
    inputSchema: obj({ name: str, width: num, height: num, fps: num, loop: { type: 'boolean' } }),
    run(session, args) {
      session.project = createProject(args as Partial<Project['meta']>);
      return edited(session, 'Started a new short.');
    },
  },
  {
    name: 'load_dsl',
    description: 'Replace the working project with a compiled ShortDoc (declarative JSON: meta + rect/ellipse/path objects with style, base, and animate tracks).',
    inputSchema: obj({ doc: { type: 'object' } }, ['doc']),
    run(session, args) {
      session.project = compileShort(args.doc as ShortDoc);
      return edited(session, `Loaded DSL.\n${validationText(session.project)}`);
    },
  },
  {
    name: 'add_rect',
    description: 'Add a rectangle at (x,y) with width/height. Optional id and fill/stroke/strokeWidth.',
    inputSchema: obj({ x: num, y: num, width: num, height: num, id: str, fill: str, stroke: str, strokeWidth: num }, ['x', 'y', 'width', 'height']),
    run(session, a) {
      const r = addRect(session.project, { x: a.x as number, y: a.y as number, width: a.width as number, height: a.height as number, id: a.id as string | undefined, style: styleFrom(a) });
      session.project = r.project;
      return edited(session, `Added rect "${r.id}".`);
    },
  },
  {
    name: 'add_ellipse',
    description: 'Add an ellipse whose bounding box is (x,y,width,height). Optional id and fill/stroke/strokeWidth.',
    inputSchema: obj({ x: num, y: num, width: num, height: num, id: str, fill: str, stroke: str, strokeWidth: num }, ['x', 'y', 'width', 'height']),
    run(session, a) {
      const r = addEllipse(session.project, { x: a.x as number, y: a.y as number, width: a.width as number, height: a.height as number, id: a.id as string | undefined, style: styleFrom(a) });
      session.project = r.project;
      return edited(session, `Added ellipse "${r.id}".`);
    },
  },
  {
    name: 'set_keyframe',
    description: 'Upsert a keyframe on an object track (property: x/y/scaleX/scaleY/rotation/opacity/width/height/…).',
    inputSchema: obj({ objectId: str, property: str, time: num, value: num, easing: str }, ['objectId', 'property', 'time', 'value']),
    run(session, a) {
      session.project = setKeyframe(session.project, { objectId: a.objectId as string, property: a.property as AnimatableProperty, time: a.time as number, value: a.value as number, easing: a.easing as Easing | undefined });
      return edited(session, `Keyframe set on "${a.objectId}" (${a.property} @ ${a.time}s = ${a.value}).`);
    },
  },
  {
    name: 'move_to',
    description: 'Animate an object moving to (x,y) — a macro that adds x/y keyframes over [start, start+duration].',
    inputSchema: obj({ objectId: str, x: num, y: num, start: num, duration: num, easing: str }, ['objectId']),
    run(session, a) {
      session.project = moveTo(
        session.project,
        a.objectId as string,
        { x: a.x as number | undefined, y: a.y as number | undefined },
        { start: a.start as number | undefined, duration: a.duration as number | undefined, easing: a.easing as Easing | undefined },
      );
      return edited(session, `move_to applied to "${a.objectId}".`);
    },
  },
  {
    name: 'fade',
    description: 'Fade an object in or out (opacity macro).',
    inputSchema: obj({ objectId: str, direction: { type: 'string', enum: ['in', 'out'] }, start: num, duration: num }, ['objectId', 'direction']),
    run(session, a) {
      const fn = a.direction === 'out' ? fadeOut : fadeIn;
      session.project = fn(session.project, a.objectId as string, { start: a.start as number | undefined, duration: a.duration as number | undefined });
      return edited(session, `fade ${a.direction} applied to "${a.objectId}".`);
    },
  },
  {
    name: 'describe',
    description: 'Return a compact text summary of the current project (meta, assets, objects, animated tracks).',
    inputSchema: obj({}),
    run(session) {
      return { content: [text(describeProject(session.project))] };
    },
  },
  {
    name: 'validate',
    description: 'Check the current project for problems (dangling refs, non-finite values, off-artboard, keyframes past duration, symbol cycles).',
    inputSchema: obj({}),
    run(session) {
      return { content: [text(validationText(session.project))] };
    },
  },
  {
    name: 'render_frame',
    description: 'Render the current project at a given time (seconds, default 0) to a PNG so you can see it. Optional output width.',
    inputSchema: obj({ time: num, width: num }),
    run(session, a) {
      const t = (a.time as number | undefined) ?? 0;
      const png = renderFramePng(session.project, t, { width: (a.width as number | undefined) ?? 480 });
      return { content: [text(`Frame at ${t}s`), pngImage(png)] };
    },
  },
  {
    name: 'render_gif',
    description: 'Render the whole animation as a looping animated GIF so you can watch it play. Optional fps and width.',
    inputSchema: obj({ fps: num, width: num }),
    run(session, a) {
      const gif = renderGif(session.project, { fps: a.fps as number | undefined, width: (a.width as number | undefined) ?? 360 });
      return { content: [text('Animated GIF of the current short'), { type: 'image', data: toBase64(gif), mimeType: 'image/gif' }] };
    },
  },
  {
    name: 'export_svg',
    description: 'Return the self-contained animated SVG document for the current project (the deliverable).',
    inputSchema: obj({}),
    run(session) {
      return { content: [text(renderSvgDocument(session.project))] };
    },
  },
  {
    name: 'list_templates',
    description: 'List the built-in example shorts (id, title, description) — good starting points to load and adapt.',
    inputSchema: obj({}),
    run() {
      return { content: [text(templates.map((t) => `- ${t.id}: ${t.title} — ${t.description}`).join('\n'))] };
    },
  },
  {
    name: 'load_template',
    description: 'Replace the working project with a built-in example short (see list_templates).',
    inputSchema: obj({ id: str }, ['id']),
    run(session, a) {
      const t = getTemplate(a.id as string);
      if (!t) return { content: [text(`Unknown template: ${a.id}. Use list_templates.`)], isError: true };
      session.project = t.build();
      return edited(session, `Loaded template "${t.id}" (${t.title}).`);
    },
  },
  {
    name: 'get_dsl',
    description: 'Return the current project as a ShortDoc (declarative JSON) for inspection or re-editing.',
    inputSchema: obj({}),
    run(session) {
      return { content: [text(JSON.stringify(decompileProject(session.project), null, 2))] };
    },
  },
];

function styleFrom(a: Record<string, unknown>): Partial<VectorStyle> | undefined {
  const style: Partial<VectorStyle> = {};
  if (typeof a.fill === 'string') style.fill = a.fill;
  if (typeof a.stroke === 'string') style.stroke = a.stroke;
  if (typeof a.strokeWidth === 'number') style.strokeWidth = a.strokeWidth;
  return Object.keys(style).length ? style : undefined;
}
