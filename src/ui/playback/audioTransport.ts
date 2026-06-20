import { createAudioEngine } from '../../services';
import type { AudioContextLike, AudioEngine } from '../../services';
import type { Project } from '../../engine';

export interface AudioTransport {
  start(project: Project, binaries: Record<string, Uint8Array>, fromTime: number): Promise<void>;
  stop(): void;
  /**
   * Current playhead position (seconds) derived from the AudioContext clock,
   * or null when no audio is playing. When non-null this is the master clock:
   * the visual loop follows it so visuals stay in sync with audio (spec §4).
   */
  position(): number | null;
}

function defaultMakeCtx(): AudioContextLike {
  const Ctx =
    (window as unknown as { AudioContext?: new () => AudioContextLike }).AudioContext ??
    (window as unknown as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext;
  if (!Ctx) throw new Error('Web Audio API unavailable');
  return new Ctx();
}

// Wires the decoupled engine AudioEngine to the editor. The AudioContext is
// created lazily on the first start (the Play user gesture, per spec §4).
// Scrubbing stays silent because callers only invoke start() on Play.
export function createAudioTransport(makeCtx: () => AudioContextLike = defaultMakeCtx): AudioTransport {
  let engine: AudioEngine | null = null;
  // Anchor mapping ctx-clock -> playhead, captured at the moment audio starts.
  let active = false;
  let anchorPlayhead = 0;
  let anchorCtxTime = 0;

  return {
    async start(project, binaries, fromTime) {
      if (project.audioClips.length === 0) return;
      if (!engine) engine = createAudioEngine(makeCtx());
      const assetIds = new Set(project.audioClips.map((c) => c.assetId));
      await Promise.all(
        Array.from(assetIds).map((id) => {
          const bytes = binaries[id];
          return bytes ? engine!.decode(id, bytes) : Promise.resolve();
        }),
      );
      anchorPlayhead = fromTime;
      anchorCtxTime = engine.currentTime;
      active = true;
      engine.start(project.audioClips, fromTime);
    },
    stop() {
      engine?.stop();
      active = false;
    },
    position() {
      if (!active || !engine) return null;
      return anchorPlayhead + (engine.currentTime - anchorCtxTime);
    },
  };
}
