import { describe, expect, test } from 'vitest';
import { classifyVowel, fft, frameVowels, lipSyncVisemes, visemeForLabel, visemePoseMap, vowelFeatures, type VoicedViseme } from './visemes';
import type { SymbolAsset } from './types';

const SR = 16000;

/** A synthetic sung vowel: harmonics of f0 shaped by two formant resonances. */
function vowel(f1: number, f2: number, seconds = 0.5, f0 = 120, amp = 0.3): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  const gain = (h: number) => Math.exp(-(((h - f1) / 90) ** 2)) + 0.7 * Math.exp(-(((h - f2) / 120) ** 2)) + 0.02;
  for (let k = 1; k * f0 < 5000; k++) {
    const g = gain(k * f0) * amp;
    for (let i = 0; i < out.length; i++) out[i] += g * Math.sin((2 * Math.PI * k * f0 * i) / SR + k);
  }
  return out;
}

function noise(seconds: number, highOnly: boolean): Float32Array {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const out = new Float32Array(Math.round(SR * seconds));
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const x = rnd() * 0.2;
    out[i] = highOnly ? x - prev : x; // first difference: a crude high-pass
    prev = x;
  }
  return out;
}

const classify = (s: Float32Array) => classifyVowel(vowelFeatures(s, SR, 1000, 1000 + 667));

describe('fft', () => {
  test('finds a pure tone in its bin', () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    fft(re, im);
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]!));
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(5);
    expect(mags[5]).toBeCloseTo(n / 2, 6);
  });
});

describe('classifyVowel', () => {
  const cases: [VoicedViseme, number, number][] = [
    ['AI', 750, 1250],
    ['E', 320, 2250],
    ['E', 480, 1900],
    ['O', 520, 880],
    ['U', 320, 800],
  ];
  for (const [want, f1, f2] of cases) {
    test(`F1 ${f1} / F2 ${f2} reads as ${want}`, () => {
      const f = vowelFeatures(vowel(f1, f2), SR, 1000, 1667);
      expect(Math.abs(f.f1 - f1)).toBeLessThan(130);
      expect(classifyVowel(f)).toBe(want);
    });
  }
  test('hiss reads as FV and a low hum as MBP', () => {
    expect(classify(noise(0.5, true))).toBe('FV');
    const hum = new Float32Array(SR / 2).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 140 * i) / SR));
    expect(classify(hum)).toBe('MBP');
  });
});

describe('frameVowels', () => {
  test('one class per frame, following the sound', () => {
    const a = vowel(750, 1250, 0.5);
    const u = vowel(320, 800, 0.5);
    const both = new Float32Array(a.length + u.length);
    both.set(a);
    both.set(u, a.length);
    const v = frameVowels(both, SR, 10);
    expect(v).toHaveLength(10);
    expect(v.slice(1, 4)).toEqual(['AI', 'AI', 'AI']);
    expect(v.slice(6, 9)).toEqual(['U', 'U', 'U']);
    expect(frameVowels(both, 0, 10)).toEqual([]);
  });
});

describe('lipSyncVisemes', () => {
  test('silence rests, quiet frames close, loud frames keep their vowel; short blips merge', () => {
    const levels = [0, 0.2, 1, 1, 1, 0.9, 1, 0];
    const vowels: VoicedViseme[] = ['AI', 'AI', 'AI', 'AI', 'E', 'O', 'O', 'O'];
    expect(lipSyncVisemes(levels, vowels, { minHold: 1 })).toEqual(['rest', 'MBP', 'AI', 'AI', 'E', 'O', 'O', 'rest']);
    expect(lipSyncVisemes(levels, vowels, { minHold: 2 })).toEqual(['rest', 'rest', 'AI', 'AI', 'AI', 'O', 'O', 'O']);
    expect(lipSyncVisemes([0, 0], ['AI', 'AI'])).toEqual(['rest', 'rest']);
    expect(lipSyncVisemes([], [])).toEqual([]);
  });
});

function mouth(labels: (string | undefined)[]): SymbolAsset {
  return {
    id: 's', kind: 'symbol', name: 'Mouth', duration: 1,
    objects: [{
      id: 'layer', assetId: '', isGroup: true, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, tracks: {},
      frames: { keys: labels.map((label, i) => ({ id: `k${i}`, time: i / 24, label })) },
    }],
  } as unknown as SymbolAsset;
}

describe('visemePoseMap', () => {
  test('labels name the poses, with aliases and fallbacks', () => {
    const m = visemePoseMap(mouth(['Rest', 'Ah', 'Ee', 'W-Oo', 'MBP']), 5);
    expect(m.labeled).toBe(true);
    expect(m.poses).toMatchObject({ rest: 0, AI: 1, E: 2, U: 3, MBP: 4, O: 3, FV: 2 });
    expect(m.matched).toEqual(['rest', 'MBP', 'AI', 'E', 'U']);
  });
  test('unlabeled poses take the default order', () => {
    const m = visemePoseMap(mouth([undefined, undefined, undefined, undefined]), 4);
    expect(m.labeled).toBe(false);
    expect(m.poses).toMatchObject({ rest: 0, MBP: 1, AI: 2, E: 3, O: 2, U: 1, FV: 3 });
  });
  test('label aliases', () => {
    expect(visemeForLabel(' oh ')).toBe('O');
    expect(visemeForLabel('F/V')).toBe('FV');
    expect(visemeForLabel('M B P')).toBe('MBP');
    expect(visemeForLabel('jaw')).toBeUndefined();
  });
});
