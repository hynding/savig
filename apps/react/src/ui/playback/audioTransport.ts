import { createAudioEngine } from '@savig/services';
import type { AudioContextLike, AudioEngine } from '@savig/services';
import type { Project } from '@savig/engine';

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
  let ctx: AudioContextLike | null = null;
  let engine: AudioEngine | null = null;
  // Anchor mapping ctx-clock -> playhead, captured at the moment audio starts.
  let active = false;
  let anchorPlayhead = 0;
  let anchorCtxTime = 0;

  return {
    async start(project, binaries, fromTime) {
      if (project.audioClips.length === 0) return;
      if (!ctx) {
        ctx = makeCtx();
        engine = createAudioEngine(ctx);
      }
      // Resume in case the browser created/left the context suspended (autoplay
      // policy) — otherwise ctx.currentTime would be frozen and the visual clock
      // (which masters off it) would freeze too. This is the Play-gesture resume.
      if (ctx.resume) await ctx.resume();
      const assetIds = new Set(project.audioClips.map((c) => c.assetId));
      await Promise.all(
        Array.from(assetIds).map((id) => {
          const bytes = binaries[id];
          return bytes ? engine!.decode(id, bytes) : Promise.resolve();
        }),
      );
      anchorPlayhead = fromTime;
      anchorCtxTime = engine!.currentTime;
      engine!.start(project.audioClips, fromTime);
      active = true; // only after scheduling succeeds
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
