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

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity';

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

export type Asset = SvgAsset | AudioAsset;

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
