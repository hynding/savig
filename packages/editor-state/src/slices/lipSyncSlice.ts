// Audio lip sync (roadmap 12): key a mouth symbol instance's time remap from a voice clip's
// loudness. The app decodes the audio and passes per-frame levels (decoding is a browser concern);
// the pose picking and keying are the engine's pure lipSync functions. One undo step.
import { lipSyncPoseTimes, lipSyncPoses, lipSyncTrack } from '@savig/engine';
import { selectActiveObjects, selectActiveScope } from '../selectors';
import { lockedInScene, replaceObjectInScene } from '../store-internals';
import type { SliceCreator } from '../store-internals';

type LipSyncKeys = 'applyLipSync';

export const createLipSyncSlice: SliceCreator<LipSyncKeys> = (_set, get) => ({
  applyLipSync(instanceId, input) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === instanceId);
    const symbol = obj ? project.assets.find((a) => a.id === obj.assetId) : undefined;
    if (!obj || symbol?.kind !== 'symbol') {
      get().pushToast('error', 'Select a symbol instance holding the mouth poses.');
      return 0;
    }
    if (lockedInScene(selectActiveObjects(s), obj)) {
      get().pushToast('error', "Can't edit a locked object.");
      return 0;
    }
    const fps = project.meta.fps;
    const poseTimes = lipSyncPoseTimes(symbol, fps);
    if (poseTimes.length < 2) {
      get().pushToast('error', `${symbol.name} needs at least two mouth poses (a frame-by-frame layer with a key per pose).`);
      return 0;
    }
    const poses = lipSyncPoses(input.levels, poseTimes.length, { sensitivity: input.sensitivity, minHold: input.minHold });
    const track = lipSyncTrack(poses, poseTimes, input.startTime, fps);
    if (track.length === 0) {
      get().pushToast('error', 'That clip has no sound to sync to.');
      return 0;
    }
    get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, symbolTimeTrack: track, freezeFirstFrame: undefined }));
    return poseTimes.length;
  },
});
