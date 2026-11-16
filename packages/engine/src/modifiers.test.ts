import { describe, expect, it } from 'vitest';
import { createKeyframe, createSceneObject } from './project';
import { sampleObject } from './sample';
import { isPropertyModifier, loopTime, smoothNoise, wiggleAt, wiggleOffset, withModifier } from './modifiers';

const keyed = () => createSceneObject('a', { id: 'o', tracks: { x: [createKeyframe(1, 0), createKeyframe(3, 100)] } });

describe('loopTime', () => {
  const track = keyed().tracks.x!;
  it('leaves time alone up to the last key', () => {
    expect(loopTime(track, 0.5, 'cycle')).toBe(0.5);
    expect(loopTime(track, 3, 'cycle')).toBe(3);
  });
  it('cycle restarts the keyed span; pingpong reflects it', () => {
    expect(loopTime(track, 4, 'cycle')).toBeCloseTo(2, 9);
    expect(loopTime(track, 5, 'cycle')).toBeCloseTo(1, 9);
    expect(loopTime(track, 4, 'pingpong')).toBeCloseTo(2, 9);
    expect(loopTime(track, 4.5, 'pingpong')).toBeCloseTo(1.5, 9);
    expect(loopTime(track, 5.5, 'pingpong')).toBeCloseTo(1.5, 9);
  });
  it('one key or a zero span is a no-op', () => {
    expect(loopTime([createKeyframe(1, 0)], 9, 'cycle')).toBe(9);
    expect(loopTime([createKeyframe(1, 0), createKeyframe(1, 5)], 9, 'cycle')).toBe(9);
  });
});

describe('sampleObject with modifiers', () => {
  it('loops keyed motion past the last key', () => {
    const o = withModifier(keyed(), 'x', { loop: 'cycle' });
    expect(sampleObject(o, 2).x).toBeCloseTo(50, 9);
    expect(sampleObject(o, 4).x).toBeCloseTo(50, 9);
    expect(sampleObject(o, 4.5).x).toBeCloseTo(75, 9);
    const pp = withModifier(keyed(), 'x', { loop: 'pingpong' });
    expect(sampleObject(pp, 4.5).x).toBeCloseTo(25, 9);
    expect(sampleObject(pp, 5).x).toBeCloseTo(0, 9);
    // before the first key the curve holds as usual
    expect(sampleObject(pp, 0).x).toBe(0);
  });

  it('wiggles a property with no keys around its base, deterministically and within amplitude', () => {
    const o = withModifier(createSceneObject('a', { id: 'o' }), 'rotation', { wiggle: { amplitude: 15, frequency: 2, seed: 3 } });
    const vals = Array.from({ length: 200 }, (_, i) => sampleObject(o, i / 30).rotation);
    expect(Math.max(...vals.map(Math.abs))).toBeLessThanOrEqual(15);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(10); // it actually moves
    expect(sampleObject(o, 1.234).rotation).toBe(sampleObject(o, 1.234).rotation);
    // smooth: neighbouring frames never jump by more than a fraction of the amplitude
    for (let i = 1; i < vals.length; i++) expect(Math.abs(vals[i] - vals[i - 1])).toBeLessThan(5);
    // other properties untouched
    expect(sampleObject(o, 1).x).toBe(0);
  });

  it('wiggle rides on top of a keyed (and looping) curve; x and y differ', () => {
    let o = withModifier(keyed(), 'x', { wiggle: { amplitude: 5, frequency: 1 }, loop: 'cycle' });
    o = withModifier(o, 'y', { wiggle: { amplitude: 5, frequency: 1 } });
    const t = 4.25;
    expect(sampleObject(o, t).x).toBeCloseTo(62.5 + wiggleAt(o, 'x', t), 9);
    expect(wiggleAt(o, 'x', t)).not.toBeCloseTo(wiggleAt(o, 'y', t), 6);
  });

  it('seeds change the pattern; zero amplitude or frequency is still', () => {
    expect(wiggleOffset({ amplitude: 1, frequency: 1, seed: 1 }, 'x', 0.7)).not.toBe(wiggleOffset({ amplitude: 1, frequency: 1, seed: 2 }, 'x', 0.7));
    expect(wiggleOffset({ amplitude: 0, frequency: 1 }, 'x', 0.7)).toBe(0);
    expect(wiggleOffset({ amplitude: 1, frequency: 0 }, 'x', 0.7)).toBe(0);
    expect(Math.abs(smoothNoise(0, 0, 3.5))).toBeLessThan(1.3);
  });

  it('geometry properties wiggle too', () => {
    const o = withModifier(createSceneObject('a', { id: 'o', shapeBase: { width: 100, height: 50 } }), 'width', { wiggle: { amplitude: 10, frequency: 3 } });
    const w = Array.from({ length: 60 }, (_, i) => sampleObject(o, i / 30).geometry!.width!);
    expect(new Set(w).size).toBeGreaterThan(10);
    expect(sampleObject(o, 0.5).geometry!.height).toBe(50);
  });
});

describe('withModifier / isPropertyModifier', () => {
  it('merges, clears and drops empty containers', () => {
    let o = withModifier(keyed(), 'x', { loop: 'cycle' });
    o = withModifier(o, 'x', { wiggle: { amplitude: 1, frequency: 1 } });
    expect(o.modifiers).toEqual({ x: { loop: 'cycle', wiggle: { amplitude: 1, frequency: 1 } } });
    o = withModifier(o, 'x', { loop: undefined });
    expect(o.modifiers).toEqual({ x: { wiggle: { amplitude: 1, frequency: 1 } } });
    o = withModifier(o, 'x', null);
    expect('modifiers' in o).toBe(false);
  });
  it('validates shapes', () => {
    expect(isPropertyModifier({ loop: 'cycle' })).toBe(true);
    expect(isPropertyModifier({ wiggle: { amplitude: 2, frequency: 1, seed: 4 } })).toBe(true);
    expect(isPropertyModifier({})).toBe(false);
    expect(isPropertyModifier({ loop: 'bounce' })).toBe(false);
    expect(isPropertyModifier({ wiggle: { amplitude: 'x', frequency: 1 } })).toBe(false);
    expect(isPropertyModifier({ wiggle: { amplitude: 1, frequency: -1 } })).toBe(false);
    expect(isPropertyModifier({ wiggle: { amplitude: 1, frequency: 1, seed: 1.5 } })).toBe(false);
  });
});
