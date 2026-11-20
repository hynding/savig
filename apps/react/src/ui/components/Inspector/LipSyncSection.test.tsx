import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createGroupObject, createSceneObject, createSymbolAsset } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { useEditor } from '../../store/store';
import { LipSyncSection } from './LipSyncSection';

// 1 s of audio at 1000 Hz: silent, then loud in the middle.
vi.mock('../../audio/decode', () => ({
  decodeAudioBuffer: async () => {
    const data = new Float32Array(1000);
    for (let i = 300; i < 700; i++) data[i] = 0.8;
    return { sampleRate: 1000, duration: 1, getChannelData: () => data };
  },
}));

function seed() {
  useEditor.getState().newProject();
  const layer: SceneObject = { ...createGroupObject({ id: 'L', anchorX: 0, anchorY: 0, zOrder: 0 }), frames: { keys: [{ id: 'a', time: 0 }, { id: 'b', time: 0.1 }], end: 0.2 } };
  const sym = createSymbolAsset({ id: 'mouth', name: 'Mouth', objects: [layer], width: 1, height: 1 });
  const inst = createSceneObject('mouth', { id: 'm1', zOrder: 0 });
  const p = useEditor.getState().history.present;
  useEditor.getState().setProject(
    {
      ...p,
      assets: [...p.assets, sym, { id: 'voice', kind: 'audio', name: 'voice.wav', mimeType: 'audio/wav', duration: 1 }],
      objects: [inst],
      audioClips: [{ id: 'c1', assetId: 'voice', startTime: 0.5, inPoint: 0, outPoint: 1, volume: 1 }],
    },
    { voice: new Uint8Array([1, 2, 3]) },
  );
}

it('hints when there is no clip', () => {
  useEditor.getState().newProject();
  render(<LipSyncSection objectId="x" />);
  expect(screen.getByText(/Import a voice clip/)).toBeTruthy();
});

it('syncs the instance to the chosen clip', async () => {
  seed();
  render(<LipSyncSection objectId="m1" />);
  expect(screen.getByTestId('lip-sync-clip').textContent).toContain('voice.wav @ 0.50s');
  fireEvent.click(screen.getByTestId('lip-sync-run'));
  await waitFor(() => expect(screen.getByTestId('lip-sync-result').textContent).toMatch(/Synced \d+ frames to 2 poses/));
  const track = useEditor.getState().history.present.objects.find((o) => o.id === 'm1')!.symbolTimeTrack!;
  expect(track.some((k) => k.value === 0.1)).toBe(true);
  expect(track[track.length - 1].value).toBe(0);
});
