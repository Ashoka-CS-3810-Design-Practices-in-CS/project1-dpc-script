import { beforeEach, describe, expect, it } from 'vitest';
import { buildPeaks, peakColumns } from '@/algorithms/peaks';
import type { EditService, TimelineQueries } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { createProjectStore } from '@/app/store';
import { createTimelineQueries } from '@/app/timelineQueries';
import { PEAK_BLOCK_SIZE } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { Clip, SourceRegistry, TrackId } from '@/model/types';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

let registry: SourceRegistry;
let edit: EditService;
let q: TimelineQueries;
/** Track A: [0, 4) and [6, 10) of s1. Track B: a 2 s clip at 20 and a 3 s clip at 30, of s2. */
let A: TrackId;
let B: TrackId;
let a1: string;
let a2: string;
let b2s: string;
let b3s: string;

function place(trackId: TrackId, sourceId: string, start: number, duration: number): string {
  const r = edit.addClip(trackId, sourceId, duration, start);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const clip = (id: string) => q.findClip(id)!.clip;

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
  a1 = place(A, 's1', 0, 4);
  a2 = place(A, 's1', 6, 4);
  b2s = place(B, 's2', 20, 2);
  b3s = place(B, 's2', 30, 3);
});

describe('lookups', () => {
  it('findClip returns the location, or null', () => {
    expect(q.findClip(a2)).toMatchObject({ trackIndex: 0, clipIndex: 1, clip: { startTime: 6 } });
    expect(q.findClip(b3s)).toMatchObject({ trackIndex: 1, clipIndex: 1 });
    expect(q.findClip('nope')).toBeNull();
  });

  it.each([
    [0, 'a1'],
    [3.99, 'a1'],
    [4, null], // ends are exclusive
    [5, null],
    [6, 'a2'],
    [10, null],
  ])('clipAt(A, %d) → %s', (t, name) => {
    const ids: Record<string, string> = { a1, a2 };
    expect(q.clipAt(A, t)?.id ?? null).toBe(name === null ? null : ids[name]);
  });

  it('clipAt on an unknown track is null', () => {
    expect(q.clipAt('nope', 1)).toBeNull();
  });

  it('visibleClips returns only the clips in the window', () => {
    const ids = (clips: Clip[]) => clips.map((c) => c.id);
    expect(ids(q.visibleClips(A, 0, 20))).toEqual([a1, a2]);
    expect(ids(q.visibleClips(A, 3, 5))).toEqual([a1]);
    expect(ids(q.visibleClips(A, 4, 6))).toEqual([a2]);
    expect(ids(q.visibleClips(A, 11, 20))).toEqual([]);
    expect(q.visibleClips('nope', 0, 100)).toEqual([]);
  });

  it('projectEnd is the latest clip end', () => {
    expect(q.projectEnd()).toBe(33);
    edit.removeClip(b3s);
    edit.removeClip(b2s);
    expect(q.projectEnd()).toBe(10);
  });
});

describe('beginDrag (A4)', () => {
  it('T5 snapping and neighbour overlap', () => {
    // 100 px/s → threshold 8 px = 0.08 s. [4, 6) fits exactly between [0, 4) and [6, 10).
    expect(q.beginDrag(b2s, 0).update(4.05, A, 100, true)).toEqual({
      trackId: A,
      start: 4,
      valid: true,
      snapLine: 4,
    });
    // [4, 7) overlaps [6, 10).
    expect(q.beginDrag(b3s, 0).update(4, A, 100, true)).toMatchObject({ start: 4, valid: false });
  });

  it('8 px snaps, 9 px does not', () => {
    const drag = q.beginDrag(b2s, 0);
    expect(drag.update(4.08, A, 100, true)).toMatchObject({ start: 4, snapLine: 4 });
    expect(drag.update(4.09, A, 100, true)).toMatchObject({
      start: 4.09,
      snapLine: null,
      valid: false,
    });
  });

  it('snaps the end edge and the playhead', () => {
    // Start edge from below: 3 s clip at 3.97 → 4 (its end 6.97 is far from any point).
    expect(q.beginDrag(b3s, 50).update(3.97, A, 100, true)).toMatchObject({
      start: 4,
      snapLine: 4,
    });
    const drag = q.beginDrag(b2s, 50);
    // End edge 29.95 snaps to 30 (start of the 3 s clip): [28, 30) touches it.
    expect(drag.update(27.95, B, 100, true)).toEqual({
      trackId: B,
      start: 28,
      valid: true,
      snapLine: 30,
    });
    expect(drag.update(49.95, B, 100, true)).toMatchObject({ start: 50, snapLine: 50 });
  });

  it('does not snap to the dragged clip itself', () => {
    const drag = q.beginDrag(b2s, 0);
    expect(drag.update(20.05, B, 100, true)).toMatchObject({ start: 20.05, snapLine: null });
  });

  it('without snapping the start is only clamped at 0', () => {
    const drag = q.beginDrag(b2s, 0);
    expect(drag.update(4.05, A, 100, false)).toMatchObject({
      start: 4.05,
      snapLine: null,
      valid: false,
    });
    expect(drag.update(-2, B, 100, false)).toMatchObject({ start: 0, valid: true });
  });

  it('ignores the dragged clip on its own track', () => {
    const drag = q.beginDrag(a1, 0);
    expect(drag.update(1, A, 100, false)).toMatchObject({ valid: true }); // over its old place
    expect(drag.update(2, A, 100, false)).toMatchObject({ valid: true }); // touching [6, 10)
    expect(drag.update(3, A, 100, false)).toMatchObject({ valid: false });
  });

  it('a drop off the tracks or on an unknown track is invalid', () => {
    const drag = q.beginDrag(b2s, 0);
    expect(drag.update(12, null, 100, true)).toMatchObject({ trackId: null, valid: false });
    expect(drag.update(12, 'nope', 100, true)).toMatchObject({ valid: false });
  });

  it('a cross-track drop that fits is valid and commits through moveClip', () => {
    const preview = q.beginDrag(b2s, 0).update(4.05, A, 100, true);
    expect(edit.moveClip(b2s, preview.trackId!, preview.start).ok).toBe(true);
    expect(q.visibleClips(A, 0, 20).map((c) => c.id)).toEqual([a1, b2s, a2]);
  });

  it('throws for an unknown clip', () => {
    expect(() => q.beginDrag('nope', 0)).toThrow();
  });
});

describe('edgeLimits', () => {
  it('stops at the neighbours and the audio file', () => {
    expect(q.edgeLimits(a1)).toEqual({ minStart: 0, maxEnd: 6 }); // next clip at 6
    expect(q.edgeLimits(a2)).toEqual({ minStart: 6, maxEnd: 46 }); // file starts at 6, 40 s long
    expect(edit.trimEdge(a2, 'start', 8).ok).toBe(true);
    expect(q.edgeLimits(a2)).toEqual({ minStart: 6, maxEnd: 46 });
  });

  it('without the audio the end edge stays put', () => {
    registry.update('s1', { status: 'missing', buffer: null });
    expect(q.edgeLimits(a2)).toEqual({ minStart: 6, maxEnd: 10 });
  });

  it('throws for an unknown clip', () => {
    expect(() => q.edgeLimits('nope')).toThrow();
  });
});

describe('waveformColumns', () => {
  it('is null while the peaks are loading or the audio is missing', () => {
    expect(q.waveformColumns(clip(a1), 100, 0, 10)).toBeNull(); // peaks not built yet
    registry.update('s1', { status: 'loading', buffer: null });
    expect(q.waveformColumns(clip(a1), 100, 0, 10)).toBeNull();
    registry.update('s1', { status: 'missing' });
    expect(q.waveformColumns(clip(a1), 100, 0, 10)).toBeNull();
  });

  it('reads the columns from the pyramid at the clip offset', () => {
    const buffer = fakeAudioBuffer({ duration: 4, fill: (i) => Math.sin(i / 50) });
    const peaks = buildPeaks([buffer.getChannelData(0)], buffer.sampleRate, PEAK_BLOCK_SIZE);
    registry.update('s1', { peaks });
    expect(edit.trimEdge(a1, 'start', 1.5).ok).toBe(true); // offset 1.5 s
    const c = clip(a1);
    const cols = q.waveformColumns(c, 100, 3, 20);
    expect(cols).toEqual(peakColumns(peaks, Math.round(1.5 * 44100), 441, 3, 20));
    expect(cols!.some((v) => v !== 0)).toBe(true);
  });
});

describe('fadeVolume and audibility', () => {
  it('fadeVolume uses the clip fades (A7)', () => {
    expect(edit.setFades(a2, 1, 2).ok).toBe(true);
    const c = clip(a2);
    expect(q.fadeVolume(c, 0)).toBe(0);
    expect(q.fadeVolume(c, 0.5)).toBe(0.5);
    expect(q.fadeVolume(c, 2)).toBe(1);
    expect(q.fadeVolume(c, 3)).toBe(0.5);
    expect(q.fadeVolume(c, 5)).toBe(0);
  });

  it('audibility follows mute, and solo overrides mute (A6)', () => {
    expect([...q.audibility()]).toEqual([
      [A, true],
      [B, true],
    ]);
    edit.toggleMute(A);
    expect(q.audibility().get(A)).toBe(false);
    edit.toggleSolo(A);
    expect([...q.audibility()]).toEqual([
      [A, true],
      [B, false],
    ]);
  });
});
