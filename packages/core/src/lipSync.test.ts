import { describe, expect, it } from 'vitest';
import { createGroupObject, createProject, createSceneObject, createSymbolAsset } from '@savig/engine';
import type { Project, SceneObject } from '@savig/engine';
import { lipSync, parseWav, wavLevels } from './lipSync';

function wav(samples: number[], { sampleRate = 100, channels = 1, bits = 16 } = {}): Uint8Array {
  const bps = bits / 8;
  const size = samples.length * bps;
  const b = new Uint8Array(44 + size);
  const dv = new DataView(b.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + size, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, bits === 32 ? 3 : 1, true); dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * bps * channels, true); dv.setUint16(32, bps * channels, true);
  dv.setUint16(34, bits, true); w(36, 'data'); dv.setUint32(40, size, true);
  samples.forEach((v, i) => (bits === 32 ? dv.setFloat32(44 + i * 4, v, true) : dv.setInt16(44 + i * 2, Math.round(v * 32767), true)));
  return b;
}

function mouthProject(): Project {
  const layer: SceneObject = { ...createGroupObject({ id: 'L', anchorX: 0, anchorY: 0, zOrder: 0 }), frames: { keys: [{ id: 'a', time: 0 }, { id: 'b', time: 0.1 }, { id: 'c', time: 0.2 }], end: 0.3 } };
  const sym = createSymbolAsset({ id: 'mouth', name: 'Mouth', objects: [layer], width: 1, height: 1 });
  const p = createProject();
  return { ...p, assets: [...p.assets, sym], objects: [createSceneObject('mouth', { id: 'm', zOrder: 0 })] };
}

describe('core lip sync', () => {
  it('parses 16-bit and float WAVs, mixing stereo to mono', () => {
    const a = parseWav(wav([0, 0.5, -0.5]));
    expect(a.sampleRate).toBe(100);
    expect(a.samples[1]).toBeCloseTo(0.5, 3);
    const st = parseWav(wav([1, 0, 0.5, 0.5], { channels: 2, bits: 32 }));
    expect(Array.from(st.samples)).toEqual([0.5, 0.5]);
    expect(() => parseWav(new Uint8Array(20))).toThrow(/not a WAV/);
  });

  it('wavLevels gives per-frame loudness', () => {
    const s = [...Array(50).fill(0), ...Array(50).fill(0.5)];
    const lv = wavLevels(wav(s), 2);
    expect(lv[0]).toBe(0);
    expect(lv[1]).toBeCloseTo(0.5, 3);
  });

  it('keys the instance and fails loudly on bad input', () => {
    const r = lipSync(mouthProject(), 'm', { levels: [0, 0, 1, 1, 0.5, 0.5, 0, 0], startTime: 1 });
    expect(r.poses).toBe(3);
    const track = r.project.objects[0].symbolTimeTrack!;
    expect(track[0]).toMatchObject({ time: 0, value: 0 });
    expect(track.some((k) => k.value === 0.2)).toBe(true);
    expect(() => lipSync(mouthProject(), 'nope', { levels: [1] })).toThrow(/no object/);
    expect(() => lipSync(mouthProject(), 'm', { levels: [] })).toThrow(/levels/);
  });
});
