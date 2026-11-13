// Timeline zoom: a persistent view preference stepping along a fixed ladder.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN } from './store-internals';

const st = () => store.getState();

beforeEach(() => st().setTimelineZoom(1));

describe('timeline zoom', () => {
  it('starts at 100% and clamps to the range', () => {
    expect(st().timelineZoom).toBe(1);
    st().setTimelineZoom(1000);
    expect(st().timelineZoom).toBe(TIMELINE_ZOOM_MAX);
    st().setTimelineZoom(0);
    expect(st().timelineZoom).toBe(TIMELINE_ZOOM_MIN);
    st().setTimelineZoom(Number.NaN);
    expect(st().timelineZoom).toBe(TIMELINE_ZOOM_MIN);
  });

  it('steps along the ladder and stops at either end', () => {
    st().stepTimelineZoom(1);
    expect(st().timelineZoom).toBe(1.5);
    st().stepTimelineZoom(-1);
    st().stepTimelineZoom(-1);
    expect(st().timelineZoom).toBe(0.75);
    st().setTimelineZoom(TIMELINE_ZOOM_MAX);
    st().stepTimelineZoom(1);
    expect(st().timelineZoom).toBe(TIMELINE_ZOOM_MAX);
  });

  it('a value between rungs steps to the neighbouring rung', () => {
    st().setTimelineZoom(2.4);
    st().stepTimelineZoom(1);
    expect(st().timelineZoom).toBe(3);
    st().setTimelineZoom(2.4);
    st().stepTimelineZoom(-1);
    expect(st().timelineZoom).toBe(2);
  });

  it('survives a new project and does not touch history', () => {
    const before = st().history;
    st().setTimelineZoom(4);
    expect(st().history).toBe(before);
    st().newProject();
    expect(st().timelineZoom).toBe(4);
  });
});
