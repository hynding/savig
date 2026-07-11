// Pure unit tests for `primitiveOptionsViewModel` — no React. Drives the real vanilla
// `@savig/editor-state` store through its actions (same store the app uses) and asserts on
// the resulting descriptor, mirroring how `PrimitiveOptions.tsx` consumes it at runtime.
import { store } from '@savig/editor-state';
import { primitiveOptionsViewModel, primitiveOptionsIntents } from './primitiveOptions';

beforeEach(() => {
  store.getState().newProject();
});

describe('primitiveOptionsViewModel — control visibility per active tool', () => {
  it('is "none" for a non-primitive tool (e.g. select)', () => {
    store.getState().setActiveTool('select');
    expect(primitiveOptionsViewModel(store.getState()).kind).toBe('none');
  });

  it('is "polygon" while the polygon tool is active', () => {
    store.getState().setActiveTool('polygon');
    expect(primitiveOptionsViewModel(store.getState()).kind).toBe('polygon');
  });

  it('is "star" while the star tool is active', () => {
    store.getState().setActiveTool('star');
    expect(primitiveOptionsViewModel(store.getState()).kind).toBe('star');
  });

  it('is "brush" while the brush tool is active', () => {
    store.getState().setActiveTool('brush');
    expect(primitiveOptionsViewModel(store.getState()).kind).toBe('brush');
  });
});

describe('primitiveOptionsViewModel — param values reflect non-default store state', () => {
  it('reflects a non-default polygon side count + corner radius', () => {
    const s = store.getState();
    s.setActiveTool('polygon');
    s.setPolygonSides(9);
    s.setPrimitiveCornerRadius(15);

    const vm = primitiveOptionsViewModel(store.getState());
    expect(vm.polygonSides).toBe(9);
    expect(vm.primitiveCornerRadius).toBe(15);
  });

  it('reflects non-default star points + inner ratio', () => {
    const s = store.getState();
    s.setActiveTool('star');
    s.setStarPoints(8);
    s.setStarInnerRatio(0.35);

    const vm = primitiveOptionsViewModel(store.getState());
    expect(vm.starPoints).toBe(8);
    expect(vm.starInnerRatio).toBeCloseTo(0.35, 6);
  });

  it('reflects non-default brush size + smoothing', () => {
    const s = store.getState();
    s.setActiveTool('brush');
    s.setBrushSize(22);
    s.setBrushSmoothing(0.9);

    const vm = primitiveOptionsViewModel(store.getState());
    expect(vm.brushSize).toBe(22);
    expect(vm.brushSmoothing).toBeCloseTo(0.9, 6);
  });

  it('reflects non-default brush taper in/out + pressure toggle', () => {
    const s = store.getState();
    s.setActiveTool('brush');
    s.setBrushTaperIn(0.2);
    s.setBrushTaperOut(0.15);
    s.setBrushUsePressure(true);

    const vm = primitiveOptionsViewModel(store.getState());
    expect(vm.brushTaperIn).toBeCloseTo(0.2, 6);
    expect(vm.brushTaperOut).toBeCloseTo(0.15, 6);
    expect(vm.brushUsePressure).toBe(true);
  });

  it('defaults brush taper/pressure to 0/0/false', () => {
    const s = store.getState();
    s.setActiveTool('brush');

    const vm = primitiveOptionsViewModel(store.getState());
    expect(vm.brushTaperIn).toBe(0);
    expect(vm.brushTaperOut).toBe(0);
    expect(vm.brushUsePressure).toBe(false);
  });
});

describe('primitiveOptionsIntents — brush taper/pressure', () => {
  it('setBrushTaperIn/setBrushTaperOut/setBrushUsePressure dispatch to the store', () => {
    const intents = primitiveOptionsIntents(store);
    intents.setBrushTaperIn(0.25);
    expect(store.getState().brushTaperIn).toBeCloseTo(0.25, 6);
    intents.setBrushTaperOut(0.1);
    expect(store.getState().brushTaperOut).toBeCloseTo(0.1, 6);
    intents.setBrushUsePressure(true);
    expect(store.getState().brushUsePressure).toBe(true);
  });
});
