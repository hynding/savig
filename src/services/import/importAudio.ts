import type { AudioAsset } from '@savig/engine';
import { AudioImportError } from '../errors';
import { hashContent } from '../hash';

export const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
] as const;

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

export interface AudioImportResult {
  asset: AudioAsset;
  bytes: Uint8Array;
}

export function importAudio(name: string, bytes: Uint8Array, mimeType: string): AudioImportResult {
  if (!ALLOWED_AUDIO_TYPES.includes(mimeType as (typeof ALLOWED_AUDIO_TYPES)[number])) {
    throw new AudioImportError(`Unsupported audio type "${mimeType}" for "${name}".`);
  }
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw new AudioImportError(`"${name}" exceeds the ${MAX_AUDIO_BYTES} byte limit.`);
  }
  const id = hashContent(bytes);
  return { asset: { id, kind: 'audio', name, mimeType }, bytes };
}
