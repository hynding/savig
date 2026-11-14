/** Savig MCP tools — the agent-facing surface. Each tool's LOGIC lives here as a pure handler over
 *  a stateful `Session` (the in-progress Project), independent of the MCP transport, so it's
 *  directly unit-testable. `server.ts` wires this table to the protocol. Mutating tools return a
 *  describe + a thumbnail image so the agent sees the effect of each edit. */
import { createProject, resolveTimeline } from '@savig/engine';
import type { AnchorMode, ShapeHint, Behavior, BehaviorAction, Easing, EasingName, AnimatableProperty, PathData, Project, Value, VectorStyle, Transition, TrimProperty } from '@savig/engine';
import { renderProjectDocument } from '@savig/services/export/renderDocument';
import {
  createMask,
  addFilter,
  setFilter,
  removeFilter,
  animateFilter,
  releaseMask,
  reveal,
  addRect,
  addEllipse,
  addPath,
  addText,
  setAnchor,
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
  addAudioTrack,
  addAudioClip,
  setTrackEffect,
  addBehavior,
  updateBehavior,
  removeBehavior,
  setVariable,
  removeVariable,
  addFrameLayer,
  addFrameKey,
  frameKeyAtTime,
  putInFrameKey,
  insertFrames,
  removeFrames,
  clearFrameKey,
  flipbook,
  shapeTween,
  removeShapeTween,
  addBone,
  attachToBone,
  poseIK,
  setBoneRotation,
  bindSkin,
  unbindSkin,
  type ShortDoc,
} from '@savig/core';
import { renderFramePng, renderThumbnail, renderGif, renderAnimatedSvgNode } from '@savig/core/node';
import { toBase64 } from './base64';

/** A frame key argument: `keyId` (string) or a `time` inside the key's span; null when neither. */
function keyArg(a: Record<string, unknown>): string | number | null {
  if (typeof a.keyId === 'string' && a.keyId) return a.keyId;
  if (typeof a.time === 'number' && Number.isFinite(a.time)) return a.time;
  return null;
}

const FILTER_HELP =
  'kind: blur {blur px} | dropShadow {dx, dy, blur, opacity 0..1, color} | glow {blur, strength 0..10, opacity, color} | ' +
  'adjustColor {brightness, contrast, saturation (each -1..1), hue (-180..180 deg)}';

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

// Parameter-position destructuring (not a local variable) so the dropped key's eslint
// no-unused-vars is covered by the shared `argsIgnorePattern: '^_'` rule — mirrors
// editor-state's audioSlice.ts `omitAudioTracks`/`omitClipTrackId`.
function omitAudioTracks({ audioTracks: _dropped, ...rest }: Project): Omit<Project, 'audioTracks'> {
  return rest;
}
function omitClipTrackId({ trackId: _t, ...rest }: Project['audioClips'][number]): Project['audioClips'][number] {
  return rest;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const num = { type: 'number' };
const str = { type: 'string' };
const bool = { type: 'boolean' };
/** The 4 named easings (`EasingName`) — narrower than the engine's `Easing` type (which also
 *  accepts a cubic-bezier tuple, not expressible as a single MCP string arg). Used to validate
 *  the `blend` tool's optional `easing` input. */
const EASING_NAMES: EasingName[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

/** SavigScript language cheat-sheet — embedded verbatim in every M9 interactivity tool's
 *  description (tool descriptions are the agent's manual; there is no other doc surface it sees). */
const SCRIPT_CHEATSHEET =
  'Expressions: numbers/strings/booleans, vars, time/sceneIndex/sceneTime/random(), ' +
  "xOf('objectId')/yOf('objectId') (sampled animated position — collision guards can read " +
  'keyframed objects directly), ' +
  '+ - * / % == != < <= > >= && || ?: — no loops/functions/member access; ≤500 chars.';

/** Optional frame-by-frame target on the add_* tools: with `layerId` + `time`, the new object is
 *  filed under the key that STARTS at `time` on that layer (created blank if none does), and its
 *  coordinates are read in the layer's space. */
const KEY_TARGET = { layerId: str, time: num };
const KEY_TARGET_DOC =
  ' Frame-by-frame: pass layerId + time to draw it on that frame of a frame layer (the key starting at `time` is created if missing; coordinates are layer-local).';

function addInScene(session: Session, a: Record<string, unknown>, build: (p: Project) => { project: Project; id: string }): { id: string; where: string } {
  const r = withScene(session.project, session.currentSceneId, (p) => {
    const made = build(p);
    if (a.layerId === undefined) return made;
    if (typeof a.layerId !== 'string' || typeof a.time !== 'number') throw new Error('layerId needs a numeric time (seconds) too');
    const key = frameKeyAtTime(made.project, a.layerId, a.time);
    return { project: putInFrameKey(key.project, made.id, a.layerId, key.id), id: made.id };
  });
  session.project = r.project;
  return { id: r.id, where: a.layerId === undefined ? '' : ` on layer "${a.layerId as string}" at ${a.time as number}s` };
}

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
    description: 'Replace the working project with a compiled ShortDoc (declarative JSON: meta + rect/ellipse/path/text objects with style, base, and animate tracks). ' +
      'Frame-by-frame: an object { type: "frames", id?, x?, y?, end?, keys: [{ time, label?, tween?, objects: [shapes in layer space] }] } is a cel layer — each key shows its drawing until the next key (the last until end); ' +
      'tween: "shape" (or { easing, hints: [{ a: {x,y}, b: {x,y} }] }) on a key morphs its drawing into the next key\'s (shape tween; hints pin outline spots). ' +
      'Masks: any object (or frames layer) with `mask: true` is not drawn — its filled area reveals every object with `maskedBy: "<mask id>"`; animate the mask for wipes/reveals. ' +
      'Filters: `filters: [{ kind: "blur"|"dropShadow"|"glow"|"adjustColor", id?, color?, enabled?, <param>: number, animate?: { <param>: [{ t, value, easing? }] } }]` on any object or frames layer, applied in order ' +
      '(blur: blur; dropShadow: dx, dy, blur, opacity, color; glow: blur, strength, opacity, color; adjustColor: brightness, contrast, saturation (-1..1), hue (deg)). ' +
      'Bones: { type: "bone", id?, x, y, length, angle? (deg, 0 = right, 90 = down), min?, max?, pinned?, base?: { rotation }, animate?: { rotation: [{ t, value, easing? }] }, children: [child bones | shapes] } is an armature tree — ' +
      'a child bone without x/y starts at its parent\'s tip; child shapes are attached drawings, written in REST-pose artboard coordinates; rotation (deg away from rest) is the pose. ' +
      'Skinning: a TOP-LEVEL rect/ellipse/path with an id and `skin: ["boneId", …]` is bent smoothly by those bones (a tail, tentacle, soft limb) instead of moving rigidly; write it in rest-pose coordinates.',
    inputSchema: obj({ doc: { type: 'object' } }, ['doc']),
    run(session, args) {
      session.project = compileShort(args.doc as ShortDoc);
      session.currentSceneId = session.project.scenes?.[0]?.id;
      return edited(session, `Loaded DSL.\n${validationText(session.project)}`);
    },
  },
  {
    name: 'add_rect',
    description: 'Add a rectangle at (x,y) with width/height. Optional id and fill/stroke/strokeWidth.' + KEY_TARGET_DOC,
    inputSchema: obj({ x: num, y: num, width: num, height: num, id: str, fill: str, stroke: str, strokeWidth: num, ...KEY_TARGET }, ['x', 'y', 'width', 'height']),
    run(session, a) {
      const r = addInScene(session, a, (p) =>
        addRect(p, { x: a.x as number, y: a.y as number, width: a.width as number, height: a.height as number, id: a.id as string | undefined, style: styleFrom(a) }),
      );
      return edited(session, `Added rect "${r.id}"${r.where}.`);
    },
  },
  {
    name: 'add_ellipse',
    description: 'Add an ellipse whose bounding box is (x,y,width,height). Optional id and fill/stroke/strokeWidth.' + KEY_TARGET_DOC,
    inputSchema: obj({ x: num, y: num, width: num, height: num, id: str, fill: str, stroke: str, strokeWidth: num, ...KEY_TARGET }, ['x', 'y', 'width', 'height']),
    run(session, a) {
      const r = addInScene(session, a, (p) =>
        addEllipse(p, { x: a.x as number, y: a.y as number, width: a.width as number, height: a.height as number, id: a.id as string | undefined, style: styleFrom(a) }),
      );
      return edited(session, `Added ellipse "${r.id}"${r.where}.`);
    },
  },
  {
    name: 'add_text',
    description: 'Add a text object (title/caption) at (x,y) = its top-left. Optional fontSize, fontFamily, fill, stroke, textAnchor (start/middle/end), id.' + KEY_TARGET_DOC,
    inputSchema: obj({ content: str, x: num, y: num, fontSize: num, fontFamily: str, fill: str, stroke: str, textAnchor: { type: 'string', enum: ['start', 'middle', 'end'] }, id: str, ...KEY_TARGET }, ['content', 'x', 'y']),
    run(session, a) {
      const r = addInScene(session, a, (p) =>
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
      return edited(session, `Added text "${r.id}"${r.where}.`);
    },
  },
  {
    name: 'add_path',
    description:
      'Add a vector path object. `path` = { nodes: [{ anchor: {x,y}, in?: {x,y}, out?: {x,y} }, …], closed } — ' +
      'anchors in artboard coords, in/out bezier handles as offsets from the anchor (absent = corner). ' +
      'Geometry is normalized to the bbox origin with the object base at the bbox top-left. Optional id and fill/stroke/strokeWidth.' + KEY_TARGET_DOC,
    inputSchema: obj({ path: { type: 'object' }, id: str, fill: str, stroke: str, strokeWidth: num, ...KEY_TARGET }, ['path']),
    run(session, a) {
      // Sanitize the raw agent-supplied structure (blend-count precedent): the MCP input schema
      // only enforces "object", and a nodes-less path would reach pathBounds as a raw TypeError.
      const path = a.path as Partial<PathData> | undefined;
      if (!path || !Array.isArray(path.nodes) || path.nodes.length < 2) {
        return { isError: true, content: [text('add_path: path.nodes must be an array of at least 2 { anchor: {x,y} } nodes')] };
      }
      const r = addInScene(session, a, (p) =>
        addPath(p, { path: path as PathData, id: a.id as string | undefined, style: styleFrom(a) }),
      );
      return edited(session, `Added path "${r.id}"${r.where}.`);
    },
  },
  {
    name: 'add_line',
    description:
      'Add a straight stroked line from (x1,y1) to (x2,y2) — the primitive for stick figures, limbs, ' +
      'ground lines, connectors. Visible by default (black 4px round-cap stroke); override with stroke/strokeWidth. Optional id.' + KEY_TARGET_DOC,
    inputSchema: obj({ x1: num, y1: num, x2: num, y2: num, id: str, stroke: str, strokeWidth: num, ...KEY_TARGET }, ['x1', 'y1', 'x2', 'y2']),
    run(session, a) {
      const path: PathData = {
        closed: false,
        nodes: [
          { anchor: { x: a.x1 as number, y: a.y1 as number } },
          { anchor: { x: a.x2 as number, y: a.y2 as number } },
        ],
      };
      const r = addInScene(session, a, (p) =>
        addPath(p, {
          path,
          id: a.id as string | undefined,
          style: {
            fill: 'none',
            stroke: (a.stroke as string | undefined) ?? '#000000',
            strokeWidth: (a.strokeWidth as number | undefined) ?? 4,
            strokeLinecap: 'round',
          },
        }),
      );
      return edited(session, `Added line "${r.id}"${r.where}.`);
    },
  },
  {
    name: 'add_frame_layer',
    description:
      'Add a frame-by-frame (cel) layer — Flash-style: each key shows its own drawing from its time until the next key, the last one until `end`. ' +
      '`keys` = start times in seconds (frame-snapped; default one key at 0), optional `labels` parallel to it. `end` defaults to one frame past the last key. ' +
      'The layer sits at (x,y) (default 0,0); drawings filed under it use layer-local coordinates. Draw into it with add_rect/add_ellipse/add_path/add_line/add_text + layerId/time, or lay existing drawings out with flipbook.',
    inputSchema: obj({ id: str, name: str, x: num, y: num, keys: { type: 'array', items: num }, labels: { type: 'array', items: str }, end: num }),
    run(session, a) {
      const times = (a.keys as number[] | undefined) ?? [];
      const labels = (a.labels as string[] | undefined) ?? [];
      const r = withScene(session.project, session.currentSceneId, (p) =>
        addFrameLayer(p, {
          id: a.id as string | undefined,
          name: a.name as string | undefined,
          x: a.x as number | undefined,
          y: a.y as number | undefined,
          end: a.end as number | undefined,
          keys: times.length ? times.map((time, i) => ({ time, label: labels[i] })) : undefined,
        }),
      );
      session.project = r.project;
      return edited(session, `Added frame layer "${r.id}".`);
    },
  },
  {
    name: 'add_frame_key',
    description:
      'Add a key on a frame layer at `time` (seconds). Blank by default (F7); copy_previous = true starts it with a copy of the drawing shown just before (F6), ready to tweak. ' +
      'The new key holds until the next key (or the layer end — a key past the end extends the layer). Optional label and id.',
    inputSchema: obj({ layerId: str, time: num, label: str, id: str, copy_previous: bool }, ['layerId', 'time']),
    run(session, a) {
      const r = withScene(session.project, session.currentSceneId, (p) =>
        addFrameKey(p, a.layerId as string, { time: a.time as number, label: a.label as string | undefined, id: a.id as string | undefined, copyPrevious: a.copy_previous === true }),
      );
      session.project = r.project;
      return edited(session, `Added ${a.copy_previous === true ? 'copied' : 'blank'} key "${r.id}" at ${a.time}s on "${a.layerId}".`);
    },
  },
  {
    name: 'insert_frames',
    description: 'F5 on a frame layer: hold the drawing at `time` for `count` more frames (default 1); later keys and the layer end shift right.',
    inputSchema: obj({ layerId: str, time: num, count: num }, ['layerId', 'time']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: insertFrames(p, a.layerId as string, a.time as number, (a.count as number | undefined) ?? 1),
      })).project;
      return edited(session, `Inserted ${(a.count as number | undefined) ?? 1} frame(s) at ${a.time}s on "${a.layerId}".`);
    },
  },
  {
    name: 'remove_frames',
    description:
      'Shift+F5 on a frame layer: remove `count` frames at `time` (default 1); later keys and the end shift left. A key whose hold shrinks to nothing is dropped with its drawing. Errors when impossible.',
    inputSchema: obj({ layerId: str, time: num, count: num }, ['layerId', 'time']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: removeFrames(p, a.layerId as string, a.time as number, (a.count as number | undefined) ?? 1),
      })).project;
      return edited(session, `Removed ${(a.count as number | undefined) ?? 1} frame(s) at ${a.time}s on "${a.layerId}".`);
    },
  },
  {
    name: 'clear_frame_key',
    description: 'Shift+F6 on a frame layer: delete key `keyId` and its drawing; the previous key then holds across its frames. The only key is kept but emptied.',
    inputSchema: obj({ layerId: str, keyId: str }, ['layerId', 'keyId']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: clearFrameKey(p, a.layerId as string, a.keyId as string),
      })).project;
      return edited(session, `Cleared key "${a.keyId}" on "${a.layerId}".`);
    },
  },
  {
    name: 'flipbook',
    description:
      'Lay existing top-level drawings out as consecutive frames of an EMPTY frame layer: `drawings` = one array of object ids per frame (draw them in layer space first, e.g. with add_ellipse). ' +
      'Each drawing is held `hold` frames (default 1; 2 = "on twos", 3 = "on threes"), starting at `start` (default 0). Replaces the layer\'s keys (ids "<layerId>-k0", "-k1", …) and sets its end.',
    inputSchema: obj({ layerId: str, drawings: { type: 'array', items: { type: 'array', items: str } }, hold: num, start: num }, ['layerId', 'drawings']),
    run(session, a) {
      const drawings = a.drawings as unknown;
      if (!Array.isArray(drawings) || !drawings.every((d) => Array.isArray(d) && d.every((x) => typeof x === 'string'))) {
        return { isError: true, content: [text('flipbook: drawings must be an array of arrays of object ids')] };
      }
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: flipbook(p, a.layerId as string, drawings as string[][], { hold: a.hold as number | undefined, start: a.start as number | undefined }),
      })).project;
      return edited(session, `Flipbook: ${drawings.length} drawing(s) on "${a.layerId}", ${(a.hold as number | undefined) ?? 1} frame(s) each.`);
    },
  },
  {
    name: 'shape_tween',
    description:
      'Flash "Create Shape Tween" on a frame layer: the drawing of one key morphs into the NEXT key\'s drawing over the frames between them — outline, solid fill/stroke colour and opacity blend. ' +
      'Pick the key by `keyId`, or by `time` (any time inside its span). Rectangles, ellipses and simple paths morph (paired in stacking order; an unpaired drawing shrinks into / grows out of its centre); text, groups and symbols just hold. ' +
      'Call again after editing either drawing to re-derive it; `easing` = linear (default) | easeIn | easeOut | easeInOut. ' +
      'Shape hints fix a morph that twists or slides: `hints` = [{ a: {x,y}, b: {x,y} }] in the layer\'s coordinates — the start drawing\'s outline point nearest `a` morphs to the end drawing\'s outline point nearest `b` ' +
      '(e.g. pin a star\'s top tip to a square\'s top-left corner). Put them in the same order around both outlines; up to 26; `[]` clears them; omitted keeps the existing ones.',
    inputSchema: obj({ layerId: str, keyId: str, time: num, easing: str, hints: { type: 'array', items: obj({ a: obj({ x: num, y: num }, ['x', 'y']), b: obj({ x: num, y: num }, ['x', 'y']) }, ['a', 'b']) } }, ['layerId']),
    run(session, a) {
      const key = keyArg(a);
      if (key === null) return { isError: true, content: [text('shape_tween: pass keyId or time')] };
      const easing = a.easing as string | undefined;
      if (easing !== undefined && !EASING_NAMES.includes(easing as EasingName)) {
        return { isError: true, content: [text(`shape_tween: invalid easing "${easing}" — must be one of ${EASING_NAMES.join(', ')}`)] };
      }
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: shapeTween(p, a.layerId as string, key, { easing: easing as EasingName | undefined, ...(a.hints !== undefined ? { hints: a.hints as ShapeHint[] } : {}) }),
      })).project;
      return edited(session, `Shape tween on "${a.layerId}" from key ${typeof key === 'string' ? `"${key}"` : `at ${key}s`} to the next key.`);
    },
  },
  {
    name: 'remove_shape_tween',
    description: 'Remove a frame layer key\'s shape tween (by `keyId` or a `time` inside its span): its drawing holds again, as it was at the key.',
    inputSchema: obj({ layerId: str, keyId: str, time: num }, ['layerId']),
    run(session, a) {
      const key = keyArg(a);
      if (key === null) return { isError: true, content: [text('remove_shape_tween: pass keyId or time')] };
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: removeShapeTween(p, a.layerId as string, key),
      })).project;
      return edited(session, `Removed the shape tween on "${a.layerId}".`);
    },
  },
  {
    name: 'add_bone',
    description:
      'Flash-style bone (armature): a joint at (x, y) pointing `angle` degrees (0 = right, 90 = down) for `length` px. Pass `parentId` to chain it onto another bone — it then starts at that bone\'s tip unless x/y are given. ' +
      'Coordinates are artboard space while the armature is at rest, so lay the whole skeleton out, attach drawings (attach_to_bone), then pose it (pose_ik / set_bone_rotation). ' +
      '`min`/`max` limit the joint (degrees away from rest); `pinned` stops IK from rotating it or anything above it. Bones are never drawn.',
    inputSchema: obj({ id: str, name: str, parentId: str, x: num, y: num, length: num, angle: num, min: num, max: num, pinned: bool }, ['length']),
    run(session, a) {
      let id = '';
      session.project = withScene(session.project, session.currentSceneId, (p) => {
        const r = addBone(p, a as unknown as Parameters<typeof addBone>[1]);
        id = r.id;
        return { project: r.project };
      }).project;
      return edited(session, `Added bone "${id}"${a.parentId ? ` on "${a.parentId}"` : ''}.`);
    },
  },
  {
    name: 'attach_to_bone',
    description: 'Attach drawings (`objectIds`) to bone `boneId`: they stay where they are on screen and from then on move with the bone when it rotates (an arm\'s sleeve, a hand).',
    inputSchema: obj({ boneId: str, objectIds: { type: 'array', items: str } }, ['boneId', 'objectIds']),
    run(session, a) {
      const ids = a.objectIds as unknown;
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) return { isError: true, content: [text('attach_to_bone: objectIds must be an array of ids')] };
      session.project = withScene(session.project, session.currentSceneId, (p) => ({ project: attachToBone(p, a.boneId as string, ids as string[]) })).project;
      return edited(session, `Attached ${ids.length} object(s) to bone "${a.boneId}".`);
    },
  },
  {
    name: 'pose_ik',
    description:
      'Inverse kinematics: bend bone `boneId` and the bones above it (up to a pinned bone) so its tip reaches (x, y) in artboard space at `time`, keyframing the rotation of every bone in that chain there. ' +
      'Pose at two or more times to animate (e.g. a wave); joint limits are respected and an unreachable target leaves the chain pointing at it. `easing` applies to the keys written.',
    inputSchema: obj({ boneId: str, x: num, y: num, time: num, easing: str }, ['boneId', 'x', 'y', 'time']),
    run(session, a) {
      const easing = a.easing as string | undefined;
      if (easing !== undefined && !EASING_NAMES.includes(easing as EasingName)) {
        return { isError: true, content: [text(`pose_ik: invalid easing "${easing}" — must be one of ${EASING_NAMES.join(', ')}`)] };
      }
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: poseIK(p, a.boneId as string, { x: a.x as number, y: a.y as number }, { time: a.time as number, easing: easing as EasingName | undefined }),
      })).project;
      return edited(session, `Posed "${a.boneId}" toward (${a.x}, ${a.y}) at ${a.time}s.`);
    },
  },
  {
    name: 'set_bone_rotation',
    description:
      'Forward kinematics: rotate one bone to `rotation` degrees away from its rest direction (clamped to its limits); its child bones and drawings follow. With `time` it writes a keyframe, without it the static pose.',
    inputSchema: obj({ boneId: str, rotation: num, time: num, easing: str }, ['boneId', 'rotation']),
    run(session, a) {
      const easing = a.easing as string | undefined;
      if (easing !== undefined && !EASING_NAMES.includes(easing as EasingName)) {
        return { isError: true, content: [text(`set_bone_rotation: invalid easing "${easing}" — must be one of ${EASING_NAMES.join(', ')}`)] };
      }
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: setBoneRotation(p, a.boneId as string, a.rotation as number, { time: a.time as number | undefined, easing: easing as EasingName | undefined }),
      })).project;
      return edited(session, `Bone "${a.boneId}" rotation ${a.rotation}°${a.time !== undefined ? ` at ${a.time}s` : ''}.`);
    },
  },
  {
    name: 'bind_skin',
    description:
      'Bone skinning (Flash shape armature): bend ONE drawing (`objectId`: a rect, ellipse or path — rects/ellipses become paths in place) smoothly with `boneIds`, instead of moving it rigidly. ' +
      'Use it for tails, tentacles, ropes, soft limbs: lay the bones along the drawing (it must NOT be attached to a bone), bind, then pose the bones (pose_ik / set_bone_rotation). ' +
      'The drawing is captured against the armature at `time` (default 0); `atRest: true` captures it with every bone at rotation 0.',
    inputSchema: obj({ objectId: str, boneIds: { type: 'array', items: str }, time: num, atRest: bool }, ['objectId', 'boneIds']),
    run(session, a) {
      const ids = a.boneIds as unknown;
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) return { isError: true, content: [text('bind_skin: boneIds must be an array of bone ids')] };
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: bindSkin(p, a.objectId as string, ids as string[], { time: a.time as number | undefined, atRest: a.atRest as boolean | undefined }),
      })).project;
      return edited(session, `Bound "${a.objectId}" to ${ids.length} bone(s).`);
    },
  },
  {
    name: 'unbind_skin',
    description: 'Remove a drawing\'s skin: it stops bending with the bones and keeps its rest outline.',
    inputSchema: obj({ objectId: str }, ['objectId']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({ project: unbindSkin(p, a.objectId as string) })).project;
      return edited(session, `Unbound "${a.objectId}".`);
    },
  },
  {
    name: 'create_mask',
    description:
      'Flash-style mask: `maskId` (an existing shape, group or frame layer) stops being drawn and its filled AREA (colour ignored, alpha respected) reveals each of `targetIds`; ' +
      'everything outside it is hidden. Animate the mask (move/scale/morph) for wipes, spotlights and reveals. Put the mask above its targets by convention.',
    inputSchema: obj({ maskId: str, targetIds: { type: 'array', items: str } }, ['maskId', 'targetIds']),
    run(session, a) {
      const targetIds = a.targetIds as unknown;
      if (!Array.isArray(targetIds) || !targetIds.every((x) => typeof x === 'string')) {
        return { isError: true, content: [text('create_mask: targetIds must be an array of object ids')] };
      }
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: createMask(p, a.maskId as string, targetIds as string[]),
      })).project;
      return edited(session, `"${a.maskId}" now masks ${(targetIds as string[]).join(', ')}.`);
    },
  },
  {
    name: 'release_mask',
    description: 'Turn a mask back into an ordinary drawn object and unlink everything it masked.',
    inputSchema: obj({ maskId: str }, ['maskId']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: releaseMask(p, a.maskId as string),
      })).project;
      return edited(session, `Released mask "${a.maskId}".`);
    },
  },
  {
    name: 'reveal',
    description:
      'Macro: reveal objects with an animated mask in one call. style "wipe" (default) grows a rectangle from `from` (left/right/top/bottom, default left); ' +
      '"iris" grows a circle from the centre. The mask covers the targets\' combined bounds (or `bounds` {x,y,width,height}, required for text/svg/symbol targets). ' +
      'start (default 0) / duration (default 1) in seconds. Returns the mask id.',
    inputSchema: obj({
      targetIds: { type: 'array', items: str },
      style: { type: 'string', enum: ['wipe', 'iris'] },
      from: { type: 'string', enum: ['left', 'right', 'top', 'bottom'] },
      start: num,
      duration: num,
      easing: str,
      bounds: obj({ x: num, y: num, width: num, height: num }, ['x', 'y', 'width', 'height']),
      id: str,
    }, ['targetIds']),
    run(session, a) {
      const targetIds = a.targetIds as unknown;
      if (!Array.isArray(targetIds) || !targetIds.every((x) => typeof x === 'string')) {
        return { isError: true, content: [text('reveal: targetIds must be an array of object ids')] };
      }
      let maskId = '';
      session.project = withScene(session.project, session.currentSceneId, (p) => {
        const r = reveal(p, {
          targetIds: targetIds as string[],
          style: a.style as 'wipe' | 'iris' | undefined,
          from: a.from as 'left' | 'right' | 'top' | 'bottom' | undefined,
          start: a.start as number | undefined,
          duration: a.duration as number | undefined,
          easing: a.easing as Easing | undefined,
          bounds: a.bounds as { x: number; y: number; width: number; height: number } | undefined,
          id: a.id as string | undefined,
        });
        maskId = r.maskId;
        return { project: r.project };
      }).project;
      return edited(session, `Reveal mask "${maskId}" added over ${(targetIds as string[]).join(', ')}.`);
    },
  },
  {
    name: 'add_filter',
    description:
      'Add a Flash-style filter to an object (shape, text, group, frames layer or symbol instance). Filters stack in order, each feeding the next. ' +
      `${FILTER_HELP}. Omitted params take defaults. Returns the filter id (use it with set_filter / animate_filter / remove_filter).`,
    inputSchema: obj({
      objectId: str,
      kind: { type: 'string', enum: ['blur', 'dropShadow', 'glow', 'adjustColor'] },
      params: { type: 'object', additionalProperties: num },
      color: str,
      enabled: { type: 'boolean' },
      id: str,
    }, ['objectId', 'kind']),
    run(session, a) {
      let filterId = '';
      session.project = withScene(session.project, session.currentSceneId, (p) => {
        const r = addFilter(p, a.objectId as string, {
          kind: a.kind as 'blur',
          id: a.id as string | undefined,
          params: a.params as Record<string, number> | undefined,
          color: a.color as string | undefined,
          enabled: a.enabled as boolean | undefined,
        });
        filterId = r.filterId;
        return { project: r.project };
      }).project;
      return edited(session, `Added ${a.kind} filter "${filterId}" to "${a.objectId}".`);
    },
  },
  {
    name: 'set_filter',
    description: 'Change a filter\'s static params, color, or enabled flag (a param with keyframes follows its track instead — use animate_filter).',
    inputSchema: obj({
      objectId: str,
      filterId: str,
      params: { type: 'object', additionalProperties: num },
      color: str,
      enabled: { type: 'boolean' },
    }, ['objectId', 'filterId']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: setFilter(p, a.objectId as string, a.filterId as string, {
          params: a.params as Record<string, number> | undefined,
          color: a.color as string | undefined,
          enabled: a.enabled as boolean | undefined,
        }),
      })).project;
      return edited(session, `Updated filter "${a.filterId}" on "${a.objectId}".`);
    },
  },
  {
    name: 'remove_filter',
    description: 'Remove a filter (and its keyframes) from an object.',
    inputSchema: obj({ objectId: str, filterId: str }, ['objectId', 'filterId']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: removeFilter(p, a.objectId as string, a.filterId as string),
      })).project;
      return edited(session, `Removed filter "${a.filterId}" from "${a.objectId}".`);
    },
  },
  {
    name: 'animate_filter',
    description: 'Keyframe one filter param over time (replaces that param\'s track): keyframes [{ t (seconds), value, easing? }]. E.g. a glow pulsing: param "strength", [{t:0,value:0},{t:0.5,value:3},{t:1,value:0}].',
    inputSchema: obj({
      objectId: str,
      filterId: str,
      param: str,
      keyframes: { type: 'array', items: obj({ t: num, value: num, easing: str }, ['t', 'value']) },
    }, ['objectId', 'filterId', 'param', 'keyframes']),
    run(session, a) {
      const kfs = a.keyframes as unknown;
      if (!Array.isArray(kfs)) return { isError: true, content: [text('animate_filter: keyframes must be an array')] };
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: animateFilter(p, a.objectId as string, a.filterId as string, a.param as string, kfs as Array<{ t: number; value: number; easing?: Easing }>),
      })).project;
      return edited(session, `Animated ${a.param} of filter "${a.filterId}" on "${a.objectId}" (${(kfs as unknown[]).length} keyframes).`);
    },
  },
  {
    name: 'set_anchor',
    description:
      'Move an object\'s rotation/scale pivot. Default mode is the object\'s current one (vector shapes start ' +
      'in \'fraction\': x/y are 0..1 of the shape bbox — {x:0.5,y:0} = top-centre, e.g. a limb\'s joint; ' +
      '\'absolute\' = user units). Rotation keyframes then swing about this point.',
    inputSchema: obj({ objectId: str, x: num, y: num, mode: { type: 'string', enum: ['fraction', 'absolute'] } }, ['objectId', 'x', 'y']),
    run(session, a) {
      session.project = withScene(session.project, session.currentSceneId, (p) => ({
        project: setAnchor(p, a.objectId as string, { x: a.x as number, y: a.y as number, mode: a.mode as AnchorMode | undefined }),
      })).project;
      return edited(session, `Anchor set on "${a.objectId}" (${a.x}, ${a.y}${a.mode ? `, ${a.mode}` : ''}).`);
    },
  },
  {
    name: 'set_keyframe',
    description: 'Upsert a keyframe on an object track (property: x/y/scaleX/scaleY/rotation/opacity/width/height/…). Primitive-property keyframes (sides/starPoints/innerRatio/primitiveRotation) on an object with a shape morph track are shadowed (morph wins) and only inflate duration.',
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
    description:
      'Return the self-contained SVG document for the current project (the deliverable). ' +
      'Default: SMIL-animated — plays anywhere, including <img>. Pass animated:false for a static frame-0 snapshot.',
    inputSchema: obj({ animated: bool }),
    run(session, a) {
      const animated = (a.animated as boolean | undefined) ?? true;
      const markup = animated
        ? renderAnimatedSvgNode(session.project)
        : renderProjectDocument(session.project);
      return { content: [text(markup)] };
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
  {
    name: 'add_audio_track',
    description:
      'Add a mixer lane (multitrack audio) — PROJECT-level (the master timeline), not scene-scoped. ' +
      'gain: 0..1 linear (default 1). pan: -1..1, 0 = centre (default: no pan). ' +
      'filter_kind: lowpass/highpass with filter_frequency 10..24000 Hz (default 1000 when a kind is given without one).',
    inputSchema: obj({ name: str, gain: num, pan: num, filter_kind: { type: 'string', enum: ['lowpass', 'highpass'] }, filter_frequency: num }),
    run(session, a) {
      const filter = a.filter_kind !== undefined
        ? { kind: a.filter_kind as 'lowpass' | 'highpass', frequency: (a.filter_frequency as number | undefined) ?? 1000 }
        : undefined;
      const r = addAudioTrack(session.project, {
        name: a.name as string | undefined,
        gain: a.gain as number | undefined,
        pan: a.pan as number | undefined,
        filter,
      });
      session.project = r.project;
      return edited(session, `Audio track "${r.id}" added.`);
    },
  },
  {
    name: 'set_audio_track',
    description:
      'Update a mixer lane. gain: 0..1 linear. pan: -1..1, 0 clears back to centre. muted/solo: booleans. ' +
      'filter_kind: \'none\' clears the filter, otherwise lowpass/highpass with filter_frequency 10..24000 Hz (default 1000 when omitted).',
    inputSchema: obj({ trackId: str, name: str, gain: num, muted: bool, solo: bool, pan: num, filter_kind: { type: 'string', enum: ['none', 'lowpass', 'highpass'] }, filter_frequency: num }, ['trackId']),
    run(session, a) {
      const trackId = a.trackId as string;
      if (!(session.project.audioTracks ?? []).some((t) => t.id === trackId)) {
        throw new Error(`savig/mcp: no audio track with id "${trackId}"`);
      }
      if (a.pan !== undefined || a.filter_kind !== undefined) {
        const filter =
          a.filter_kind === undefined
            ? undefined
            : a.filter_kind === 'none'
              ? null
              : { kind: a.filter_kind as 'lowpass' | 'highpass', frequency: (a.filter_frequency as number | undefined) ?? 1000 };
        session.project = setTrackEffect(session.project, trackId, { pan: a.pan as number | undefined, filter });
      }
      if (a.name !== undefined || a.gain !== undefined || a.muted !== undefined || a.solo !== undefined) {
        session.project = {
          ...session.project,
          audioTracks: (session.project.audioTracks ?? []).map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  ...(a.name !== undefined ? { name: a.name as string } : {}),
                  ...(a.gain !== undefined ? { gain: a.gain as number } : {}),
                  ...(a.muted !== undefined ? { muted: a.muted as boolean } : {}),
                  ...(a.solo !== undefined ? { solo: a.solo as boolean } : {}),
                }
              : t,
          ),
        };
      }
      return edited(session, `Audio track "${trackId}" updated.`);
    },
  },
  {
    name: 'add_audio_clip',
    description:
      'Add an audio clip to the PROJECT-level master timeline (not scene-scoped). at/inPoint/outPoint are seconds ' +
      '(inPoint must be < outPoint, and within the asset\'s duration). trackId optional — absent or a dangling id ' +
      'plays on the implicit default lane. volume: 0..1 linear (default 1). fadeIn/fadeOut: seconds, clamped to the clip length at runtime.',
    inputSchema: obj({ assetId: str, at: num, inPoint: num, outPoint: num, trackId: str, volume: num, fadeIn: num, fadeOut: num }, ['assetId', 'at', 'inPoint', 'outPoint']),
    run(session, a) {
      const r = addAudioClip(session.project, {
        assetId: a.assetId as string,
        trackId: a.trackId as string | undefined,
        at: a.at as number,
        inPoint: a.inPoint as number,
        outPoint: a.outPoint as number,
        volume: a.volume as number | undefined,
        fadeIn: a.fadeIn as number | undefined,
        fadeOut: a.fadeOut as number | undefined,
      });
      session.project = r.project;
      return edited(session, `Audio clip "${r.id}" added.`);
    },
  },
  {
    name: 'set_audio_clip',
    description:
      'Update an existing audio clip. at/inPoint/outPoint are seconds. trackId \'\' (empty string) clears back to the ' +
      'default lane. fadeIn/fadeOut: seconds, a value of 0 clears the fade (clamped to the clip length at runtime). volume: 0..1 linear.',
    inputSchema: obj({ clipId: str, at: num, inPoint: num, outPoint: num, trackId: str, fadeIn: num, fadeOut: num, volume: num }, ['clipId']),
    run(session, a) {
      const clipId = a.clipId as string;
      if (!session.project.audioClips.some((c) => c.id === clipId)) {
        throw new Error(`savig/mcp: no audio clip with id "${clipId}"`);
      }
      session.project = {
        ...session.project,
        audioClips: session.project.audioClips.map((c) => {
          if (c.id !== clipId) return c;
          const next = { ...c };
          if (a.at !== undefined) next.startTime = a.at as number;
          if (a.inPoint !== undefined) next.inPoint = a.inPoint as number;
          if (a.outPoint !== undefined) next.outPoint = a.outPoint as number;
          if (a.volume !== undefined) next.volume = a.volume as number;
          if (a.trackId !== undefined) {
            if (a.trackId === '') delete next.trackId;
            else next.trackId = a.trackId as string;
          }
          for (const key of ['fadeIn', 'fadeOut'] as const) {
            const v = a[key] as number | undefined;
            if (v === undefined) continue;
            if (v === 0) delete next[key];
            else next[key] = v;
          }
          return next;
        }),
      };
      return edited(session, `Audio clip "${clipId}" updated.`);
    },
  },
  {
    name: 'remove_audio_track',
    description: 'Remove a mixer lane. Clips assigned to it fall back to the default lane (their trackId is cleared, not the clip deleted).',
    inputSchema: obj({ trackId: str }, ['trackId']),
    run(session, a) {
      const trackId = a.trackId as string;
      const remaining = (session.project.audioTracks ?? []).filter((t) => t.id !== trackId);
      session.project = {
        ...omitAudioTracks(session.project),
        ...(remaining.length ? { audioTracks: remaining } : {}), // absent stays absent
        audioClips: session.project.audioClips.map((c) => (c.trackId === trackId ? omitClipTrackId(c) : c)),
      };
      return edited(session, `Audio track "${trackId}" removed.`);
    },
  },
  {
    name: 'remove_audio_clip',
    description: 'Remove an audio clip from the master timeline.',
    inputSchema: obj({ clipId: str }, ['clipId']),
    run(session, a) {
      const clipId = a.clipId as string;
      session.project = { ...session.project, audioClips: session.project.audioClips.filter((c) => c.id !== clipId) };
      return edited(session, `Audio clip "${clipId}" removed.`);
    },
  },
  {
    name: 'add_behavior',
    description:
      'Attach a behavior (event → actions) to an object, or add a project-level global handler when objectId is omitted. ' +
      'Pointer events (click/pointerdown/pointerup/hoverEnter/hoverLeave) go on an object; global events ' +
      '(keydown/keyup/sceneStart/sceneEnd/tick) are project handlers — validate flags a mismatched placement. ' +
      'key is required for keydown/keyup (exact KeyboardEvent.key, e.g. "ArrowLeft"). sceneId (sceneStart/sceneEnd) ' +
      'restricts to one scene; absent = every scene. actions: an array of { kind, args?, if? } — kind one of ' +
      'play/pause/stop/seek/gotoScene/setVar/show/hide/setOpacity/setPosition/setText. Object actions ' +
      '(show/hide/setOpacity/setPosition/setText) default to the behavior\'s own object; on a project handler they ' +
      'REQUIRE an explicit args.targetId. objectId is looked up across every scene, not just the one you\'re editing. ' +
      SCRIPT_CHEATSHEET,
    inputSchema: obj(
      { objectId: str, event: str, key: str, sceneId: str, actions: { type: 'array', items: { type: 'object' } } },
      ['event', 'actions'],
    ),
    run(session, a) {
      const objectId = (a.objectId as string | undefined) ?? null;
      const r = addBehavior(session.project, objectId, {
        event: a.event as Behavior['event'],
        ...(a.key !== undefined ? { key: a.key as string } : {}),
        ...(a.sceneId !== undefined ? { sceneId: a.sceneId as string } : {}),
        actions: a.actions as BehaviorAction[],
      });
      session.project = r.project;
      return edited(session, `Behavior "${r.id}" added${objectId ? ` to "${objectId}"` : ' as a project handler'}.`);
    },
  },
  {
    name: 'set_behavior',
    description:
      `Update an existing behavior's event/key/sceneId/actions (partial patch — omitted fields are unchanged). ` +
      'Pass the same objectId used to create it (absent = project handler). ' + SCRIPT_CHEATSHEET,
    inputSchema: obj(
      { objectId: str, behaviorId: str, event: str, key: str, sceneId: str, actions: { type: 'array', items: { type: 'object' } } },
      ['behaviorId'],
    ),
    run(session, a) {
      const objectId = (a.objectId as string | undefined) ?? null;
      const behaviorId = a.behaviorId as string;
      const patch: Partial<Omit<Behavior, 'id'>> = {
        ...(a.event !== undefined ? { event: a.event as Behavior['event'] } : {}),
        ...(a.key !== undefined ? { key: a.key as string } : {}),
        ...(a.sceneId !== undefined ? { sceneId: a.sceneId as string } : {}),
        ...(a.actions !== undefined ? { actions: a.actions as BehaviorAction[] } : {}),
      };
      session.project = updateBehavior(session.project, objectId, behaviorId, patch);
      return edited(session, `Behavior "${behaviorId}" updated.`);
    },
  },
  {
    name: 'remove_behavior',
    description:
      'Remove a behavior from an object, or a project-level handler when objectId is omitted. ' + SCRIPT_CHEATSHEET,
    inputSchema: obj({ objectId: str, behaviorId: str }, ['behaviorId']),
    run(session, a) {
      const objectId = (a.objectId as string | undefined) ?? null;
      const behaviorId = a.behaviorId as string;
      session.project = removeBehavior(session.project, objectId, behaviorId);
      return edited(session, `Behavior "${behaviorId}" removed.`);
    },
  },
  {
    name: 'set_variable',
    description:
      'Declare or update a project-level interaction variable (upsert by name). initial (number/string/boolean) is ' +
      'its DECLARED reset value only — reset() restores it, but a setVar action may store a different type at ' +
      'runtime (dynamically typed). ' + SCRIPT_CHEATSHEET,
    inputSchema: obj({ name: str, initial: {} }, ['name', 'initial']),
    run(session, a) {
      session.project = setVariable(session.project, a.name as string, a.initial as Value);
      return edited(session, `Variable "${a.name}" set.`);
    },
  },
  {
    name: 'remove_variable',
    description: 'Remove a declared project-level interaction variable. ' + SCRIPT_CHEATSHEET,
    inputSchema: obj({ name: str }, ['name']),
    run(session, a) {
      session.project = removeVariable(session.project, a.name as string);
      return edited(session, `Variable "${a.name}" removed.`);
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
