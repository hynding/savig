import { describe, expect, test } from 'vitest';
import { advance, createClock, pause, play, seek } from './clock';

describe('clock', () => {
  test('starts paused at time 0', () => {
    const c = createClock();
    expect(c).toEqual({ time: 0, playing: false, lastTimestamp: null });
  });

  test('advance does nothing while paused', () => {
    const c = createClock();
    expect(advance(c, 10, 100, false).time).toBe(0);
  });

  test('advance accumulates elapsed seconds while playing', () => {
    let c = play(createClock(), 100);
    c = advance(c, 100.5, 10, false);
    expect(c.time).toBeCloseTo(0.5, 6);
    c = advance(c, 101, 10, false);
    expect(c.time).toBeCloseTo(1, 6);
  });

  test('clamps to duration and pauses at the end when not looping', () => {
    let c = play(createClock(), 0);
    c = advance(c, 5, 3, false);
    expect(c.time).toBe(3);
    expect(c.playing).toBe(false);
  });

  test('wraps around when looping', () => {
    let c = play(createClock(), 0);
    c = advance(c, 3.5, 3, true);
    expect(c.time).toBeCloseTo(0.5, 6);
    expect(c.playing).toBe(true);
  });

  test('seek clamps to >= 0 and re-anchors the next advance', () => {
    let c = play(createClock(), 100);
    c = seek(c, -5);
    expect(c.time).toBe(0);
    expect(c.lastTimestamp).toBeNull();
    c = advance(c, 200, 10, false); // first advance after seek re-anchors, no jump
    expect(c.time).toBe(0);
    c = advance(c, 200.25, 10, false);
    expect(c.time).toBeCloseTo(0.25, 6);
  });

  test('pause stops accumulation', () => {
    let c = play(createClock(), 0);
    c = advance(c, 1, 10, false);
    c = pause(c);
    c = advance(c, 5, 10, false);
    expect(c.time).toBeCloseTo(1, 6);
  });
});
