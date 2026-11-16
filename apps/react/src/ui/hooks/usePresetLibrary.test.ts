import { renderHook, act } from '@testing-library/react';
import type { MotionPreset } from '@savig/engine';
import type { PresetLibraryStore } from '@savig/services';
import { useEditor } from '../store/store';
import { usePresetLibrary } from './usePresetLibrary';

const p = (id: string): MotionPreset => ({ id, name: id, category: 'custom', duration: 1, tracks: { x: { mode: 'offset', keys: [{ t: 0, v: 0 }, { t: 1, v: 5 }] } } });

function fake(initial: MotionPreset[]) {
  let stored = initial;
  const saves: MotionPreset[][] = [];
  const store: PresetLibraryStore = { load: () => stored, save: (l) => (saves.push([...l]), (stored = [...l]), true) };
  return { store, saves, setStored: (l: MotionPreset[]) => (stored = l) };
}

it('loads the library on mount, saves changes, and reloads on a storage event without writing back', () => {
  const f = fake([p('a')]);
  const { unmount } = renderHook(() => usePresetLibrary(f.store));
  expect(useEditor.getState().presetLibrary.map((x) => x.id)).toEqual(['a']);
  expect(f.saves).toHaveLength(0);
  act(() => useEditor.getState().setPresetLibrary([p('a'), p('b')]));
  expect(f.saves.at(-1)!.map((x) => x.id)).toEqual(['a', 'b']);
  f.setStored([p('c')]);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'savig-preset-library' }));
  });
  expect(useEditor.getState().presetLibrary.map((x) => x.id)).toEqual(['c']);
  expect(f.saves).toHaveLength(1);
  unmount();
});
