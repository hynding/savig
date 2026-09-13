import { describe, expect, it } from 'vitest';
import { encodeWav } from './encodeWav';

describe('encodeWav', () => {
  it('emits a valid RIFF/WAVE header for 16-bit stereo PCM', () => {
    const bytes = encodeWav([new Float32Array([0, 0.5]), new Float32Array([0, -0.5])], 44100);
    const ascii = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(2); // channels
    expect(dv.getUint32(24, true)).toBe(44100); // sample rate
    expect(dv.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(36, 4)).toBe('data');
    expect(dv.getUint32(40, true)).toBe(2 * 2 * 2); // frames * channels * 2 bytes
    expect(bytes.length).toBe(44 + 8);
  });

  it('interleaves channels and quantizes with clamping', () => {
    const bytes = encodeWav([new Float32Array([1, 2]), new Float32Array([-1, -2])], 8000);
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(dv.getInt16(44, true)).toBe(32767); // L0: +1 -> max
    expect(dv.getInt16(46, true)).toBe(-32768); // R0: -1 -> min
    expect(dv.getInt16(48, true)).toBe(32767); // L1: +2 clamped
    expect(dv.getInt16(50, true)).toBe(-32768); // R1: -2 clamped
  });

  it('handles mono', () => {
    const bytes = encodeWav([new Float32Array([0.25])], 22050);
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(dv.getUint16(22, true)).toBe(1);
    expect(dv.getInt16(44, true)).toBe(Math.round(0.25 * 32767));
  });
});
