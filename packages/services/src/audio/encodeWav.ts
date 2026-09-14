/** Pure 16-bit PCM RIFF/WAVE encoder (spec §5): the offline master mix becomes `mix.wav` for
 *  ffmpeg to encode to AAC/Opus. Services-level so a future backend path reuses it (spec §11). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * numCh * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const dv = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * numCh * 2, true); // byte rate
  dv.setUint16(32, numCh * 2, true); // block align
  dv.setUint16(34, 16, true); // bits/sample
  ascii(36, 'data');
  dv.setUint32(40, dataBytes, true);
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][f]));
      dv.setInt16(o, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
      o += 2;
    }
  }
  return bytes;
}
