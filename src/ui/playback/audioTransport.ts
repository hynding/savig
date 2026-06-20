import { createAudioEngine } from '../../services';
import type { AudioContextLike, AudioEngine } from '../../services';
import type { Project } from '../../engine';

export interface AudioTransport {
  start(project: Project, binaries: Record<string, Uint8Array>, fromTime: number): Promise<void>;
  stop(): void;
  readonly currentTime: number | null;
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

  return {
    get currentTime() {
      return engine ? engine.currentTime : null;
    },
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
      engine.start(project.audioClips, fromTime);
    },
    stop() {
      engine?.stop();
    },
  };
}
