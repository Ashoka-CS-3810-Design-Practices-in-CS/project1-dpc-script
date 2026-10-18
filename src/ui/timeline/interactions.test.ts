import { beforeEach, describe, expect, it } from 'vitest';
import type { EditService, ProjectStore, TimelineQueries } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { createProjectStore } from '@/app/store';
import { createTimelineQueries } from '@/app/timelineQueries';
import { CLIP_HEADER_PX, EDGE_HANDLE_PX, FADE_HANDLE_PX } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { TrackId } from '@/model/types';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';
import { CLIP_INSET_PX, rowTop } from '@/ui/timeline/geometry';
import {
  beginGesture,
  cursorFor,
  DRAG_THRESHOLD_PX,
  hitTest,
  type Gesture,
  type GestureDeps,
  type Zone,
} from '@/ui/timeline/interactions';
import { NO_PREVIEW } from '@/ui/timeline/overlay';
import { createViewStore, type ViewStore } from '@/ui/viewStore';

// 100 px/s, scroll 0: x = 100 · t. Track A: [0, 4) and [6, 10). Track B: a 2 s clip at 20.
let store: ProjectStore;
let edit: EditService;
let queries: TimelineQueries;
let view: ViewStore;
let A: TrackId;
let B: TrackId;
let a1: string;
let a2: string;
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
/** y in the move strip, the waveform body, of row `i`. */
const headerY = (i: number) => clipTop(i) + CLIP_HEADER_PX - 1;
const bodyY = (i: number) => clipTop(i) + CLIP_HEADER_PX + 20;

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
  a1 = place(A, 0, 4);
  a2 = place(A, 6, 4);
  b1 = place(B, 20, 2);
  playhead = 0;
});

describe('hitTest (README §9.5 R10)', () => {
  // a2 is drawn from x = 600 to 1000, from y = clipTop(0).
  const left = 600;
  const right = 1000;

  it('the ruler, empty rows and the space below the rows', () => {
    expect(zoneAt(450, 5)).toEqual({ kind: 'ruler' });
    expect(zoneAt(450, bodyY(0))).toEqual({ kind: 'row', trackIndex: 0 }); // between clips
    expect(zoneAt(100, bodyY(1))).toEqual({ kind: 'row', trackIndex: 1 });
    expect(zoneAt(700, rowTop(0))).toEqual({ kind: 'row', trackIndex: 0 }); // inset above the clip
    expect(zoneAt(700, rowTop(2))).toEqual({ kind: 'outside' });
  });

  it.each([
    // [x, y below the clip top, zone, edge]
    [left, 0, 'fade', 'in'],
    [left + FADE_HANDLE_PX - 1, FADE_HANDLE_PX - 1, 'fade', 'in'],
    [left + FADE_HANDLE_PX, 0, 'move', undefined], // just right of the square
    [left, FADE_HANDLE_PX, 'trim', 'start'], // just below the square
    [right - 1, 0, 'fade', 'out'],
    [right - FADE_HANDLE_PX, FADE_HANDLE_PX - 1, 'fade', 'out'],
    [right - FADE_HANDLE_PX - 1, 0, 'move', undefined],
    [left + EDGE_HANDLE_PX - 1, 40, 'trim', 'start'],
    [left + EDGE_HANDLE_PX, 40, 'body', undefined],
    [right - EDGE_HANDLE_PX, 40, 'trim', 'end'],
    [right - EDGE_HANDLE_PX - 1, 40, 'body', undefined],
    [800, CLIP_HEADER_PX - 1, 'move', undefined],
    [800, CLIP_HEADER_PX, 'body', undefined],
  ])('(%d, top + %d) → %s %s', (x, dy, kind, edge) => {
    const zone = zoneAt(x, clipTop(0) + dy);
    expect(zone.kind).toBe(kind);
    if ('clip' in zone) expect(zone.clip.id).toBe(a2);
    if (edge) expect(zone).toMatchObject({ edge });
  });

  it('the clip end is exclusive: x at the end belongs to what follows', () => {
    expect(zoneAt(1000, bodyY(0))).toEqual({ kind: 'row', trackIndex: 0 });
  });

  it('cursor shapes per zone', () => {
    expect(cursorFor(zoneAt(800, headerY(0)), false)).toBe('grab');
    expect(cursorFor(zoneAt(800, headerY(0)), true)).toBe('grabbing');
    expect(cursorFor(zoneAt(601, bodyY(0)), false)).toBe('ew-resize');
    expect(cursorFor(zoneAt(601, clipTop(0)), false)).toBe('ew-resize');
    expect(cursorFor(zoneAt(800, bodyY(0)), false)).toBe('text');
    expect(cursorFor(zoneAt(800, 5), false)).toBe('pointer');
    expect(cursorFor(zoneAt(450, bodyY(0)), false)).toBe('default');
  });
});

describe('move gesture (A4)', () => {
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

  it('dropping off the rows commits nothing', () => {
    const g = start(2050, headerY(1));
    expect(g.move(455, rowTop(2) + 5).preview.drag).toMatchObject({
      trackIndex: null,
      valid: false,
    });
    expect(g.end(455, rowTop(2) + 5).commit).toBeUndefined();
  });

  it('a click without dragging only selects the clip', () => {
    const g = start(2050, headerY(1));
    expect(g.move(2050 + DRAG_THRESHOLD_PX - 1, headerY(1))).toEqual({ preview: NO_PREVIEW });
    expect(g.end(2050 + DRAG_THRESHOLD_PX - 1, headerY(1))).toEqual({ preview: NO_PREVIEW });
  });

  it('snapping off keeps the exact position; the playhead is a snap point', () => {
    view.set({ snapEnabled: false });
    expect(start(2050, headerY(1)).end(1255, headerY(0)).commit).toMatchObject({ start: 12.05 });
    view.set({ snapEnabled: true });
    playhead = 30;
    // 30.45 − 0.5 = 29.95 → snaps to the playhead at 30.
    expect(start(2050, headerY(1)).end(3045, headerY(1)).commit).toMatchObject({ start: 30 });
  });

  it('cancel drops the preview', () => {
    const g = start(2050, headerY(1));
    g.move(455, headerY(0));
    expect(g.cancel()).toEqual({ preview: NO_PREVIEW });
  });
});

describe('region select gesture (A5)', () => {
  it('dragging across the waveform selects a region of the clip', () => {
    const g = start(100, bodyY(0));
    expect(g.down.view).toEqual({ selectedClipId: a1, selectedTrackId: A, selection: null });
    expect(g.move(300, bodyY(0)).view).toEqual({ selection: { clipId: a1, start: 1, end: 3 } });
    // Backwards, and past the clip's start: clamped to the clip.
    expect(g.end(-200, bodyY(0)).view).toEqual({ selection: { clipId: a1, start: 0, end: 1 } });
  });

  it('is clamped to the clip end', () => {
    const g = start(100, bodyY(0));
    expect(g.end(550, bodyY(0)).view).toEqual({ selection: { clipId: a1, start: 1, end: 4 } });
  });

  it('a click selects the clip and clears the region', () => {
    view.set({ selection: { clipId: a1, start: 1, end: 2 } });
    const g = start(300, bodyY(0));
    expect(g.down.view).toMatchObject({ selectedClipId: a1, selection: null });
    expect(g.end(301, bodyY(0))).toEqual({ preview: NO_PREVIEW });
  });

  it('pressing another part of the same clip keeps its region until a drag replaces it', () => {
    view.set({ selection: { clipId: a1, start: 1, end: 2 } });
    expect(start(200, headerY(0)).down.view).not.toHaveProperty('selection');
    expect(start(800, headerY(0)).down.view).toMatchObject({ selection: null }); // another clip
  });
});

describe('fade gesture (A7)', () => {
  it('drags the fade-in, clamped so both fades fit the clip', () => {
    expect(edit.setFades(a1, 0, 1).ok).toBe(true);
    const g = start(1, clipTop(0) + 1);
    expect(g.zone).toMatchObject({ kind: 'fade', edge: 'in' });
    expect(g.move(150, clipTop(0)).preview.fades).toEqual({
      trackIndex: 0,
      start: 0,
      duration: 4,
      fadeIn: 1.5,
      fadeOut: 1,
    });
    // Overshoot is impossible: 3.9 s would not fit next to the 1 s fade-out.
    expect(g.end(390, clipTop(0))).toEqual({
      preview: NO_PREVIEW,
      commit: { kind: 'fades', clipId: a1, fadeIn: 3, fadeOut: 1 },
    });
  });

  it('drags the fade-out from the right corner', () => {
    const g = start(399, clipTop(0) + 1);
    expect(g.zone).toMatchObject({ kind: 'fade', edge: 'out' });
    expect(g.end(250, clipTop(0)).commit).toEqual({
      kind: 'fades',
      clipId: a1,
      fadeIn: 0,
      fadeOut: 1.5,
    });
    expect(start(399, clipTop(0)).end(-100, clipTop(0)).commit).toMatchObject({ fadeOut: 4 });
  });

  it('a click on a handle changes nothing', () => {
    const g = start(1, clipTop(0) + 1);
    expect(g.end(2, clipTop(0) + 1)).toEqual({ preview: NO_PREVIEW });
  });
});

describe('trim gesture (A5)', () => {
  it('the end edge is clamped at the next clip', () => {
    const g = start(398, bodyY(0));
    expect(g.zone).toMatchObject({ kind: 'trim', edge: 'end' });
    expect(g.move(700, bodyY(0)).preview.drag).toEqual({
      trackIndex: 0,
      start: 0,
      duration: 6,
      valid: true,
      snapLine: null,
    });
    expect(g.end(700, bodyY(0)).commit).toEqual({ kind: 'trim', clipId: a1, edge: 'end', time: 6 });
  });

  it('the start edge is clamped at the start of the audio and the minimum length', () => {
    const g = start(602, bodyY(0));
    expect(g.zone).toMatchObject({ kind: 'trim', edge: 'start' });
    expect(g.move(100, bodyY(0)).preview.drag).toMatchObject({ start: 6, duration: 4 });
    const { commit } = g.end(1200, bodyY(0));
    expect(commit).toMatchObject({ kind: 'trim', clipId: a2, edge: 'start' });
    expect(commit?.kind === 'trim' && commit.time).toBeCloseTo(9.95, 9); // 10 − MIN_CLIP_LENGTH
  });

  it('a click on an edge changes nothing', () => {
    expect(start(398, bodyY(0)).end(398, bodyY(0))).toEqual({ preview: NO_PREVIEW });
  });
});

describe('ruler and rows', () => {
  it('pressing and dragging on the ruler seeks, never before 0', () => {
    const g = start(250, 5);
    expect(g.down).toEqual({ preview: NO_PREVIEW, seek: 2.5 });
    expect(g.move(-50, 5).seek).toBe(0);
    expect(g.end(1234, 5).seek).toBe(12.34);
  });

  it('pressing an empty row selects the track and clears the clip selection', () => {
    view.set({ selectedClipId: a1, selection: { clipId: a1, start: 1, end: 2 } });
    const g = start(450, bodyY(0));
    expect(g.down.view).toEqual({ selectedTrackId: A, selectedClipId: null, selection: null });
    expect(g.move(500, bodyY(0))).toEqual({ preview: NO_PREVIEW });
    expect(g.end(500, bodyY(0))).toEqual({ preview: NO_PREVIEW });
  });

  it('pressing below the rows starts no gesture', () => {
    expect(beginGesture(zoneAt(450, rowTop(2) + 5), 450, rowTop(2) + 5, deps())).toBeNull();
  });
});
