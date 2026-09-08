/** Gesture-free decode: OfflineAudioContext.decodeAudioData works before any user gesture
 *  (the PLAYBACK context is created lazily on Play — never reuse it here). */
export async function decodeAudioBuffer(bytes: Uint8Array): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
}

export async function decodeAudioDuration(bytes: Uint8Array): Promise<number | undefined> {
  try {
    return (await decodeAudioBuffer(bytes)).duration;
  } catch {
    return undefined; // undecodable → asset lands without duration (legacy behavior)
  }
}
