import { beforeEach, describe, expect, it } from 'vitest';
import type { Change, EditService, ProjectStore } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { MSG } from '@/app/messages';
import { createProjectStore } from '@/app/store';
import { createEmptyProject } from '@/model/projectOps';
import { NEW_TRACK_VOLUME } from '@/model/constants';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { SourceRegistry, TrackId } from '@/model/types';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

let registry: SourceRegistry;
let store: ProjectStore;
let edit: EditService;
let commits: Change[];

function addSource(id: string, duration = 20): void {
  registry.add({
    id,
    fileName: `${id}.wav`,
    status: 'ready',
    buffer: fakeAudioBuffer({ duration }),
    peaks: null,
    refCount: 0,
  });
}

/** Adds a clip through the service; returns its id. */
function place(trackId: TrackId, sourceId: string, start: number, duration: number): string {
  const r = edit.addClip(trackId, sourceId, duration, start);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const track = (id: TrackId) => store.get().tracks.find((t) => t.id === id)!;
const spans = (id: TrackId) => track(id).clips.map((c) => [c.startTime, c.duration]);
const refCount = (id: string) => registry.get(id)?.refCount ?? 0;

/** Everything an edit could change, to check failed edits change nothing. */
function snapshot() {
  return JSON.stringify({
    tracks: store.get().tracks,
    sources: registry.all().map((s) => [s.id, s.refCount]),
  });
}

/** Runs `fn` and checks it left the project as it was and emitted no commit. */
function expectNoChange(fn: () => void): void {
  const before = snapshot();
  const count = commits.length;
  fn();
  expect(snapshot()).toBe(before);
  expect(commits).toHaveLength(count);
}

beforeEach(() => {
  registry = createSourceRegistry();
  store = createProjectStore(createEmptyProject('Test', registry, 'p'));
  edit = createEditService(store);
  addSource('s1');
  addSource('s2');
  commits = [];
  store.subscribe((c) => commits.push(c));
});

// ---------- Part 2: trim, split, region delete, fades (A5, A7) ----------

/** [startTime, sourceOffset, duration, fadeIn, fadeOut] of every clip on the track. */
const numbers = (id: TrackId) =>
  track(id).clips.map((c) => [c.startTime, c.sourceOffset, c.duration, c.fadeIn, c.fadeOut]);

/** A clip of s1 on a new track, with fades, added through the service. */
function clipWithFades(start: number, duration: number, fadeIn = 0, fadeOut = 0) {
  const t = edit.addTrack();
  const id = place(t, 's1', start, duration);
  if (fadeIn || fadeOut) expect(edit.setFades(id, fadeIn, fadeOut).ok).toBe(true);
  commits = [];
  return { t, id };
}

describe('split', () => {
  it('fails outside the clip or for an unknown clip, changing nothing', () => {
    const { id } = clipWithFades(0, 2);
    expectNoChange(() => {
      expect(edit.split(id, 3)).toEqual({ ok: false, error: MSG.editOutsideClip });
      expect(edit.split('nope', 1)).toEqual({ ok: false, error: MSG.editNoClip });
    });
  });
});

// ---------- A3 Table 2 (timeline and editing): invalid input leaves the project unchanged,
// makes no commit and shows the exact message ----------

describe('A3 Table 2: split point (d = 8)', () => {
  it('4 is accepted', () => {
    const { t, id } = clipWithFades(0, 8);
    expect(edit.split(id, 4).ok).toBe(true);
    expect(spans(t)).toEqual([
      [0, 4],
      [4, 4],
    ]);
  });

  it.each([0.02, 7.99])('%d is rejected', (at) => {
    const { id } = clipWithFades(0, 8);
    expectNoChange(() =>
      expect(edit.split(id, at)).toEqual({ ok: false, error: MSG.editTooShort }),
    );
  });
});

describe('A3 Table 2: fade lengths (d = 8)', () => {
  it('0.5 / 1.0 is accepted', () => {
    const { t, id } = clipWithFades(0, 8);
    expect(edit.setFades(id, 0.5, 1.0).ok).toBe(true);
    expect(numbers(t)).toEqual([[0, 0, 8, 0.5, 1]]);
  });

  it.each([
    ['−1', -1, 0, MSG.fadeInvalid],
    ['"abc"', Number('abc'), 0, MSG.fadeInvalid], // what a typed "abc" becomes
    ['5 / 5', 5, 5, MSG.fadeTooLong],
  ])('%s is rejected', (_, a, b, message) => {
    const { id } = clipWithFades(0, 8);
    expectNoChange(() => expect(edit.setFades(id, a, b)).toEqual({ ok: false, error: message }));
  });
});

describe('A3 Table 2: track name', () => {
  it('"Narration" is accepted', () => {
    const t = edit.addTrack();
    expect(edit.renameTrack(t, 'Narration').ok).toBe(true);
    expect(track(t).name).toBe('Narration');
  });

  it.each([
    ['empty', '', MSG.nameEmpty],
    ['all spaces', '   ', MSG.nameEmpty],
    ['65 characters', 'n'.repeat(65), MSG.nameTooLong],
  ])('%s is rejected', (_, name, message) => {
    const t = edit.addTrack();
    expectNoChange(() => expect(edit.renameTrack(t, name)).toEqual({ ok: false, error: message }));
  });
});

describe('A3 Table 1/2: drop position', () => {
  it.each([
    [-2, 0],
    [-0.001, 0],
    [0, 0],
  ])('a start of %d is moved to %d', (start, expected) => {
    const t = edit.addTrack();
    const id = place(t, 's1', 5, 2);
    expect(edit.moveClip(id, t, start).ok).toBe(true);
    expect(spans(t)).toEqual([[expected, 2]]);
  });
});

describe('edge cases', () => {
  it('a track whose only clip is deleted is empty and still usable', () => {
    const { t, id } = clipWithFades(2, 4);
    expect(edit.deleteRegion(id, 2, 6).ok).toBe(true);
    expect(track(t).clips).toEqual([]);
    expect(registry.get('s1')).toBeUndefined();
    // The empty track takes a new clip and can be renamed and muted as before.
    expect(edit.addClip(t, 's2', 1, 0).ok).toBe(true);
    expect(edit.renameTrack(t, 'Again').ok).toBe(true);
    edit.toggleMute(t);
    expect(track(t)).toMatchObject({ name: 'Again', muted: true });
  });

  it('mono and stereo sources live in one project', () => {
    registry.add({
      id: 'stereo',
      fileName: 'stereo.wav',
      status: 'ready',
      buffer: fakeAudioBuffer({ duration: 5, channels: 2 }),
      peaks: null,
      refCount: 0,
    });
    const t = edit.addTrack();
    const mono = place(t, 's1', 0, 3);
    const stereo = place(t, 'stereo', 0, 5); // lands after the mono clip
    expect(spans(t)).toEqual([
      [0, 3],
      [3, 5],
    ]);
    expect(edit.split(stereo, 5).ok).toBe(true);
    expect(edit.split(mono, 1).ok).toBe(true);
    expect([refCount('s1'), refCount('stereo')]).toEqual([2, 2]);
  });
});

describe('undo and redo', () => {
  it('reverts a split and a clip removal (bringing the audio back), and redo reapplies them', () => {
    const { t, id } = clipWithFades(0, 8);
    edit = createEditService(store); // a fresh history: setting up the clip was not a step
    expect(edit.canUndo()).toBe(false);
    expect(edit.undo()).toEqual({ ok: false, error: MSG.nothingToUndo });

    expect(edit.split(id, 4).ok).toBe(true);
    edit.removeClip(id);
    expect(spans(t)).toEqual([[4, 4]]);

    edit.undo(); // the removed clip is back, its source retained again
    expect(spans(t)).toEqual([
      [0, 4],
      [4, 4],
    ]);
    expect(refCount('s1')).toBe(2);
    edit.undo(); // the split is gone and the audio is in one piece again
    expect(spans(t)).toEqual([[0, 8]]);
    expect(refCount('s1')).toBe(1);

    expect(edit.redo().ok).toBe(true);
    expect(spans(t)).toEqual([
      [0, 4],
      [4, 4],
    ]);
    edit.setVolume(t, 0.2);
    expect(edit.canRedo()).toBe(false); // a new edit clears the redo list
  });

  it('a failed edit is not a step, and a volume drag is one step', () => {
    const t = edit.addTrack();
    expect(edit.renameTrack(t, '').ok).toBe(false);
    edit.setVolume(t, 0.5);
    edit.setVolume(t, 0.4);
    edit.setVolume(t, 0.3);
    edit.undo(); // the whole drag
    expect(track(t).volume).toBe(NEW_TRACK_VOLUME);
    edit.undo(); // addTrack
    expect(store.get().tracks).toHaveLength(0);
    expect(edit.canUndo()).toBe(false);
  });

  it('deleting every track (Reset) is one edit and one undo step', () => {
    const { t } = clipWithFades(0, 4);
    place(edit.addTrack(), 's2', 0, 2);
    edit = createEditService(store); // a fresh history
    commits.length = 0;
    edit.deleteAllTracks();
    expect(store.get().tracks).toHaveLength(0);
    expect(commits).toHaveLength(1);
    expect([refCount('s1'), refCount('s2')]).toEqual([0, 0]);
    edit.undo();
    expect(store.get().tracks).toHaveLength(2);
    expect(spans(t)).toEqual([[0, 4]]);
    expect([refCount('s1'), refCount('s2')]).toEqual([1, 1]);
    expect(edit.canUndo()).toBe(false); // that was the only step
  });
});
