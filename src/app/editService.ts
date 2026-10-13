import type { EditService, ProjectStore } from '@/app/contracts';

function notImplemented(name: keyof EditService): never {
  throw new Error(`EditService.${name} not implemented yet`);
}

/** Stub (VR-01). Real implementation: VR-05 and VR-06. */
export function createEditService(store: ProjectStore): EditService {
  void store;
  return {
    addTrack: () => notImplemented('addTrack'),
    renameTrack: () => notImplemented('renameTrack'),
    deleteTrack: () => notImplemented('deleteTrack'),
    setVolume: () => notImplemented('setVolume'),
    toggleMute: () => notImplemented('toggleMute'),
    toggleSolo: () => notImplemented('toggleSolo'),
    addClip: () => notImplemented('addClip'),
    moveClip: () => notImplemented('moveClip'),
    trimToSelection: () => notImplemented('trimToSelection'),
    trimEdge: () => notImplemented('trimEdge'),
    split: () => notImplemented('split'),
    deleteRegion: () => notImplemented('deleteRegion'),
    removeClip: () => notImplemented('removeClip'),
    setFades: () => notImplemented('setFades'),
  };
}
