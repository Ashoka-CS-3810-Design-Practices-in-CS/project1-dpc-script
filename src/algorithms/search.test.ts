import { describe, expect, it } from 'vitest';
import {
  clipIndexAt,
  firstFreeStart,
  insertionIndex,
  lastStartingAtOrBefore,
  neighbours,
  visibleRange,
} from '@/algorithms/search';
import type { ClipLike } from '@/algorithms/types';

const EPS = 1e-9;

function clips(...spans: [start: number, duration: number][]): ClipLike[] {
  return spans.map(([startTime, duration]) => ({
    startTime,
    duration,
    sourceOffset: 0,
    fadeIn: 0,
    fadeOut: 0,
  }));
}

// DS2 example: [0,4), [5,9.5), [12,15)
const DS2 = clips([0, 4], [5, 4.5], [12, 3]);

describe('lastStartingAtOrBefore / insertionIndex', () => {
  it('finds the last clip starting at or before t', () => {
    expect(lastStartingAtOrBefore(DS2, -1)).toBe(-1);
    expect(lastStartingAtOrBefore(DS2, 0)).toBe(0);
    expect(lastStartingAtOrBefore(DS2, 4.9)).toBe(0);
    expect(lastStartingAtOrBefore(DS2, 5)).toBe(1);
    expect(lastStartingAtOrBefore(DS2, 100)).toBe(2);
    expect(lastStartingAtOrBefore([], 3)).toBe(-1);
  });

  it('inserts after clips with an equal start', () => {
    expect(insertionIndex(DS2, -1)).toBe(0);
    expect(insertionIndex(DS2, 5)).toBe(2);
    expect(insertionIndex(DS2, 13)).toBe(3);
    expect(insertionIndex([], 0)).toBe(0);
  });
});

describe('clipIndexAt (A2 Alg. 4)', () => {
  it('uses half-open intervals [start, end)', () => {
    expect(clipIndexAt(DS2, 0)).toBe(0);
    expect(clipIndexAt(DS2, 3.99)).toBe(0);
    expect(clipIndexAt(DS2, 4)).toBe(-1); // gap
    expect(clipIndexAt(DS2, 9.5)).toBe(-1); // end is excluded
    expect(clipIndexAt(DS2, 14.9)).toBe(2);
    expect(clipIndexAt(DS2, 15)).toBe(-1);
    expect(clipIndexAt(DS2, -0.5)).toBe(-1);
  });

  it('returns the later clip where two clips touch', () => {
    const touching = clips([0, 2], [2, 2]);
    expect(clipIndexAt(touching, 2)).toBe(1);
  });
});

describe('visibleRange (A2 Alg. 5)', () => {
  it('returns [first ending after a, first starting after b)', () => {
    expect(visibleRange(DS2, 0, 100)).toEqual([0, 3]);
    expect(visibleRange(DS2, 4.5, 11)).toEqual([1, 2]);
    expect(visibleRange(DS2, 4, 5)).toEqual([1, 2]); // [0,4) ends at a: not visible
    expect(visibleRange(DS2, 15, 20)).toEqual([3, 3]);
    expect(visibleRange(DS2, -5, -1)).toEqual([0, 0]);
    expect(visibleRange([], 0, 10)).toEqual([0, 0]);
  });

  it('is empty, never reversed, when a > b', () => {
    expect(visibleRange(DS2, 10, 2)).toEqual([2, 2]);
  });
});

describe('neighbours', () => {
  it('returns the clips before and after a start time', () => {
    expect(neighbours(DS2, 4.5, -1)).toEqual({ prev: 0, next: 1 });
    expect(neighbours(DS2, 5, -1)).toEqual({ prev: 1, next: 2 });
    expect(neighbours(DS2, -1, -1)).toEqual({ prev: -1, next: 0 });
    expect(neighbours(DS2, 20, -1)).toEqual({ prev: 2, next: -1 });
    expect(neighbours([], 1, -1)).toEqual({ prev: -1, next: -1 });
  });

  it('skips the given index', () => {
    expect(neighbours(DS2, 5, 1)).toEqual({ prev: 0, next: 2 });
    expect(neighbours(DS2, 4.5, 1)).toEqual({ prev: 0, next: 2 });
    expect(neighbours(DS2, 1, 0)).toEqual({ prev: -1, next: 1 });
    expect(neighbours(DS2, 13, 2)).toEqual({ prev: 1, next: -1 });
    expect(neighbours(DS2, 10, 2)).toEqual({ prev: 1, next: -1 });
  });
});

describe('firstFreeStart (A1 step 6)', () => {
  it('returns `at` when it is free', () => {
    expect(firstFreeStart([], 3, 10, EPS)).toBe(3);
    expect(firstFreeStart(DS2, 16, 5, EPS)).toBe(16);
    expect(firstFreeStart(DS2, 9.5, 2.5, EPS)).toBe(9.5); // fits exactly, touching both
  });

  it('moves past clips until the gap is long enough', () => {
    expect(firstFreeStart(DS2, 0, 1, EPS)).toBe(4); // [4,5) fits 1 s exactly
    expect(firstFreeStart(DS2, 0, 2, EPS)).toBe(9.5);
    expect(firstFreeStart(DS2, 0, 3, EPS)).toBe(15);
    expect(firstFreeStart(DS2, 3, 1, EPS)).toBe(4);
    expect(firstFreeStart(DS2, 10, 2.5, EPS)).toBe(15);
  });

  it('starts before the first clip when it fits', () => {
    const later = clips([5, 1]);
    expect(firstFreeStart(later, 0, 5, EPS)).toBe(0);
    expect(firstFreeStart(later, 0, 5.5, EPS)).toBe(6);
  });
});
