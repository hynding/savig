// Covers AudioLanes' pointer-drag mechanics (review finding: zero coverage previously). Renders
// the real <Timeline /> against the real vanilla store (same idiom as Timeline.test.tsx's
// drag-to-retime keyframe tests) and asserts STORE OUTCOMES, not implementation internals:
// exactly one commit per gesture (history.past grows by 1), the right field changes, and a
// sub-epsilon move commits nothing at all.
import { render, screen, fireEvent } from '@testing-library/react';
import { Timeline } from './Timeline';
import { useEditor } from '../../store/store';
import { PX_PER_SECOND } from './scale';

beforeEach(() => useEditor.getState().newProject());

function withAudioClip(duration = 10): string {
  useEditor.getState().addAsset({ id: 'aud', kind: 'audio', name: 'song', mimeType: 'audio/mpeg', duration });
  useEditor.getState().seek(0);
  useEditor.getState().addAudioClip('aud');
  return useEditor.getState().history.present.audioClips[0].id;
}

// jsdom's real getBoundingClientRect is always an all-zero rect, which would make AudioLanes'
// edge-zone math (offsetX vs. EDGE_ZONE_PX) resolve to the wrong drag mode for every test. Fake a
// plausible on-screen rect for the clip element under test instead.
function mockRect(el: Element, left: number, width: number) {
  el.getBoundingClientRect = () =>
    ({ left, width, right: left + width, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON() {} }) as DOMRect;
}

describe('AudioLanes drag mechanics', () => {
  it('a horizontal body drag commits exactly ONE setAudioClipTiming with the new startTime', () => {
    const clipId = withAudioClip(10);
    render(<Timeline />);
    const clip = screen.getByTestId(`audio-clip-${clipId}`);
    mockRect(clip, 200, 300); // wide clip body, well clear of the 6px edge zones
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(clip, { clientX: 350, clientY: 100 }); // grab mid-body
    fireEvent.pointerMove(window, { clientX: 350 + PX_PER_SECOND, clientY: 100 }); // +1s, no vertical
    fireEvent.pointerUp(window, { clientX: 350 + PX_PER_SECOND, clientY: 100 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1); // exactly one commit
    const clipState = useEditor.getState().history.present.audioClips[0];
    expect(clipState.startTime).toBeCloseTo(1, 5);
    expect(clipState.trackId).toBeUndefined(); // lane untouched by this gesture
  });

  it('a left-edge drag commits a trim (inPoint changes; startTime untouched)', () => {
    const clipId = withAudioClip(10); // outPoint=10, inPoint=0
    render(<Timeline />);
    const clip = screen.getByTestId(`audio-clip-${clipId}`);
    mockRect(clip, 200, 300);
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(clip, { clientX: 202, clientY: 100 }); // offsetX=2 <= 6px -> trim-start
    fireEvent.pointerMove(window, { clientX: 202 + PX_PER_SECOND, clientY: 100 }); // +1s -> inPoint += 1
    fireEvent.pointerUp(window, { clientX: 202 + PX_PER_SECOND, clientY: 100 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1);
    const clipState = useEditor.getState().history.present.audioClips[0];
    expect(clipState.inPoint).toBeCloseTo(1, 5);
    expect(clipState.outPoint).toBe(10); // unchanged
    expect(clipState.startTime).toBe(0); // the body keeps startTime (spec ruling)
  });

  it('a right-edge drag commits a trim (outPoint changes; startTime untouched)', () => {
    const clipId = withAudioClip(10);
    render(<Timeline />);
    const clip = screen.getByTestId(`audio-clip-${clipId}`);
    mockRect(clip, 200, 300); // right edge sits at clientX=500; the trim-end zone is [494, 500]
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(clip, { clientX: 498, clientY: 100 }); // offsetX=298 >= 300-6 -> trim-end
    fireEvent.pointerMove(window, { clientX: 498 - PX_PER_SECOND, clientY: 100 }); // -1s -> outPoint -= 1
    fireEvent.pointerUp(window, { clientX: 498 - PX_PER_SECOND, clientY: 100 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1);
    const clipState = useEditor.getState().history.present.audioClips[0];
    expect(clipState.outPoint).toBeCloseTo(9, 5);
    expect(clipState.inPoint).toBe(0);
    expect(clipState.startTime).toBe(0);
  });

  it('a vertical drag past the lane threshold reassigns the clip to that lane (single commit)', () => {
    useEditor.getState().addAudioTrack();
    const trackId = useEditor.getState().history.present.audioTracks![0].id;
    const clipId = withAudioClip(10); // lands untracked -> default lane (index 0); named track is index 1
    render(<Timeline />);
    const clip = screen.getByTestId(`audio-clip-${clipId}`);
    mockRect(clip, 200, 300);
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(clip, { clientX: 350, clientY: 100 }); // mid-body -> move mode
    fireEvent.pointerMove(window, { clientX: 350, clientY: 100 + 20 }); // vertical only, past half a lane (17px)
    fireEvent.pointerUp(window, { clientX: 350, clientY: 100 + 20 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1); // exactly one commit
    const clipState = useEditor.getState().history.present.audioClips[0];
    expect(clipState.trackId).toBe(trackId);
    expect(clipState.startTime).toBe(0); // horizontal untouched by this (vertical) gesture
  });

  it('a sub-epsilon move commits nothing', () => {
    const clipId = withAudioClip(10);
    render(<Timeline />);
    const clip = screen.getByTestId(`audio-clip-${clipId}`);
    mockRect(clip, 200, 300);
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(clip, { clientX: 350, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 350, clientY: 100 }); // no movement at all
    fireEvent.pointerUp(window, { clientX: 350, clientY: 100 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore); // no commit
    expect(useEditor.getState().history.present.audioClips[0].startTime).toBe(0);
  });
});
