import { PX_PER_SECOND_DEFAULT, PX_PER_SECOND_MAX, PX_PER_SECOND_MIN } from '@/model/constants';
import type { ClipId, Seconds, TrackId } from '@/model/types';

export interface Selection {
  clipId: ClipId;
  start: Seconds;
  end: Seconds;
} // timeline seconds
export interface ViewState {
  pxPerSecond: number; // clamped to [PX_PER_SECOND_MIN, PX_PER_SECOND_MAX]
  scrollOffset: Seconds; // clamped ≥ 0
  snapEnabled: boolean; // default true
  selectedTrackId: TrackId | null;
  selectedClipId: ClipId | null;
  selection: Selection | null; // highlighted region (orange)
}
export interface ViewStore {
  get(): ViewState;
  set(patch: Partial<ViewState>): void; // new snapshot object each time
  subscribe(listener: () => void): () => void;
}

const DEFAULTS: ViewState = {
  pxPerSecond: PX_PER_SECOND_DEFAULT,
  scrollOffset: 0,
  snapEnabled: true,
  selectedTrackId: null,
  selectedClipId: null,
  selection: null,
};

function clamped(state: ViewState): ViewState {
  return {
    ...state,
    pxPerSecond: Math.min(PX_PER_SECOND_MAX, Math.max(PX_PER_SECOND_MIN, state.pxPerSecond)),
    scrollOffset: Math.max(0, state.scrollOffset),
  };
}

/** UI-only state (zoom, scroll, selection). Never saved with the project. */
export function createViewStore(initial: Partial<ViewState> = {}): ViewStore {
  let state = clamped({ ...DEFAULTS, ...initial });
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    set(patch) {
      state = clamped({ ...state, ...patch });
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
