import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@/model/projectOps';
import {
  addTrack,
  canPlace,
  insertClip,
  moveTrack,
  removeClipAt,
  removeTrack,
  replaceClipAt,
} from '@/model/trackOps';
import type { Clip, SourceRegistry, Track } from '@/model/types';

function clip(id: string, startTime: number, duration: number): Clip {
  return { id, sourceId: 's', startTime, duration, sourceOffset: 0, fadeIn: 0, fadeOut: 0 };
}

function track(id: string, clips: Clip[] = []): Track {
  return { id, name: id, volume: 1, muted: false, soloed: false, clips };
}

// DS2 example: [0,4), [5,9.5), [12,15)
function ds2(): Track {
  return track('t', [clip('a', 0, 4), clip('b', 5, 4.5), clip('c', 12, 3)]);
}

const ids = (t: Track) => t.clips.map((c) => c.id);

function project(...tracks: Track[]) {
  const p = createEmptyProject('P', {} as SourceRegistry, 'p');
  tracks.forEach((t) => addTrack(p, t));
  return p;
}

describe('tracks', () => {
  it('addTrack appends and rejects overlapping clips', () => {
    const p = project(track('t1'), ds2());
    expect(p.tracks.map((t) => t.id)).toEqual(['t1', 't']);
    expect(() => addTrack(p, track('bad', [clip('x', 0, 2), clip('y', 1, 2)]))).toThrow();
    expect(p.tracks).toHaveLength(2);
  });

  it('accepts touching clips (end == next start)', () => {
    expect(() => project(track('ok', [clip('x', 0, 2), clip('y', 2, 2)]))).not.toThrow();
  });

  it('removeTrack returns the removed track or null', () => {
    const p = project(track('t1'), track('t2'));
    expect(removeTrack(p, 't1')?.id).toBe('t1');
    expect(removeTrack(p, 'nope')).toBeNull();
    expect(p.tracks.map((t) => t.id)).toEqual(['t2']);
  });

  it('moveTrack reorders and rejects bad ids and indexes', () => {
    const p = project(track('t1'), track('t2'), track('t3'));
    moveTrack(p, 't1', 2);
    expect(p.tracks.map((t) => t.id)).toEqual(['t2', 't3', 't1']);
    expect(() => moveTrack(p, 'nope', 0)).toThrow();
    expect(() => moveTrack(p, 't1', 3)).toThrow(RangeError);
    expect(() => moveTrack(p, 't1', -1)).toThrow(RangeError);
    expect(() => moveTrack(p, 't1', 0.5)).toThrow(RangeError);
  });
});

describe('canPlace (A4)', () => {
  it('allows a clip that fits in a gap, touching both sides', () => {
    expect(canPlace(ds2(), 4, 1, null)).toBe(true);
    expect(canPlace(ds2(), 9.5, 2.5, null)).toBe(true);
    expect(canPlace(ds2(), 15, 100, null)).toBe(true);
    expect(canPlace(track('e'), 0, 5, null)).toBe(true);
  });

  it('rejects overlap with the clip before or after', () => {
    expect(canPlace(ds2(), 3, 1, null)).toBe(false); // prev ends at 4
    expect(canPlace(ds2(), 4, 1.5, null)).toBe(false); // next starts at 5
    expect(canPlace(ds2(), 5, 1, null)).toBe(false); // same start as b
  });

  it('ignores the clip being moved', () => {
    expect(canPlace(ds2(), 4.5, 4.5, 'b')).toBe(true); // b was prev-or-next of itself
    expect(canPlace(ds2(), 1, 3, 'a')).toBe(true); // ignored clip is prev
    expect(canPlace(ds2(), 11, 3, 'c')).toBe(true); // ignored clip is next
    expect(canPlace(ds2(), 4.5, 4.5, 'a')).toBe(false); // ignoring a different clip
  });
});

describe('clips', () => {
  it('insertClip keeps the track sorted and returns the index', () => {
    const t = ds2();
    expect(insertClip(t, clip('d', 4, 1))).toBe(1);
    expect(insertClip(t, clip('e', 20, 1))).toBe(4);
    expect(ids(t)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('insertClip throws on overlap and leaves the track unchanged', () => {
    const t = ds2();
    expect(() => insertClip(t, clip('d', 8, 2))).toThrow();
    expect(ids(t)).toEqual(['a', 'b', 'c']);
  });

  it('removeClipAt removes and returns the clip; bad indexes throw', () => {
    const t = ds2();
    expect(removeClipAt(t, 1).id).toBe('b');
    expect(ids(t)).toEqual(['a', 'c']);
    expect(() => removeClipAt(t, 2)).toThrow(RangeError);
    expect(() => removeClipAt(t, -1)).toThrow(RangeError);
  });

  it('replaceClipAt splits into two pieces in place', () => {
    const t = ds2();
    replaceClipAt(t, 1, [clip('b1', 5, 2), clip('b2', 7, 2.5)]);
    expect(ids(t)).toEqual(['a', 'b1', 'b2', 'c']);
  });

  it('replaceClipAt with no pieces deletes; works at both ends', () => {
    const t = ds2();
    replaceClipAt(t, 0, []);
    replaceClipAt(t, 1, [clip('c1', 13, 1)]);
    expect(ids(t)).toEqual(['b', 'c1']);
  });

  it('replaceClipAt rejects pieces that overlap each other or a neighbour', () => {
    const t = ds2();
    expect(() => replaceClipAt(t, 1, [clip('x', 5, 3), clip('y', 6, 1)])).toThrow();
    expect(() => replaceClipAt(t, 1, [clip('x', 3, 2)])).toThrow(); // into a
    expect(() => replaceClipAt(t, 1, [clip('x', 11, 2)])).toThrow(); // into c
    expect(() => replaceClipAt(t, 3, [])).toThrow(RangeError);
    expect(ids(t)).toEqual(['a', 'b', 'c']);
  });
});
