import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAutosaveStore } from './autosave';

describe('autosave store', () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory(); // isolated db per test
  });

  it('returns null when nothing is saved', async () => {
    const store = createAutosaveStore(factory);
    expect(await store.load()).toBeNull();
  });

  it('saves and loads bytes', async () => {
    const store = createAutosaveStore(factory);
    await store.save(new Uint8Array([1, 2, 3]));
    expect(await store.load()).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('overwrites the previous autosave', async () => {
    const store = createAutosaveStore(factory);
    await store.save(new Uint8Array([1]));
    await store.save(new Uint8Array([2, 2]));
    expect(await store.load()).toEqual(new Uint8Array([2, 2]));
  });

  it('clears the autosave', async () => {
    const store = createAutosaveStore(factory);
    await store.save(new Uint8Array([1]));
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('degrades gracefully when IndexedDB operations fail', async () => {
    const brokenFactory = {
      open() {
        throw new Error('IndexedDB blocked');
      },
    } as unknown as IDBFactory;
    const store = createAutosaveStore(brokenFactory);
    await expect(store.save(new Uint8Array([1]))).resolves.toBeUndefined();
    expect(await store.load()).toBeNull();
  });
});
