export interface ClockState {
  /** Current playhead time in seconds. */
  time: number;
  playing: boolean;
  /** Wall-clock timestamp (seconds) of the last advance; null until anchored. */
  lastTimestamp: number | null;
}

export function createClock(): ClockState {
  return { time: 0, playing: false, lastTimestamp: null };
}

export function play(state: ClockState, timestamp: number): ClockState {
  return { ...state, playing: true, lastTimestamp: timestamp };
}

export function pause(state: ClockState): ClockState {
  return { ...state, playing: false, lastTimestamp: null };
}

export function seek(state: ClockState, time: number): ClockState {
  return { ...state, time: Math.max(0, time), lastTimestamp: null };
}

export function advance(
  state: ClockState,
  timestamp: number,
  duration: number,
  loop: boolean,
): ClockState {
  if (!state.playing) return state;
  if (state.lastTimestamp === null) {
    return { ...state, lastTimestamp: timestamp };
  }

  const delta = timestamp - state.lastTimestamp;
  let time = state.time + delta;

  if (duration <= 0) {
    return { ...state, time: 0, lastTimestamp: timestamp };
  }

  if (time >= duration) {
    if (loop) {
      time = time % duration;
      return { ...state, time, lastTimestamp: timestamp };
    }
    return { ...state, time: duration, playing: false, lastTimestamp: null };
  }

  return { ...state, time, lastTimestamp: timestamp };
}
