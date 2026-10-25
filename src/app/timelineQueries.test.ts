import { beforeEach, describe, expect, it } from 'vitest';
import type { EditService, TimelineQueries } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { createProjectStore } from '@/app/store';
import { createTimelineQueries } from '@/app/timelineQueries';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { SourceRegistry, TrackId } from '@/model/types';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

let registry: SourceRegistry;
let edit: EditService;
let q: TimelineQueries;
/** Track A: [0, 4) and [6, 10) of s1. Track B: a 2 s clip at 20 and a 3 s clip at 30, of s2. */
let A: TrackId;
let B: TrackId;
let b2s: string;

function place(trackId: TrackId, sourceId: string, start: number, duration: number): string {
  const r = edit.addClip(trackId, sourceId, duration, start);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

beforeEach(() => {
  registry = createSourceRegistry();
  for (const id of ['s1', 's2']) {
    registry.add({
      id,
      fileName: `${id}.wav`,
      status: 'ready',
      buffer: fakeAudioBuffer({ duration: 40 }),
      peaks: null,
      refCount: 0,
    });
  }
  const store = createProjectStore(createEmptyProject('Test', registry, 'p'));
  edit = createEditService(store);
  q = createTimelineQueries(store);
  A = edit.addTrack();
  B = edit.addTrack();
  place(A, 's1', 0, 4);
  place(A, 's1', 6, 4);
  b2s = place(B, 's2', 20, 2);
  place(B, 's2', 30, 3);
});

describe('beginDrag (A4)', () => {
  it('8 px snaps, 9 px does not', () => {
    const drag = q.beginDrag(b2s, 0);
    expect(drag.update(4.08, A, 100, true)).toMatchObject({ start: 4, snapLine: 4 });
    expect(drag.update(4.09, A, 100, true)).toMatchObject({
      start: 4.09,
      snapLine: null,
      valid: false,
    });
  });
});

describe('A3 Table 1: project size (16 tracks × 50 clips)', () => {
  it('stays usable in EditService and the queries', () => {
    const ids: TrackId[] = [];
    for (let i = 0; i < 16; i++) {
      const t = i < 2 ? [A, B][i] : edit.addTrack();
      ids.push(t);
      // 50 clips of 1 s with 1 s gaps, added out of order (k · 7 mod 50 visits every k).
      for (let k = 0; k < 50; k++) place(t, 's1', 100 + 2 * ((k * 7) % 50), 1);
    }
    const tracks = q.audibility().size;
    expect(tracks).toBe(16);

    for (const t of ids) {
      const clips = q.visibleClips(t, 100, 300);
      expect(clips).toHaveLength(50);
      expect(clips.map((c) => c.startTime)).toEqual(
        Array.from({ length: 50 }, (_, k) => 100 + 2 * k),
      );
      expect(q.clipAt(t, 150.5)?.startTime).toBe(150);
      expect(q.clipAt(t, 151.5)).toBeNull();
    }

    // A drag over the full project: the clip fits a gap exactly and snaps into it.
    const last = q.visibleClips(ids[15], 198, 199)[0];
    const preview = q.beginDrag(last.id, 0).update(101.02, ids[0], 100, true);
    expect(preview).toMatchObject({ start: 101, valid: true });
    expect(edit.moveClip(last.id, ids[0], preview.start).ok).toBe(true);
    expect(q.projectEnd()).toBe(199);
  });
});
