import { describe, expect, it } from 'vitest';
import { collectSnapPoints, nearest, placementValid, snapStart } from '@/algorithms/snapping';
import type { ClipLike } from '@/algorithms/types';
import { EPSILON, SAMPLE_RATE, SNAP_DISTANCE_PX } from '@/model/constants';

const SAMPLE = 1 / SAMPLE_RATE;

function clips(...spans: [start: number, duration: number][]): ClipLike[] {
  return spans.map(([startTime, duration]) => ({
    startTime,
    duration,
    sourceOffset: 0,
    fadeIn: 0,
    fadeOut: 0,
  }));
}

// Track with [0, 4) and [6, 10); zoom 100 px/s → threshold 0.08 s
const TRACK = clips([0, 4], [6, 4]);
const POINTS = collectSnapPoints([0, 0, 4, 6, 10]);
const THRESHOLD = SNAP_DISTANCE_PX / 100;

describe('collectSnapPoints', () => {
  it('sorts and removes duplicates', () => {
    expect([...collectSnapPoints([6, 0, 4, 4, 10, 0])]).toEqual([0, 4, 6, 10]);
    expect([...collectSnapPoints([])]).toEqual([]);
  });
});

describe('nearest', () => {
  const pts = collectSnapPoints([0, 4, 6, 10]);

  it('returns the closest point', () => {
    expect(nearest(pts, -3)).toBe(0);
    expect(nearest(pts, 4.9)).toBe(4);
    expect(nearest(pts, 5.1)).toBe(6);
    expect(nearest(pts, 6)).toBe(6);
    expect(nearest(pts, 99)).toBe(10);
  });

  it('prefers the earlier point on a tie, and is null with no points', () => {
    expect(nearest(pts, 5)).toBe(4);
    expect(nearest(new Float64Array(), 5)).toBeNull();
  });
});

describe('snapStart', () => {
  it('snaps the end edge when it is closer', () => {
    // start 1.95 is 2.05 from 4; end 3.95 is 0.05 from 4
    expect(snapStart(POINTS, 1.95, 2, THRESHOLD, EPSILON)).toEqual({ start: 2, snappedTo: 4 });
  });

  it('snaps the start edge on a tie', () => {
    // start 4.0625 and end 6.0625 are both exactly 1/16 s from a point
    expect(snapStart(POINTS, 4.0625, 2, THRESHOLD, EPSILON)).toEqual({ start: 4, snappedTo: 4 });
  });

  it('leaves the start alone with no point in range or no points at all', () => {
    expect(snapStart(POINTS, 2, 1, THRESHOLD, EPSILON)).toEqual({ start: 2, snappedTo: null });
    expect(snapStart(new Float64Array(), 2, 1, THRESHOLD, EPSILON)).toEqual({
      start: 2,
      snappedTo: null,
    });
  });

  it('snaps to 0 just before the start of the timeline', () => {
    expect(snapStart(POINTS, -0.001, 1, THRESHOLD, EPSILON)).toEqual({ start: 0, snappedTo: 0 });
  });

  it.each([
    [7, true],
    [8, true],
    [9, false],
  ])('A3 Table 1: %s px from a point snaps = %s', (px, snaps) => {
    const pts = collectSnapPoints([4]);
    const r = snapStart(pts, 4 + px / 100, 1, THRESHOLD, EPSILON);
    expect(r.snappedTo !== null).toBe(snaps);
  });
});

describe('placementValid', () => {
  it('T5 snapping and neighbour overlap', () => {
    const snapped = snapStart(POINTS, 4.05, 2, THRESHOLD, EPSILON);
    expect(snapped.start).toBe(4);
    expect(placementValid(TRACK, snapped.start, 2, -1, EPSILON)).toBe(true); // [4, 6) fits exactly
    expect(placementValid(TRACK, 4, 3, -1, EPSILON)).toBe(false); // [4, 7) overlaps [6, 10)
  });

  it('A3 Table 1: drop start 4 − 1 sample is invalid, 4 is valid', () => {
    expect(placementValid(TRACK, 4 - SAMPLE, 1, -1, EPSILON)).toBe(false);
    expect(placementValid(TRACK, 4, 1, -1, EPSILON)).toBe(true);
  });

  it('A3 Table 1: drop end 6 is valid, 6 + 1 sample is invalid', () => {
    expect(placementValid(TRACK, 5, 1, -1, EPSILON)).toBe(true);
    expect(placementValid(TRACK, 5 + SAMPLE, 1, -1, EPSILON)).toBe(false);
  });

  it('ignores the dragged clip itself', () => {
    expect(placementValid(TRACK, 5, 4, 1, EPSILON)).toBe(true);
    expect(placementValid(TRACK, 5, 4, -1, EPSILON)).toBe(false);
  });

  it('accepts anything on an empty track', () => {
    expect(placementValid([], 3, 100, -1, EPSILON)).toBe(true);
  });
});
