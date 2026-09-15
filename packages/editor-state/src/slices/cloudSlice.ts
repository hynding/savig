import { type SliceCreator } from '../store-internals';

type CloudKeys = 'setCloudUser' | 'setCloudLink' | 'clearCloudLink';

export const createCloudSlice: SliceCreator<CloudKeys> = (set, get) => ({
  setCloudUser(user) {
    const prev = get().cloudUser;
    const userChanged = user === null || (prev !== null && prev.id !== user.id);
    // A sign-out or a different account must never be able to target the previous user's row
    // (a stale link would surface as a confusing silent RLS denial — spec §5/§8).
    set(userChanged ? { cloudUser: user, cloudProjectId: null, cloudUpdatedAt: null } : { cloudUser: user });
  },
  setCloudLink(projectId, updatedAt) {
    set({ cloudProjectId: projectId, cloudUpdatedAt: updatedAt });
  },
  clearCloudLink() {
    set({ cloudProjectId: null, cloudUpdatedAt: null });
  },
});
