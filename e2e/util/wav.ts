// Shared test fixture: a minimal real WAV a browser can decode via
// OfflineAudioContext.decodeAudioData. Used by audio-lanes.spec.ts and multitrack-audio.spec.ts
// to prove the import-duration defect fix (outPoint: 0) end-to-end. Moved here (Task 8) from
// audio-lanes.spec.ts so both specs import one implementation instead of duplicating it.
export function makeWav(): Buffer {
  const sampleRate = 8000;
  const seconds = 0.5;
  const numSamples = Math.floor(sampleRate * seconds);
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  const freq = 440;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.5 * 32767;
    buffer.writeInt16LE(Math.round(sample), 44 + i * bytesPerSample);
  }
  return buffer;
}
