interface SaveFilePicker {
  (options?: { suggestedName?: string }): Promise<{
    createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
  }>;
}
interface OpenFilePicker {
  (): Promise<Array<{ getFile(): Promise<File> }>>;
}

export async function saveBytesToDisk(
  bytes: Uint8Array,
  suggestedName: string,
  mimeType = 'application/octet-stream',
): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // Fall through to the download fallback on any non-cancel failure.
    }
  }
  downloadBytes(bytes, suggestedName, mimeType);
}

export async function openBytesFromDisk(
  accept = '.savig',
): Promise<{ name: string; bytes: Uint8Array } | null> {
  const picker = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (picker) {
    try {
      const [handle] = await picker();
      const file = await handle.getFile();
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null;
      // Fall through to the input fallback.
    }
  }
  return openViaInput(accept);
}

function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function openViaInput(accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    };
    input.click();
  });
}
