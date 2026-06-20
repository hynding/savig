import { describe, expect, it } from 'vitest';
import { AudioImportError } from '../errors';
import { importAudio, MAX_AUDIO_BYTES } from './importAudio';

const bytes = new Uint8Array([1, 2, 3, 4]);

describe('importAudio', () => {
  it('creates a content-addressed audio asset', () => {
    const { asset } = importAudio('clip.mp3', bytes, 'audio/mpeg');
    expect(asset.kind).toBe('audio');
    expect(asset.name).toBe('clip.mp3');
    expect(asset.mimeType).toBe('audio/mpeg');
    expect(asset.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns the original bytes for separate storage', () => {
    expect(importAudio('clip.wav', bytes, 'audio/wav').bytes).toBe(bytes);
  });

  it('rejects unsupported mime types', () => {
    expect(() => importAudio('clip.txt', bytes, 'text/plain')).toThrow(AudioImportError);
  });

  it('rejects oversized files', () => {
    const big = new Uint8Array(MAX_AUDIO_BYTES + 1);
    expect(() => importAudio('big.mp3', big, 'audio/mpeg')).toThrow(AudioImportError);
  });
});
