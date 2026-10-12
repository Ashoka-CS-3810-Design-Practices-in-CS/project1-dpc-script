import type { ProjectStore, TimelineQueries } from '@/app/contracts';

function notImplemented(name: keyof TimelineQueries): never {
  throw new Error(`TimelineQueries.${name} not implemented yet`);
}

/** Stub (VR-01): empty answers so the UI can render. Real implementation: VR-06. */
export function createTimelineQueries(store: ProjectStore): TimelineQueries {
  void store;
  return {
    findClip: () => notImplemented('findClip'),
    clipAt: () => null,
    visibleClips: () => [],
    beginDrag: () => notImplemented('beginDrag'),
    edgeLimits: () => notImplemented('edgeLimits'),
    waveformColumns: () => null,
    fadeVolume: () => notImplemented('fadeVolume'),
    audibility: () => new Map(),
    projectEnd: () => 0,
  };
}
