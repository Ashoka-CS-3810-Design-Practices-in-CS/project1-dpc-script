import { beforeEach, describe, expect, it } from 'vitest';
import type { EditErrorCode } from '@/algorithms/types';
import type { Change, EditService, ProjectStore } from '@/app/contracts';
import { createEditService, editErrorMessage } from '@/app/editService';
import { MSG } from '@/app/messages';
import { createProjectStore } from '@/app/store';
import { NEW_TRACK_VOLUME } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
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

describe('editErrorMessage', () => {
  it.each<[EditErrorCode, string]>([
    ['too-short', MSG.editTooShort],
    ['outside-clip', MSG.editOutsideClip],
    ['fade-invalid', MSG.fadeInvalid],
    ['fade-too-long', MSG.fadeTooLong],
    ['out-of-range', MSG.editOutOfRange],
  ])('%s → its message', (code, message) => {
    expect(editErrorMessage(code)).toBe(message);
  });
});

describe('tracks', () => {
  it('addTrack names "Track N", sets −6 dB and commits structure once', () => {
    const a = edit.addTrack();
    const b = edit.addTrack();
    expect(store.get().tracks.map((t) => [t.id, t.name])).toEqual([
      [a, 'Track 1'],
      [b, 'Track 2'],
    ]);
    expect(track(a)).toMatchObject({
      volume: NEW_TRACK_VOLUME,
      muted: false,
      soloed: false,
      clips: [],
    });
    expect(commits).toEqual([{ kind: 'structure' }, { kind: 'structure' }]);
  });

  it('renameTrack accepts a valid name', () => {
    const t = edit.addTrack();
    commits = [];
    expect(edit.renameTrack(t, 'Narration')).toEqual({ ok: true, value: undefined });
    expect(track(t).name).toBe('Narration');
    expect(commits).toEqual([{ kind: 'structure' }]);
  });

  it.each([
    ['', MSG.nameEmpty],
    ['   ', MSG.nameEmpty],
    ['x'.repeat(65), MSG.nameTooLong],
  ])('renameTrack(%j) fails with its message and changes nothing', (name, message) => {
    const t = edit.addTrack();
    expectNoChange(() => expect(edit.renameTrack(t, name)).toEqual({ ok: false, error: message }));
  });

  it('renameTrack accepts exactly 64 characters', () => {
    const t = edit.addTrack();
    expect(edit.renameTrack(t, 'x'.repeat(64)).ok).toBe(true);
  });

  it('renameTrack of an unknown track fails', () => {
    expectNoChange(() =>
      expect(edit.renameTrack('nope', 'A')).toEqual({ ok: false, error: MSG.importNoTrack }),
    );
  });

  it('deleteTrack removes the track and releases every clip source', () => {
    const t = edit.addTrack();
    const keep = edit.addTrack();
    place(t, 's1', 0, 2);
    place(t, 's1', 4, 2);
    place(t, 's2', 8, 2);
    place(keep, 's2', 0, 2);
    expect([refCount('s1'), refCount('s2')]).toEqual([2, 2]);
    commits = [];

    edit.deleteTrack(t);
    expect(store.get().tracks.map((x) => x.id)).toEqual([keep]);
    expect(registry.get('s1')).toBeUndefined(); // refCount 0 → freed
    expect(refCount('s2')).toBe(1);
    expect(commits).toEqual([{ kind: 'structure' }]);
  });

  it('deleteTrack of an unknown track does nothing', () => {
    edit.addTrack();
    expectNoChange(() => edit.deleteTrack('nope'));
  });
});

describe('mix settings', () => {
  it.each([
    [0.3, 0.3],
    [1.5, 1],
    [-0.2, 0],
    [0, 0],
    [1, 1],
  ])('setVolume(%d) stores %d and commits mix', (input, stored) => {
    const t = edit.addTrack();
    commits = [];
    edit.setVolume(t, input);
    expect(track(t).volume).toBe(stored);
    expect(commits).toEqual([{ kind: 'mix' }]);
  });

  it('toggleMute and toggleSolo flip the flag and commit mix', () => {
    const t = edit.addTrack();
    commits = [];
    edit.toggleMute(t);
    expect(track(t).muted).toBe(true);
    edit.toggleMute(t);
    expect(track(t).muted).toBe(false);
    edit.toggleSolo(t);
    expect(track(t).soloed).toBe(true);
    edit.toggleSolo(t);
    expect(track(t).soloed).toBe(false);
    expect(commits).toEqual(Array(4).fill({ kind: 'mix' }));
  });

  it('mix changes on an unknown track do nothing', () => {
    edit.addTrack();
    expectNoChange(() => {
      edit.setVolume('nope', 0.2);
      edit.toggleMute('nope');
      edit.toggleSolo('nope');
    });
  });
});

describe('addClip', () => {
  it('places the clip at `at` on an empty track, retains the source, commits once', () => {
    const t = edit.addTrack();
    commits = [];
    const r = edit.addClip(t, 's1', 2.5, 3);
    expect(r.ok).toBe(true);
    expect(track(t).clips).toEqual([
      {
        id: r.ok ? r.value : '',
        sourceId: 's1',
        startTime: 3,
        sourceOffset: 0,
        duration: 2.5,
        fadeIn: 0,
        fadeOut: 0,
      },
    ]);
    expect(refCount('s1')).toBe(1);
    expect(commits).toEqual([{ kind: 'structure' }]);
  });

  it('a negative position starts at 0', () => {
    const t = edit.addTrack();
    place(t, 's1', -1, 2);
    expect(spans(t)).toEqual([[0, 2]]);
  });

  // DS2 example [0,4), [5,9.5), [12,15): A1 step 6 takes the first gap that fits.
  it.each([
    [1, 4], // fits exactly in [4, 5) — touching is allowed
    [2, 9.5], // too long for [4, 5), fits in [9.5, 12)
    [3, 15], // fits in no gap, goes after the last clip
  ])('a %d s clip dropped at 3 lands at the first free start %d', (duration, start) => {
    const t = edit.addTrack();
    place(t, 's1', 0, 4);
    place(t, 's1', 5, 4.5);
    place(t, 's1', 12, 3);
    place(t, 's2', 3, duration);
    expect(spans(t)).toContainEqual([start, duration]);
    expect(track(t).clips.map((c) => c.startTime)).toEqual([0, 5, 12, start].sort((a, b) => a - b));
    expect(refCount('s2')).toBe(1);
  });

  it('fails on an unknown track and changes nothing', () => {
    edit.addTrack();
    expectNoChange(() =>
      expect(edit.addClip('nope', 's1', 2, 0)).toEqual({ ok: false, error: MSG.importNoTrack }),
    );
  });

  it('throws on an unknown source before changing anything', () => {
    const t = edit.addTrack();
    expectNoChange(() => expect(() => edit.addClip(t, 'nope', 2, 0)).toThrow());
  });
});

describe('moveClip', () => {
  let t1: TrackId;
  let t2: TrackId;
  let a: string;
  let b: string;

  beforeEach(() => {
    t1 = edit.addTrack();
    t2 = edit.addTrack();
    a = place(t1, 's1', 0, 4);
    b = place(t1, 's1', 6, 4);
    commits = [];
  });

  it('moves within a track, keeps it sorted and commits once', () => {
    expect(edit.moveClip(a, t1, 12)).toEqual({ ok: true, value: undefined });
    expect(track(t1).clips.map((c) => [c.id, c.startTime])).toEqual([
      [b, 6],
      [a, 12],
    ]);
    expect(commits).toEqual([{ kind: 'structure' }]);
  });

  it('may move a clip over its own old position', () => {
    expect(edit.moveClip(a, t1, 1).ok).toBe(true);
    expect(spans(t1)).toEqual([
      [1, 4],
      [6, 4],
    ]);
  });

  it('touching a neighbour is allowed', () => {
    expect(edit.moveClip(a, t1, 2).ok).toBe(true);
    expect(spans(t1)).toEqual([
      [2, 4],
      [6, 4],
    ]);
  });

  it('moves to another track keeping ids, offsets and ref counts', () => {
    place(t2, 's2', 0, 1);
    expect(edit.moveClip(b, t2, 3).ok).toBe(true);
    expect(track(t1).clips.map((c) => c.id)).toEqual([a]);
    expect(track(t2).clips.map((c) => [c.startTime, c.sourceId])).toEqual([
      [0, 's2'],
      [3, 's1'],
    ]);
    expect(track(t2).clips[1].id).toBe(b);
    expect(refCount('s1')).toBe(2);
  });

  it('a start before 0 is moved to 0 (A3 Table 2)', () => {
    expect(edit.moveClip(b, t2, -2).ok).toBe(true);
    expect(spans(t2)).toEqual([[0, 4]]);
  });

  it('rejects an overlap and changes nothing', () => {
    expectNoChange(() =>
      expect(edit.moveClip(a, t1, 3)).toEqual({ ok: false, error: MSG.editOverlap }),
    );
    place(t2, 's2', 0, 5);
    expectNoChange(() =>
      expect(edit.moveClip(a, t2, 4.5)).toEqual({ ok: false, error: MSG.editOverlap }),
    );
  });

  it('fails on an unknown clip or track and changes nothing', () => {
    expectNoChange(() => {
      expect(edit.moveClip('nope', t1, 0)).toEqual({ ok: false, error: MSG.editNoClip });
      expect(edit.moveClip(a, 'nope', 0)).toEqual({ ok: false, error: MSG.importNoTrack });
    });
  });
});

describe('removeClip', () => {
  it('removes the clip, releases its source and commits once', () => {
    const t = edit.addTrack();
    const a = place(t, 's1', 0, 2);
    const b = place(t, 's1', 3, 2);
    commits = [];

    edit.removeClip(a);
    expect(track(t).clips.map((c) => c.id)).toEqual([b]);
    expect(refCount('s1')).toBe(1);
    edit.removeClip(b);
    expect(track(t).clips).toEqual([]);
    expect(registry.get('s1')).toBeUndefined(); // refCount 0 → freed
    expect(commits).toEqual([{ kind: 'structure' }, { kind: 'structure' }]);
  });

  it('an unknown clip does nothing', () => {
    const t = edit.addTrack();
    place(t, 's1', 0, 2);
    expectNoChange(() => edit.removeClip('nope'));
  });
});
