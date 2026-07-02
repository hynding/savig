import { PX_PER_SECOND, timeToX, xToTime } from './scale';

it('maps time to x and back', () => {
  expect(timeToX(1)).toBe(PX_PER_SECOND);
  expect(xToTime(PX_PER_SECOND * 2)).toBe(2);
});
