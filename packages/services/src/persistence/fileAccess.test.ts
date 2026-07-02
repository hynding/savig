import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBytesFromDisk, saveBytesToDisk } from './fileAccess';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'showSaveFilePicker');
  Reflect.deleteProperty(window, 'showOpenFilePicker');
});

describe('saveBytesToDisk', () => {
  it('uses showSaveFilePicker when available', async () => {
    const write = vi.fn();
    const close = vi.fn();
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const picker = vi.fn().mockResolvedValue({ createWritable });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;

    await saveBytesToDisk(new Uint8Array([1, 2]), 'out.savig');

    expect(picker).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('falls back to an anchor download when picker is absent', async () => {
    const click = vi.fn();
    const anchor = document.createElement('a');
    anchor.click = click;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });

    await saveBytesToDisk(new Uint8Array([1]), 'out.savig');

    expect(click).toHaveBeenCalledOnce();
  });
});

describe('openBytesFromDisk', () => {
  it('reads bytes via showOpenFilePicker when available', async () => {
    // File-like stub: jsdom's File.arrayBuffer hangs under this runner, and we
    // only need name + arrayBuffer, which is what the production code reads.
    const file = {
      name: 'in.savig',
      arrayBuffer: async () => new Uint8Array([5, 6, 7]).buffer,
    };
    const handle = { getFile: vi.fn().mockResolvedValue(file) };
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
      .fn()
      .mockResolvedValue([handle]);

    const result = await openBytesFromDisk();

    expect(result?.name).toBe('in.savig');
    expect(result?.bytes).toEqual(new Uint8Array([5, 6, 7]));
  });

  it('resolves null when the picker is cancelled (AbortError)', async () => {
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' }));

    expect(await openBytesFromDisk()).toBeNull();
  });
});
