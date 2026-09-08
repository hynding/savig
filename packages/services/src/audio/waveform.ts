/** Max-|sample| peak per bin for waveform rendering. Pure — decode happens in the app layer. */
export function computePeaks(channelData: Float32Array, bins: number): Float32Array {
  const peaks = new Float32Array(bins);
  if (channelData.length === 0) return peaks;
  const perBin = channelData.length / bins;
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * perBin);
    const end = Math.min(channelData.length, Math.max(start + 1, Math.floor((b + 1) * perBin)));
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(channelData[i]);
      if (v > max) max = v;
    }
    peaks[b] = max;
  }
  return peaks;
}
