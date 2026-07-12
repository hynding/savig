/** Savig MCP tools — the agent-facing surface. Each tool's LOGIC lives here as a pure handler over
 *  a stateful `Session` (the in-progress Project), independent of the MCP transport, so it's
 *  directly unit-testable. `server.ts` wires this table to the protocol. Mutating tools return a
 *  describe + a thumbnail image so the agent sees the effect of each edit. */
import { createProject, resolveTimeline } from '@savig/engine';
import type { Easing, EasingName, AnimatableProperty, Project, VectorStyle, Transition, TrimProperty } from '@savig/engine';
import { renderProjectDocument } from '@savig/services/export/renderDocument';
import {
  addRect,
  addEllipse,
  addText,
  setKeyframe,
  describeProject,
  validateProject,
  compileShort,
  decompileProject,
  fadeIn,
  fadeOut,
  moveTo,
  setTrim,
  setTrimKeyframe,
  setRepeat,
  outlineStrokePath,
  blendPaths,
  drawOn,
  setCamera,
  panTo,
  zoomTo,
  templates,
  getTemplate,
  withScene,
  addScene,
  removeScene,
  reorderScene,
  setSceneDuration,
  setSceneTransition,
  type ShortDoc,
} from '@savig/core';
import { renderFramePng, renderThumbnail, renderGif } from '@savig/core/node';
import { toBase64 } from './base64';

export interface Session {
  project: Project;
  currentSceneId?: string;
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

/** The master-timeline time at which the current scene starts (0 for single-scene), so the
 *  thumbnail shows the scene the agent is currently editing. */
function currentSceneTime(session: Session): number {
  if (!session.project.scenes || !session.currentSceneId) return 0;
  const span = resolveTimeline(session.project).find((sp) => sp.scene.id === session.currentSceneId);
  return span ? span.start : 0;
}

/** Mutating-tool result: a status line + the current describe + a fresh thumbnail. */
function edited(session: Session, status: string): ToolResult {
  return { content: [text(`${status}\n\n${describeProject(session.project)}`), pngImage(renderThumbnail(session.project, { time: currentSceneTime(session) }))] };
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
/** The 4 named easings (`EasingName`) — narrower than the engine's `Easing` type (which also
 *  accepts a cubic-bezier tuple, not expressible as a single MCP string arg). Used to validate
 *  the `blend` tool's optional `easing` input. */
const EASING_NAMES: EasingName[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

export const tools: ToolDef[] = [
  {
    name: 'new_short',
    description: 'Start a new, empty animated short (resets the working project). Sets artboard size and fps.',
    inputSchema: obj({ name: str, width: num, height: num, fps: num, loop: { type: 'boolean' } }),
    run(session, args) {
      session.project = createProject(args as Partial<Project['meta']>);
      session.currentSceneId = session.project.scenes?.[0]?.id;
      return edited(session, 'Started a new short.');
    },
  },
  {
    name: 'load_dsl',
    description: 'Replace the working project with a compiled ShortDoc (declarative JSON: meta + rect/ellipse/path objects with style, base, and animate tracks).',
    inputSchema: obj({ doc: { type: 'object' } }, ['doc']),
    run(session, args) {
      session.project = compileShort(args.doc as ShortDoc);
      session.currentSceneId = session.project.scenes?.[0]?.id;
      return edited(session, `Loaded DSL.\n${validationText(session.project)}`);
    },
  },
  {
    name: 'add_rect',
    description: 'Add a rectangle at (x,y) with width/height. Optional id and fill/stroke/strokeWidth.',
    inputSchema: obj({ x: num, y: num, width: num, height: num, id: str, fill: str, stroke: str, strokeWidth: num }, ['x', 'y', 'width', 'height']),
    run(session, a) {
      const r = withScene(session.project, session.currentSceneId, (p) =>
        addRect(p, { x: a.x as number, y: a.y as number, width: a.width as number, height: a.height as number, id: a.id as string | undefined, style: styleFrom(a) }),
      );
      session.project = r.project;
      return edited(session, `Added rect "${r.id}".`);
    },
  },
  {
    name: 'add_ellipse',
    description: 'Add an ellipse whose bounding box is (x,y,width,height). Optional id and fill/stroke/strokeWidth.',
    inputSchema: obj({ x: num, y: num, width: num, height: num, id: str, fill: str, stroke: str, strokeWidth: num }, ['x', 'y', 'width', 'height']),
    run(session, a) {
      const r = withScene(session.project, session.currentSceneId, (p) =>
        addEllipse(p, { x: a.x as number, y: a.y as number, width: a.width as number, height: a.height as number, id: a.id as string | undefined, style: styleFrom(a) }),
      );
      session.project = r.project;
      return edited(session, `Added ellipse "${r.id}".`);
    },
  },
  {
    name: 'add_text',
    description: 'Add a text object (title/caption) at (x,y) = its top-left. Optional fontSize, fontFamily, fill, stroke, textAnchor (start/middle/end), id.',
    inputSchema: obj({ content: str, x: num, y: num, fontSize: num, fontFamily: str, fill: str, stroke: str, textAnchor: { type: 'string', enum: ['start', 'middle', 'end'] }, id: str }, ['content', 'x', 'y']),
    run(session, a) {
      const r = withScene(session.project, session.currentSceneId, (p) =>
        addText(p, {
          content: a.content as string,
          x: a.x as number,
          y: a.y as number,
          fontSize: a.fontSize as number | undefined,
          fontFamily: a.fontFamily as string | undefined,
          fill: a.fill as string | undefined,
          stroke: a.stroke as string | undefined,
          textAnchor: a.textAnchor as 'start' | 'middle' | 'end' | undefined,
          id: a.id as string | undefined,
        }),
      );
      session.project = r.project;
      return edited(session, `Added text "${r.id}".`);
    },
  },
  {
    name: 'set_keyframe',
    description: 'Upsert a keyframe on an object track (property: x/y/scaleX/scaleY/rotation/opacity/width/height/…).',
    inputSchema: obj({ objectId: str, property: str, time: num, value: num, easing: str }, ['objectId', 'property', 'time', 'value']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: setKeyframe(p, { objectId: a.objectId as string, property: a.property as AnimatableProperty, time: a.time as number, value: a.value as number, easing: a.easing as Easing | undefined }),
      })).project;
      return edited(session, `Keyframe set on "${a.objectId}" (${a.property} @ ${a.time}s = ${a.value}).`);
    },
  },
  {
    name: 'move_to',
    description: 'Animate an object moving to (x,y) — a macro that adds x/y keyframes over [start, start+duration].',
    inputSchema: obj({ objectId: str, x: num, y: num, start: num, duration: num, easing: str }, ['objectId']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: moveTo(
          p,
          a.objectId as string,
          { x: a.x as number | undefined, y: a.y as number | undefined },
          { start: a.start as number | undefined, duration: a.duration as number | undefined, easing: a.easing as Easing | undefined },
        ),
      })).project;
      return edited(session, `move_to applied to "${a.objectId}".`);
    },
  },
  {
    name: 'fade',
    description: 'Fade an object in or out (opacity macro).',
    inputSchema: obj({ objectId: str, direction: { type: 'string', enum: ['in', 'out'] }, start: num, duration: num }, ['objectId', 'direction']),
    run(session, a) {
      const fn = a.direction === 'out' ? fadeOut : fadeIn;
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: fn(p, a.objectId as string, { start: a.start as number | undefined, duration: a.duration as number | undefined }),
      })).project;
      return edited(session, `fade ${a.direction} applied to "${a.objectId}".`);
    },
  },
  {
    name: 'set_trim',
    description: 'Set or keyframe the trim-path window on a vector object (prop: start/end/offset, value 0..1 of path length). With `time`, upserts a keyframe; without, sets the base value. Trim reveals a stroke segment (draw-on); mutually exclusive with a dash pattern.',
    inputSchema: obj({ objectId: str, prop: { type: 'string', enum: ['start', 'end', 'offset'] }, value: num, time: num, easing: str }, ['objectId', 'prop', 'value']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project:
          a.time !== undefined
            ? setTrimKeyframe(p, { objectId: a.objectId as string, prop: a.prop as TrimProperty, time: a.time as number, value: a.value as number, easing: a.easing as Easing | undefined })
            : setTrim(p, a.objectId as string, { [a.prop as TrimProperty]: a.value as number }),
      })).project;
      return edited(session, `Trim ${a.prop} set on "${a.objectId}".`);
    },
  },
  {
    name: 'set_repeat',
    description: 'Set the repeater on a plain leaf object: N transformed, time-staggered copies (copy k gets translate(k·dx, k·dy) rotate(k·rotate) scale(scale^k), plays k·stagger seconds late). Any provided field merges onto the existing repeat (or the {count:2,dx:0,dy:0,rotate:0,scale:1,stagger:0} defaults when absent). `count` <= 1 clears the repeat. Not valid on a group or symbol instance.',
    inputSchema: obj({ objectId: str, count: num, dx: num, dy: num, rotate: num, scale: num, stagger: num }, ['objectId']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: setRepeat(p, a.objectId as string, {
          ...(a.count !== undefined ? { count: a.count as number } : {}),
          ...(a.dx !== undefined ? { dx: a.dx as number } : {}),
          ...(a.dy !== undefined ? { dy: a.dy as number } : {}),
          ...(a.rotate !== undefined ? { rotate: a.rotate as number } : {}),
          ...(a.scale !== undefined ? { scale: a.scale as number } : {}),
          ...(a.stagger !== undefined ? { stagger: a.stagger as number } : {}),
        }),
      })).project;
      return edited(session, `Repeat set on "${a.objectId}".`);
    },
  },
  {
    name: 'outline_stroke',
    description: 'Convert a path\'s stroke into filled outline geometry (in-place style/shape swap: fill <- old stroke, stroke removed). Requires a plain path with a visible stroke, no shapeTrack (morph), no compoundRings, and not a live-boolean result/operand. Drops trim/dash/color/gradient animation on the target (no longer meaningful post-outline); keeps transform tracks/motionPath/repeat.',
    inputSchema: obj({ objectId: str }, ['objectId']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: outlineStrokePath(p, a.objectId as string),
      })).project;
      return edited(session, `Outlined stroke on "${a.objectId}".`);
    },
  },
  {
    name: 'blend',
    description: 'Blend two vector paths (aId -> bId): creates `count` new intermediate path objects interpolating shape/style/opacity between them (Illustrator-style blend). aId/bId order is authoritative (blend direction follows the given ids, not stacking order). Requires both to be plain vector-path leaves — not a group, live-boolean result/operand, repeater, morphing (shapeTrack), or compound-ringed path.',
    inputSchema: obj({ aId: str, bId: str, count: num, easing: str }, ['aId', 'bId', 'count']),
    run(session, a) {
      const easing = a.easing as string | undefined;
      if (easing !== undefined && !EASING_NAMES.includes(easing as EasingName)) {
        return {
          isError: true,
          content: [text(`blend: invalid easing "${easing}" — must be one of ${EASING_NAMES.join(', ')}`)],
        };
      }
      // Sanitize the raw agent-supplied count (task 1 hardening): the MCP input schema has no
      // integer/range enforcement of its own, and blendPaths only guards `count >= 1` — a
      // fractional/absurd/non-finite value would otherwise reach it unclamped.
      const count = Math.floor(a.count as number);
      if (!Number.isFinite(count) || count < 1 || count > 100) {
        return {
          isError: true,
          content: [text(`blend: count must be an integer between 1 and 100 (got ${a.count})`)],
        };
      }
      const r = withScene(session.project, session.currentSceneId, (p) =>
        blendPaths(p, a.aId as string, a.bId as string, count, { easing: easing as EasingName | undefined }),
      );
      session.project = r.project;
      return edited(session, `Blended "${a.aId}" -> "${a.bId}" into ${r.ids.length} object(s).`);
    },
  },
  {
    name: 'draw_on',
    description: 'Draw-on macro: reveal a stroke along its path (trim end 0→1 over [start, start+duration]).',
    inputSchema: obj({ objectId: str, start: num, duration: num, easing: str }, ['objectId']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: drawOn(p, a.objectId as string, { start: a.start as number | undefined, duration: a.duration as number | undefined, easing: a.easing as Easing | undefined }),
      })).project;
      return edited(session, `draw_on applied to "${a.objectId}".`);
    },
  },
  {
    name: 'set_camera',
    description: 'Set the static camera framing: x/y = the artboard point centred in frame, zoom = magnification, rotation = roll (deg). Default = full artboard.',
    inputSchema: obj({ x: num, y: num, zoom: num, rotation: num }),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: setCamera(p, { x: a.x as number | undefined, y: a.y as number | undefined, zoom: a.zoom as number | undefined, rotation: a.rotation as number | undefined }),
      })).project;
      return edited(session, 'Camera framing set.');
    },
  },
  {
    name: 'camera_move',
    description: 'Animate the camera over [start, start+duration]: pan to (x,y) and/or zoom to a magnification (Ken-Burns).',
    inputSchema: obj({ x: num, y: num, zoom: num, start: num, duration: num, easing: str }),
    run(session, a) {
      const t = { start: a.start as number | undefined, duration: a.duration as number | undefined, easing: a.easing as Easing | undefined };
      session.project = withScene(session.project, session.currentSceneId, (p) => {
        let proj = p;
        if (a.x !== undefined || a.y !== undefined) proj = panTo(proj, { x: a.x as number | undefined, y: a.y as number | undefined }, t);
        if (a.zoom !== undefined) proj = zoomTo(proj, a.zoom as number, t);
        return { project: proj };
      }).project;
      return edited(session, 'Camera move applied.');
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
      return { content: [text(renderProjectDocument(session.project))] };
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
      session.currentSceneId = session.project.scenes?.[0]?.id;
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
  {
    name: 'add_scene',
    description: 'Add a new empty scene (shot) to the sequence and make it the current target for subsequent object edits. Auto-converts a single-scene short to multi-scene. Optional name, duration (s), afterIndex.',
    inputSchema: obj({ name: str, duration: num, afterIndex: num }),
    run(session, a) {
      const r = addScene(session.project, { name: a.name as string | undefined, duration: a.duration as number | undefined, afterIndex: a.afterIndex as number | undefined });
      session.project = r.project;
      session.currentSceneId = r.sceneId;
      return edited(session, `Added scene "${r.sceneId}" (now current).`);
    },
  },
  {
    name: 'remove_scene',
    description: 'Remove a scene by id. Reverts to a single-scene short when one scene remains.',
    inputSchema: obj({ sceneId: str }, ['sceneId']),
    run(session, a) {
      session.project = removeScene(session.project, a.sceneId as string);
      if (!session.project.scenes || !session.project.scenes.some((s) => s.id === session.currentSceneId)) {
        session.currentSceneId = session.project.scenes?.[0]?.id;
      }
      return edited(session, `Removed scene "${a.sceneId as string}".`);
    },
  },
  {
    name: 'reorder_scene',
    description: 'Move a scene to a new index in the play order.',
    inputSchema: obj({ sceneId: str, toIndex: num }, ['sceneId', 'toIndex']),
    run(session, a) {
      session.project = reorderScene(session.project, a.sceneId as string, a.toIndex as number);
      return edited(session, `Reordered scene "${a.sceneId as string}" to index ${a.toIndex as number}.`);
    },
  },
  {
    name: 'set_scene_duration',
    description: 'Set a scene\'s on-screen duration in seconds.',
    inputSchema: obj({ sceneId: str, duration: num }, ['sceneId', 'duration']),
    run(session, a) {
      session.project = setSceneDuration(session.project, a.sceneId as string, a.duration as number);
      return edited(session, `Set scene "${a.sceneId as string}" duration to ${a.duration as number}s.`);
    },
  },
  {
    name: 'set_scene_transition',
    description: 'Set the transition INTO a scene from the previous one: cut (default), crossfade (needs duration), or dip (needs duration + color). Transition playback renders in a later slice; this sets the data.',
    inputSchema: obj({ sceneId: str, kind: { type: 'string', enum: ['cut', 'crossfade', 'dip'] }, duration: num, color: str }, ['sceneId', 'kind']),
    run(session, a) {
      const kind = a.kind as 'cut' | 'crossfade' | 'dip';
      if (kind !== 'cut' && typeof a.duration !== 'number') {
        throw new Error(`savig/mcp: set_scene_transition kind "${kind}" requires a numeric duration`);
      }
      if (kind === 'dip' && typeof a.color !== 'string') {
        throw new Error(`savig/mcp: set_scene_transition kind "dip" requires a color string`);
      }
      let transition: Transition;
      if (kind === 'cut') transition = { kind: 'cut' };
      else if (kind === 'crossfade') transition = { kind: 'crossfade', duration: a.duration as number };
      else transition = { kind: 'dip', duration: a.duration as number, color: a.color as string };
      session.project = setSceneTransition(session.project, a.sceneId as string, transition);
      return edited(session, `Set scene "${a.sceneId as string}" transition to ${kind}.`);
    },
  },
  {
    name: 'select_scene',
    description: 'Make a scene the current target for subsequent object edits (does not change the project).',
    inputSchema: obj({ sceneId: str }, ['sceneId']),
    run(session, a) {
      const id = a.sceneId as string;
      if (!session.project.scenes?.some((s) => s.id === id)) throw new Error(`savig/mcp: no scene with id "${id}"`);
      session.currentSceneId = id;
      return edited(session, `Selected scene "${id}".`);
    },
  },
  {
    name: 'list_scenes',
    description: 'List the scenes (id, name, duration, object count) in play order, marking the current target scene. Use the ids with select_scene / remove_scene / reorder_scene.',
    inputSchema: obj({}),
    run(session) {
      const scenes = session.project.scenes;
      if (!scenes) return { content: [text('Single-scene short (no scene sequence). Use add_scene to start sequencing.')] };
      const lines = scenes.map((s, i) => `${i}. ${s.id === session.currentSceneId ? '→ ' : '  '}"${s.name}" [${s.id}] — ${s.duration}s, ${s.objects.length} objs${s.transitionIn && s.transitionIn.kind !== 'cut' ? `, ${s.transitionIn.kind}-in` : ''}`);
      return { content: [text(`Scenes (${scenes.length}):\n${lines.join('\n')}`)] };
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
