import { formatTime } from './formatTime';

it('formats seconds as MM:SS.t', () => {
  expect(formatTime(0)).toBe('00:00.0');
  expect(formatTime(5.25)).toBe('00:05.2');
  expect(formatTime(65.9)).toBe('01:05.9');
});
