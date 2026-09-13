// Offline master-mix render (spec §5): OfflineAudioContext satisfies the audio engine's
// AudioContextLike, so createAudioEngine builds the EXACT live mixer graph (gain/mute/solo/
// pan/filter/fades) against the offline context — zero new mix math. 44.1kHz stereo; ffmpeg
// resamples for Opus (48k) itself.
import { computeProjectDuration } from '@savig/engine';
import type { Project } from '@savig/engine';
import { createAudioEngine, type AudioContextLike } from '@savig/services';

export interface RenderedMix {
  channels: Float32Array[];
  sampleRate: number;
}

export interface OfflineCtxLike extends AudioContextLike {
  readonly sampleRate: number;
  startRendering(): Promise<{ numberOfChannels: number; getChannelData(c: number): Float32Array }>;
}

const SAMPLE_RATE = 44100;

const defaultMakeCtx = (channels: number, length: number, sampleRate: number): OfflineCtxLike =>
  new OfflineAudioContext(channels, length, sampleRate) as unknown as OfflineCtxLike;

export async function renderMasterMix(
  project: Project,
  binaries: Record<string, Uint8Array>,
  makeCtx: (channels: number, length: number, sampleRate: number) => OfflineCtxLike = defaultMakeCtx,
): Promise<RenderedMix | null> {
  const duration = computeProjectDuration(project);
  if (project.audioClips.length === 0 || duration <= 0) return null;

  const ctx = makeCtx(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const engine = createAudioEngine(ctx);
  for (const asset of project.assets) {
    if (asset.kind !== 'audio') continue;
    const bytes = binaries[asset.id];
    if (!bytes) continue; // matches live playback: undecodable/missing clips are skipped
    try {
      await engine.decode(asset.id, bytes);
    } catch {
      // undecodable asset — its clips are skipped by start(), same as the live transport
    }
  }
  engine.start(project.audioClips, project.audioTracks, 0);
  const rendered = await ctx.startRendering();
  const channels: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) channels.push(rendered.getChannelData(c));
  return { channels, sampleRate: ctx.sampleRate };
}
