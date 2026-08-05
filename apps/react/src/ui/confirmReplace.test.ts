import { vi } from 'vitest';
import { confirmReplaceProject, requestNewProject } from './confirmReplace';
import { useEditor } from './store/store';

beforeEach(() => {
  useEditor.getState().newProject();
  vi.restoreAllMocks();
});

const addContent = () =>
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'x', normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg"/>', viewBox: '0 0 1 1', width: 1, height: 1 });

describe('confirmReplaceProject', () => {
  it('passes silently on a pristine project', () => {
    const confirm = vi.spyOn(window, 'confirm');
    expect(confirmReplaceProject('replace?')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks when the project has content and returns the user answer', () => {
    addContent();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmReplaceProject('replace?')).toBe(false);
    confirm.mockReturnValue(true);
    expect(confirmReplaceProject('replace?')).toBe(true);
    expect(confirm).toHaveBeenCalledWith('replace?');
  });
});

describe('requestNewProject', () => {
  it('resets on confirm, keeps the project on cancel', () => {
    addContent();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const before = useEditor.getState().history.present;
    requestNewProject();
    expect(useEditor.getState().history.present).toBe(before);
    confirm.mockReturnValue(true);
    requestNewProject();
    expect(useEditor.getState().history.present.assets).toHaveLength(0);
  });
});
