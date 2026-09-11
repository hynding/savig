// Covers AudioLanes' pointer-drag mechanics (review finding: zero coverage previously). Renders
// the real <Timeline /> against the real vanilla store (same idiom as Timeline.test.tsx's
// drag-to-retime keyframe tests) and asserts STORE OUTCOMES, not implementation internals:
// exactly one commit per gesture (history.past grows by 1), the right field changes, and a
// sub-epsilon move commits nothing at all.
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { Timeline } from './Timeline';
import { AudioLanes } from './AudioLanes';
import { useEditor } from '../../store/store';
import { timelineIntents } from '@savig/ui-core';
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

  it('a left-edge drag trims DAW-style: startTime and inPoint shift together so surviving audio stays anchored', () => {
    const clipId = withAudioClip(10); // outPoint=10, inPoint=0, startTime=0
    render(<Timeline />);
    const clip = screen.getByTestId(`audio-clip-${clipId}`);
    mockRect(clip, 200, 300);
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(clip, { clientX: 202, clientY: 100 }); // offsetX=2 <= 6px -> trim-start
    fireEvent.pointerMove(window, { clientX: 202 + PX_PER_SECOND, clientY: 100 }); // +1s
    fireEvent.pointerUp(window, { clientX: 202 + PX_PER_SECOND, clientY: 100 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1); // ONE commit for both fields
    const clipState = useEditor.getState().history.present.audioClips[0];
    expect(clipState.inPoint).toBeCloseTo(1, 5);
    expect(clipState.startTime).toBeCloseTo(1, 5); // moved WITH inPoint (DAW convention)
    expect(clipState.outPoint).toBe(10); // unchanged
    // Net effect: the clip's timeline END (startTime + out - in) is exactly where it was.
    expect(clipState.startTime + clipState.outPoint - clipState.inPoint).toBeCloseTo(10, 5);
  });

  it('a left-edge drag clamps at timeline 0: dragging left never pushes startTime negative or desyncs the pair', () => {
    const clipId = withAudioClip(10);
    // Start with some headroom: inPoint=2, startTime=1 -> only 1s of leftward extension exists.
    useEditor.getState().setAudioClipTiming(clipId, { inPoint: 2, startTime: 1 });
    render(<Timeline />);
    const clip = screen.getByTestId(`audio-clip-${clipId}`);
    mockRect(clip, 200, 300);

    fireEvent.pointerDown(clip, { clientX: 202, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 202 - 3 * PX_PER_SECOND, clientY: 100 }); // ask for -3s
    fireEvent.pointerUp(window, { clientX: 202 - 3 * PX_PER_SECOND, clientY: 100 });

    const clipState = useEditor.getState().history.present.audioClips[0];
    expect(clipState.startTime).toBeCloseTo(0, 5); // stopped at timeline 0 …
    expect(clipState.inPoint).toBeCloseTo(1, 5); // … and inPoint moved by the SAME clamped -1s
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

describe('AudioLanes fade handles', () => {
  it('a fade-in handle drag commits exactly ONE setAudioClipFades with fadeIn > 0', () => {
    const clipId = withAudioClip(10);
    render(<Timeline />);
    const handle = screen.getByTestId(`fade-in-handle-${clipId}`);
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(handle, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 200 + PX_PER_SECOND, clientY: 100 }); // +1s right
    fireEvent.pointerUp(window, { clientX: 200 + PX_PER_SECOND, clientY: 100 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1); // exactly one commit
    const clip = useEditor.getState().history.present.audioClips[0];
    expect(clip.fadeIn).toBeGreaterThan(0);
    expect(clip.fadeIn).toBeCloseTo(1, 5);
    expect(clip.startTime).toBe(0); // fade drag never touches timing/lane
    expect(clip.trackId).toBeUndefined();
  });

  it('a fade-out handle drag commits exactly ONE setAudioClipFades with fadeOut > 0', () => {
    const clipId = withAudioClip(10);
    render(<Timeline />);
    const handle = screen.getByTestId(`fade-out-handle-${clipId}`);
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(handle, { clientX: 500, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 500 - PX_PER_SECOND, clientY: 100 }); // -1s left -> fadeOut grows
    fireEvent.pointerUp(window, { clientX: 500 - PX_PER_SECOND, clientY: 100 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1);
    const clip = useEditor.getState().history.present.audioClips[0];
    expect(clip.fadeOut).toBeGreaterThan(0);
    expect(clip.fadeOut).toBeCloseTo(1, 5);
    expect(clip.startTime).toBe(0);
    expect(clip.trackId).toBeUndefined();
  });

  it('a sub-epsilon fade-handle drag commits nothing', () => {
    const clipId = withAudioClip(10);
    render(<Timeline />);
    const handle = screen.getByTestId(`fade-in-handle-${clipId}`);
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(handle, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 100 }); // no movement
    fireEvent.pointerUp(window, { clientX: 200, clientY: 100 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore);
    expect(useEditor.getState().history.present.audioClips[0].fadeIn).toBeUndefined();
  });

  it('a fade-handle pointerdown does not start a clip move drag (stopPropagation)', () => {
    const clipId = withAudioClip(10);
    render(<Timeline />);
    const clip = screen.getByTestId(`audio-clip-${clipId}`);
    mockRect(clip, 200, 300);
    const handle = screen.getByTestId(`fade-in-handle-${clipId}`);
    const pastBefore = useEditor.getState().history.past.length;

    fireEvent.pointerDown(handle, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 200 + PX_PER_SECOND, clientY: 100 + 40 }); // would reassign lane if this were a clip-body drag
    fireEvent.pointerUp(window, { clientX: 200 + PX_PER_SECOND, clientY: 100 + 40 });

    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1); // only the fade commit
    const clip2 = useEditor.getState().history.present.audioClips[0];
    expect(clip2.trackId).toBeUndefined(); // no lane reassignment happened
    expect(clip2.fadeIn).toBeGreaterThan(0);
  });

  it('renders the fade overlay polyline only once a fade is set', () => {
    const clipId = withAudioClip(10);
    render(<Timeline />);
    expect(screen.queryByTestId(`fade-overlay-${clipId}`)).toBeNull();

    act(() => { useEditor.getState().setAudioClipFades(clipId, { fadeIn: 2 }); });
    expect(screen.getByTestId(`fade-overlay-${clipId}`)).toBeInTheDocument();
  });
});

describe('AudioLanes lane selection', () => {
  it('clicking a named lane header selects it (aria-selected on the row); the default lane is not selectable', () => {
    withAudioClip(10); // untracked -> keeps the default lane rendered alongside the named track
    useEditor.getState().addAudioTrack();
    const trackId = useEditor.getState().history.present.audioTracks![0].id;
    render(<Timeline />);

    const namedLane = screen.getByTestId(`audio-lane-${trackId}`);
    const defaultLane = screen.getByTestId('audio-lane-default');
    expect(namedLane).toHaveAttribute('aria-selected', 'false');

    // Click the name label (inside the scoped .laneName click target — NOT the whole header,
    // which also contains the Mute/Solo/gain/pan controls; see the bubbling regression test below).
    fireEvent.click(within(namedLane).getByText('Audio 1'));
    expect(useEditor.getState().selectedAudioTrackId).toBe(trackId);
    expect(screen.getByTestId(`audio-lane-${trackId}`)).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(defaultLane).getByText('Audio'));
    expect(useEditor.getState().selectedAudioTrackId).toBe(trackId); // unchanged — default lane ignores clicks
  });

  it('clicking an already-selected lane header toggles the selection off', () => {
    useEditor.getState().addAudioTrack();
    const trackId = useEditor.getState().history.present.audioTracks![0].id;
    render(<Timeline />);
    const nameLabel = within(screen.getByTestId(`audio-lane-${trackId}`)).getByText('Audio 1');

    fireEvent.click(nameLabel);
    expect(useEditor.getState().selectedAudioTrackId).toBe(trackId);

    fireEvent.click(nameLabel);
    expect(useEditor.getState().selectedAudioTrackId).toBeNull();
  });

  it('clicking Mute or adjusting gain on a selected track does not toggle its selection (bubbling regression)', () => {
    useEditor.getState().addAudioTrack();
    const trackId = useEditor.getState().history.present.audioTracks![0].id;
    useEditor.getState().selectAudioTrack(trackId);
    render(<Timeline />);
    expect(useEditor.getState().selectedAudioTrackId).toBe(trackId);

    fireEvent.click(screen.getByTestId(`audio-track-mute-${trackId}`));
    expect(useEditor.getState().selectedAudioTrackId).toBe(trackId); // unchanged
    expect(useEditor.getState().history.present.audioTracks![0].muted).toBe(true); // the click DID work

    fireEvent.click(screen.getByTestId(`audio-track-solo-${trackId}`));
    expect(useEditor.getState().selectedAudioTrackId).toBe(trackId);

    const gainInput = screen.getByTestId(`audio-track-gain-${trackId}`);
    fireEvent.click(gainInput); // a real slider drag also fires a native click that bubbles
    fireEvent.change(gainInput, { target: { value: '0.3' } });
    expect(useEditor.getState().selectedAudioTrackId).toBe(trackId);
    expect(useEditor.getState().history.present.audioTracks![0].gain).toBe(0.3);

    const panInput = screen.getByTestId(`audio-track-pan-${trackId}`);
    fireEvent.click(panInput);
    fireEvent.change(panInput, { target: { value: '0.5' } });
    expect(useEditor.getState().selectedAudioTrackId).toBe(trackId);
  });
});

describe('AudioLanes window-listener stability (deferral: pointer-effect re-attach churn)', () => {
  it('does not detach/re-attach its window pointer listeners when vm/intents get new identities', () => {
    const makeVm = () => ({ fps: 30, audioTracks: [] });
    const intents = () => timelineIntents(useEditor);

    const spyAdd = vi.spyOn(window, 'addEventListener');
    const spyRemove = vi.spyOn(window, 'removeEventListener');
    const { rerender } = render(<AudioLanes vm={makeVm()} intents={intents()} />);
    const addsAtMount = spyAdd.mock.calls.filter(([type]) => type === 'pointermove').length;
    expect(addsAtMount).toBe(1); // sanity: the effect attached once on mount

    // A fresh vm object + fresh intents object every render is exactly what Timeline hands down.
    rerender(<AudioLanes vm={makeVm()} intents={intents()} />);
    rerender(<AudioLanes vm={makeVm()} intents={intents()} />);

    const addsAfter = spyAdd.mock.calls.filter(([type]) => type === 'pointermove').length;
    const removesAfter = spyRemove.mock.calls.filter(([type]) => type === 'pointermove').length;
    expect(addsAfter).toBe(1); // still just the mount attach
    expect(removesAfter).toBe(0); // and nothing was torn down mid-life
    spyAdd.mockRestore();
    spyRemove.mockRestore();
  });

  it('a drag still reads the LATEST vm: a lane-reassign uses tracks added after mount', () => {
    // Regression guard for the ref-based fix: freezing the mount-time vm in the [] effect would
    // break lane reassignment when tracks appear later. Drive the real Timeline so vm re-derives.
    const clipId = withAudioClip(10);
    useEditor.getState().addAudioTrack();
    render(<Timeline />);
    const trackId = useEditor.getState().history.present.audioTracks![0].id;
    const clip = screen.getByTestId(`audio-clip-${clipId}`);
    clip.getBoundingClientRect = () =>
      ({ left: 200, width: 300, right: 500, top: 0, bottom: 20, height: 20, x: 200, y: 0, toJSON() {} }) as DOMRect;

    // Default lane is index 0, the named track index 1 — drag one lane DOWN to reassign.
    fireEvent.pointerDown(clip, { clientX: 350, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 350, clientY: 10 + 34 });
    fireEvent.pointerUp(window, { clientX: 350, clientY: 10 + 34 });

    expect(useEditor.getState().history.present.audioClips[0].trackId).toBe(trackId);
  });
});
