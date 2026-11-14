// Shared sampling for the declarative exporters (SMIL `animatedSvg.ts`, CSS `cssSvg.ts`): sample
// the runtime frame engine at project fps, per-object value series, the scene/camera/dip series
// (replicating applyProjectFrame), the rendered-document parse and the embedded source metadata.
import { computeCameraTransform, computeProjectDuration, computeSceneCameraTransform, fmt, projectScenes, sceneAtTime } from '@savig/engine';
import type { Project } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import type { FrameItem } from '@savig/runtime/frame';
import { stableJson } from '../json';
import { bytesToBase64 } from '../bytes';
import type { AssetBinaries } from './buildBundle';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** DOM constructors, injectable for the Node/MCP path (jsdom). Defaults to globals. */
export interface DomEnv {
  DOMParser: typeof DOMParser;
  XMLSerializer: typeof XMLSerializer;
}

export interface Sampled {
  /** Uniform sample times 0..duration (N+1 entries) — for LINEAR (default calcMode) animates,
   *  keyTimes is omittable because SMIL already divides duration into n−1 equal intervals
   *  matching this grid. */
  times: number[];
  /** frames[i] = computeFrame(project, times[i]) */
  frames: FrameItem[][];
  duration: number;
  loop: boolean;
  /** Explicit keyTimes string "0;1/N;2/N;…;1" (N+1 values, `fmt`-formatted) for calcMode="discrete"
   *  animates: SMIL divides discrete duration into n EQUAL periods (n = value count = N+1), so
   *  without this the value at sample i would switch at i·dur/(N+1) instead of the intended
   *  i·dur/N — misaligning every discrete track by up to one frame. Computed once per export and
   *  shared across every discrete-calcMode emission site (determinism preserved). */
  discreteKeyTimes: string;
}

export function sampleProject(project: Project): Sampled | null {
  const duration = computeProjectDuration(project);
  if (!(duration > 0)) return null;
  const n = Math.max(1, Math.round(duration * project.meta.fps));
  const times: number[] = [];
  const frames: FrameItem[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i * duration) / n;
    times.push(t);
    frames.push(computeFrame(project, t));
  }
  const discreteKeyTimes = times.map((t) => fmt(t / duration)).join(';');
  return { times, frames, duration, loop: project.meta.loop, discreteKeyTimes };
}

/** Per-object per-frame series. Multi-scene computeFrame omits inactive scenes' objects, so
 *  gaps hold the last seen value (leading gaps take the first seen) — the scene group is
 *  hidden during a gap, so held values are invisible but keep list lengths uniform. */
export function seriesFor(
  frames: FrameItem[][],
  objectId: string,
  pick: (it: FrameItem) => string | undefined,
): (string | undefined)[] {
  const raw = frames.map((frame) => {
    const item = frame.find((it) => it.objectId === objectId);
    return item ? pick(item) : undefined;
  });
  let first: string | undefined;
  for (const v of raw) if (v !== undefined) { first = v; break; }
  let prev = first;
  return raw.map((v) => (v === undefined ? prev : ((prev = v), v)));
}

/** A frame-layer leaf's per-sample `visibility` series, or null when it isn't frame-controlled
 *  or never changes. The final sample (the timeline's end instant) already holds the last
 *  drawing — computeFrame's end hold — so a non-looping `fill="freeze"` stops on it. */
export function frameLayerVisibility(frames: FrameItem[][], objectId: string): string[] | null {
  const values = seriesFor(frames, objectId, (it) => it.visibility);
  if (values.some((v) => v === undefined) || isConstant(values)) return null;
  return values as string[];
}

export function isConstant(values: (string | undefined)[]): boolean {
  return values.every((v) => v === values[0]);
}

/** Embed the editable source (full project JSON + referenced audio binaries) as the root's
 *  first child. textContent assignment makes XMLSerializer entity-escape the JSON, so this
 *  survives any string content and decodes transparently on DOMParser read (open path). */
export function embedProjectMetadata(doc: Document, project: Project, binaries?: AssetBinaries): void {
  const audio: Record<string, string> = {};
  for (const clip of project.audioClips) {
    const bytes = binaries?.[clip.assetId];
    if (bytes) audio[clip.assetId] = bytesToBase64(bytes);
  }
  const meta = doc.createElementNS(SVG_NS, 'metadata');
  meta.setAttribute('data-savig-source', 'project');
  meta.textContent = stableJson({ audio, project });
  doc.documentElement.insertBefore(meta, doc.documentElement.firstChild);
}

/** Parse renderDocument's markup as XML. Its camera wrap emits a bare `data-savig-camera` (no
 *  value) — a valid HTML boolean attribute that strict `image/svg+xml` parsing rejects — so the
 *  EXACT tag-open sequence both renderDocument call sites emit is normalized first (never a bare
 *  substring, which could occur inside escaped text). */
export function parseRenderedDocument(markup: string, Parser: typeof DOMParser): Document {
  return new Parser().parseFromString(
    markup.replace(/<g data-savig-camera transform="/g, '<g data-savig-camera="" transform="'),
    'image/svg+xml',
  );
}

/** The single-scene root camera transform per sample. */
export function rootCameraSeries(project: Project, sampled: Sampled): string[] {
  return sampled.times.map((t) => computeCameraTransform(project, t) ?? '');
}

export interface SceneTrack {
  display: string[];
  opacity: string[];
  camera: string[];
}

/** Per-sample scene/camera state, replicating applyProjectFrame's decisions (packages/runtime/src/
 *  frame.ts) exactly: crossfade fades IN the incoming (primary) group while the outgoing stays
 *  full opacity; dip shows the outgoing group in the first half of the overlap and the incoming in
 *  the second half, with a full-frame overlay ramping opacity 0→1→0 (triangle) in the dip color. */
export function sceneSeries(project: Project, sampled: Sampled): { perScene: Map<string, SceneTrack>; dip: { display: string[]; opacity: string[]; fill: string[] }; anyDip: boolean } {
  const scenes = projectScenes(project);
  const perScene = new Map<string, SceneTrack>();
  for (const s of scenes) perScene.set(s.id, { display: [], opacity: [], camera: [] });
  const dip = { display: [] as string[], opacity: [] as string[], fill: [] as string[] };
  let anyDip = false;
  const lastCamera = new Map<string, string>();

  for (const t of sampled.times) {
    const { primary, outgoing } = sceneAtTime(project, t);
    const transition = outgoing ? primary.scene.transitionIn : undefined;
    const dipT = transition && transition.kind === 'dip' ? transition : null;
    const crossfade = !!(transition && transition.kind === 'crossfade');
    const second = outgoing ? outgoing.progress >= 0.5 : false;

    for (const s of scenes) {
      const st = perScene.get(s.id)!;
      let visible = false;
      let opacity = '1';
      let localTime: number | null = null;
      if (s.id === primary.scene.id) {
        visible = dipT ? second : true;
        if (outgoing && crossfade) opacity = fmt(outgoing.progress);
        localTime = primary.localTime;
      } else if (outgoing && s.id === outgoing.scene.id) {
        visible = dipT ? !second : true;
        localTime = outgoing.localTime;
      }
      st.display.push(visible ? 'inline' : 'none');
      st.opacity.push(opacity);
      const camT = localTime !== null
        ? computeSceneCameraTransform(s.camera, project.meta.width, project.meta.height, localTime)
        : null;
      const held = camT ?? lastCamera.get(s.id) ?? '';
      lastCamera.set(s.id, held);
      st.camera.push(held);
    }

    if (outgoing && dipT) {
      anyDip = true;
      const pgs = outgoing.progress;
      dip.display.push('inline');
      dip.opacity.push(fmt(pgs < 0.5 ? pgs / 0.5 : (1 - pgs) / 0.5));
      dip.fill.push(dipT.color);
    } else {
      dip.display.push('none');
      dip.opacity.push('0');
      dip.fill.push(dip.fill[dip.fill.length - 1] ?? '#000000');
    }
  }

  return { perScene, dip, anyDip };
}

/** The eager dip overlay rect (same geometry as the runtime's lazy ensureDipOverlay), appended
 *  last = top z, initially hidden. */
export function appendDipOverlay(doc: Document, project: Project, fill: string): Element {
  const rect = doc.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('data-savig-dip', '');
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width', fmt(project.meta.width));
  rect.setAttribute('height', fmt(project.meta.height));
  rect.setAttribute('opacity', '0');
  rect.setAttribute('display', 'none');
  rect.setAttribute('fill', fill);
  doc.documentElement.appendChild(rect);
  return rect;
}
