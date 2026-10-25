import { beforeEach, describe, expect, it } from 'vitest';
import type { EditService, ProjectStore, TimelineQueries } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { createProjectStore } from '@/app/store';
import { createTimelineQueries } from '@/app/timelineQueries';
import { CLIP_HEADER_PX } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { TrackId } from '@/model/types';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';
import { CLIP_INSET_PX, rowTop } from '@/ui/timeline/geometry';
import {
  beginGesture,
  hitTest,
  type Gesture,
  type GestureDeps,
  type Zone,
} from '@/ui/timeline/interactions';
import { NO_PREVIEW } from '@/ui/timeline/overlay';
import { createViewStore, type ViewStore } from '@/ui/viewStore';

// The UI half of T5 (A3 Table 5): the red outline while dragging and the return on release.
// 100 px/s, scroll 0: x = 100 · t. Track A: [0, 4) and [6, 10). Track B: a 2 s clip at 20.
let store: ProjectStore;
let edit: EditService;
let queries: TimelineQueries;
let view: ViewStore;
let A: TrackId;
let B: TrackId;
let b1: string;
let playhead: number;

function place(trackId: TrackId, start: number, duration: number): string {
  const r = edit.addClip(trackId, 's1', duration, start);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const deps = (): GestureDeps => ({
  queries,
  view: () => view.get(),
  trackIds: () => store.get().tracks.map((t) => t.id),
  playhead: () => playhead,
});
const zoneAt = (x: number, y: number): Zone =>
  hitTest(x, y, { view: view.get(), trackIds: deps().trackIds(), clipAt: queries.clipAt });
const start = (x: number, y: number): Gesture => beginGesture(zoneAt(x, y), x, y, deps())!;
const clipTop = (trackIndex: number) => rowTop(trackIndex) + CLIP_INSET_PX;
/** y in the move strip of row `i`. */
const headerY = (i: number) => clipTop(i) + CLIP_HEADER_PX - 1;

beforeEach(() => {
  const registry = createSourceRegistry();
  registry.add({
    id: 's1',
    fileName: 's1.wav',
    status: 'ready',
    buffer: fakeAudioBuffer({ duration: 60 }),
    peaks: null,
    refCount: 0,
  });
  store = createProjectStore(createEmptyProject('Test', registry, 'p'));
  edit = createEditService(store);
  queries = createTimelineQueries(store);
  view = createViewStore();
  A = edit.addTrack();
  B = edit.addTrack();
  place(A, 0, 4);
  place(A, 6, 4);
  b1 = place(B, 20, 2);
  playhead = 0;
});

describe('move gesture (A4, T5)', () => {
  it('down → move → up drops the clip at the snapped start', () => {
    const g = start(2050, headerY(1)); // grab b1 0.5 s after its start
    expect(g.down.view).toEqual({ selectedClipId: b1, selectedTrackId: B, selection: null });

    // 4.55 − 0.5 = 4.05 → snaps to a1's end at 4; [4, 6) fits exactly.
    expect(g.move(455, headerY(0)).preview).toEqual({
      drag: { trackIndex: 0, start: 4, duration: 2, valid: true, snapLine: 4 },
      fades: null,
    });
    expect(g.end(455, headerY(0))).toEqual({
      preview: NO_PREVIEW,
      commit: { kind: 'move', clipId: b1, trackId: A, start: 4 },
    });
  });

  it('an invalid drop shows a red outline and commits nothing', () => {
    const g = start(2050, headerY(1));
    expect(g.move(400, headerY(0)).preview.drag).toMatchObject({ start: 3.5, valid: false });
    expect(g.end(400, headerY(0))).toEqual({ preview: NO_PREVIEW });
  });
});
