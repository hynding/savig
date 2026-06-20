export type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface CubicBezierEasing {
  readonly type: 'cubicBezier';
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  readonly p4: number;
}

export type Easing = EasingName | CubicBezierEasing;

export type RotationMode = 'shortest' | 'raw';

export type GeometryProperty =
  | 'width'
  | 'height'
  | 'cornerRadius'
  | 'radiusX'
  | 'radiusY';

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | GeometryProperty;

export type ResolvedGeometry = Partial<Record<GeometryProperty, number>>;

export interface Keyframe {
  /** Seconds from the start of the timeline. */
  time: number;
  value: number;
  easing: Easing;
  /** Only meaningful on the `rotation` track. Defaults to "shortest" when omitted. */
  rotationMode?: RotationMode;
}

export interface Transform2D {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

export type AnchorMode = 'absolute' | 'fraction';

export interface SceneObject {
  id: string;
  name: string;
  assetId: string;
  zOrder: number;
  parentId?: string;
  anchorX: number;
  anchorY: number;
  /** Static values used for a property when it has no keyframes. */
  base: Transform2D;
  tracks: Partial<Record<AnimatableProperty, Keyframe[]>>;
  /** Static geometry values for vector objects when a geometry property has no keyframes. */
  shapeBase?: ResolvedGeometry;
  /**
   * How anchorX/anchorY are interpreted. 'absolute' (default) = user units, as for
   * imported SVGs. 'fraction' = 0..1 of the shape bbox, resolved per-frame so the
   * pivot stays centered while geometry animates. Vector objects use 'fraction'.
   */
  anchorMode?: AnchorMode;
}

export interface SvgAsset {
  id: string;
  kind: 'svg';
  name: string;
  /** id-namespaced, sanitized SVG markup. */
  normalizedContent: string;
  viewBox: string;
  width: number;
  height: number;
}

export interface AudioAsset {
  id: string;
  kind: 'audio';
  name: string;
  mimeType: string;
}

export type VectorShapeType = 'rect' | 'ellipse' | 'path';

export interface PathPoint {
  x: number;
  y: number;
}

/**
 * A path node: an anchor plus optional bezier control handles, each stored as an
 * OFFSET relative to the anchor. Absent in/out = a corner (no handle on that side).
 * A node is "smooth" when in and out are mirrored (in == -out).
 */
export interface PathNode {
  anchor: PathPoint;
  in?: PathPoint;
  out?: PathPoint;
}

export interface PathData {
  nodes: PathNode[];
  closed: boolean;
}

export interface VectorStyle {
  /** CSS color, or the literal 'none'. */
  fill: string;
  /** CSS color, or the literal 'none'. */
  stroke: string;
  strokeWidth: number;
  /** Optional; render default 'butt'. */
  strokeLinecap?: 'butt' | 'round' | 'square';
  /** Optional; render default 'miter'. */
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
}

export interface VectorAsset {
  id: string; // uuid — mutable content, NOT a content hash
  kind: 'vector';
  name: string;
  shapeType: VectorShapeType;
  style: VectorStyle;
  /** Present iff shapeType === 'path'. Static this slice (node positions do not keyframe). */
  path?: PathData;
}

export type Asset = SvgAsset | AudioAsset | VectorAsset;

export interface AudioClip {
  id: string;
  assetId: string;
  /** Timeline time (seconds) at which the clip begins. */
  startTime: number;
  /** Source in-point (seconds into the audio asset). */
  inPoint: number;
  /** Source out-point (seconds into the audio asset). */
  outPoint: number;
  /** 0..1 linear gain. */
  volume: number;
}

export type DurationMode = 'auto' | 'manual';

export interface ProjectMeta {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  durationMode: DurationMode;
  loop: boolean;
  version: number;
}

export interface Project {
  meta: ProjectMeta;
  assets: Asset[];
  objects: SceneObject[];
  audioClips: AudioClip[];
}
