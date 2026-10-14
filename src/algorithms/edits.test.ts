import { describe, expect, it } from 'vitest';
import {
  deleteRange,
  edgeLimits,
  fitFades,
  splitAt,
  trimEdge,
  trimToRange,
  type EdgeContext,
} from '@/algorithms/edits';
import type { ClipLike } from '@/algorithms/types';
import { EPSILON, MIN_CLIP_LENGTH, SAMPLE_RATE } from '@/model/constants';

const O = { minLength: MIN_CLIP_LENGTH, sampleRate: SAMPLE_RATE, eps: EPSILON };

function clip(
  startTime: number,
  sourceOffset: number,
  duration: number,
  fadeIn = 0,
  fadeOut = 0,
): ClipLike {
  return { startTime, sourceOffset, duration, fadeIn, fadeOut };
}

// {start 10, offset 2, length 8} = timeline [10, 18), audio file seconds [2, 10)
const C = clip(10, 2, 8, 1, 1);

describe('fitFades', () => {
  it('returns an unchanged copy when the fades fit', () => {
    const out = fitFades(C);
    expect(out).toEqual(C);
    expect(out).not.toBe(C);
  });

  it('scales both fades proportionally when they do not fit', () => {
    expect(fitFades(clip(0, 0, 4, 3, 1))).toEqual(clip(0, 0, 4, 3, 1));
    expect(fitFades(clip(0, 0, 4, 6, 2))).toEqual(clip(0, 0, 4, 3, 1));
  });
});

describe('trimToRange', () => {
  it('keeps [start, end], moving the source offset with the start', () => {
    expect(trimToRange(C, 12, 16, O)).toEqual(clip(12, 4, 4, 1, 1));
    expect(trimToRange(C, 10, 18, O)).toEqual(C);
  });

  it('shrinks fades that no longer fit', () => {
    expect(trimToRange(clip(10, 2, 8, 4, 4), 12, 16, O)).toEqual(clip(12, 4, 4, 2, 2));
  });

  it('rejects regions outside the clip', () => {
    expect(trimToRange(C, 9, 12, O)).toEqual({ error: 'outside-clip' });
    expect(trimToRange(C, 12, 19, O)).toEqual({ error: 'outside-clip' });
    expect(trimToRange(C, 14, 13, O)).toEqual({ error: 'outside-clip' });
    expect(trimToRange(C, 14, 14, O)).toEqual({ error: 'outside-clip' });
    expect(trimToRange(C, NaN, 14, O)).toEqual({ error: 'outside-clip' });
  });

  it('rejects a result shorter than the minimum length', () => {
    expect(trimToRange(C, 12, 12.04, O)).toEqual({ error: 'too-short' });
  });

  it('never mutates the input', () => {
    const before = { ...C };
    trimToRange(C, 12, 16, O);
    expect(C).toEqual(before);
  });
});

describe('splitAt', () => {
  it('T1 split never copies audio', () => {
    const c = clip(10, 0, 8, 1, 1);
    expect(splitAt(c, 14, O)).toEqual([clip(10, 0, 4, 1, 0), clip(14, 4, 4, 0, 1)]);
    expect(c).toEqual(clip(10, 0, 8, 1, 1));
  });

  it('shrinks the kept fade if a piece is too short for it', () => {
    expect(splitAt(clip(0, 0, 4, 3, 3), 1, O)).toEqual([clip(0, 0, 1, 1, 0), clip(1, 1, 3, 0, 3)]);
  });

  it('rejects a split point outside the clip', () => {
    expect(splitAt(C, 9, O)).toEqual({ error: 'outside-clip' });
    expect(splitAt(C, 19, O)).toEqual({ error: 'outside-clip' });
  });

  it('rejects pieces shorter than the minimum length', () => {
    expect(splitAt(C, 10, O)).toEqual({ error: 'too-short' });
    expect(splitAt(C, 17.99, O)).toEqual({ error: 'too-short' });
  });
});

describe('deleteRange', () => {
  it('deleting the whole clip leaves no pieces', () => {
    expect(deleteRange(C, 10, 18, O)).toEqual([]);
  });

  it('a region touching the start trims it (fades kept)', () => {
    expect(deleteRange(C, 10, 12, O)).toEqual([clip(12, 4, 6, 1, 1)]);
  });

  it('a region touching the end trims it (fades kept)', () => {
    expect(deleteRange(C, 16, 18, O)).toEqual([clip(10, 2, 6, 1, 1)]);
  });

  it('a middle region leaves two pieces with split fade semantics', () => {
    expect(deleteRange(C, 12, 14, O)).toEqual([clip(10, 2, 2, 1, 0), clip(14, 6, 4, 0, 1)]);
  });

  it('rejects a region that would leave a piece too short', () => {
    expect(deleteRange(C, 10.03, 18, O)).toEqual({ error: 'too-short' });
    expect(deleteRange(C, 12, 17.97, O)).toEqual({ error: 'too-short' });
  });

  it('rejects regions outside the clip', () => {
    expect(deleteRange(C, 8, 12, O)).toEqual({ error: 'outside-clip' });
    expect(deleteRange(C, 12, 12, O)).toEqual({ error: 'outside-clip' });
  });
});

describe('edgeLimits', () => {
  it('is bounded by 0, the neighbours and the audio file', () => {
    const limits: EdgeContext = { prevEnd: 5, nextStart: 25, sourceDuration: 30 };
    expect(edgeLimits(C, limits, O)).toEqual({ minStart: 8, maxEnd: 25 }); // audio starts at 8
    expect(edgeLimits(C, { ...limits, prevEnd: 9 }, O).minStart).toBe(9);
    expect(edgeLimits(C, { ...limits, sourceDuration: 12 }, O).maxEnd).toBe(20); // audio ends at 20
    expect(edgeLimits(clip(1, 3, 2), limits, O).minStart).toBe(5);
    expect(edgeLimits(clip(1, 3, 2), { ...limits, prevEnd: 0 }, O).minStart).toBe(0);
  });

  it('does not let the end edge grow when the audio is missing', () => {
    const limits: EdgeContext = { prevEnd: 0, nextStart: 25, sourceDuration: null };
    expect(edgeLimits(C, limits, O).maxEnd).toBe(18);
  });
});

describe('trimEdge', () => {
  const limits: EdgeContext = { prevEnd: 5, nextStart: 25, sourceDuration: 30 };

  it('moves the start edge, keeping the audio in place', () => {
    expect(trimEdge(C, 'start', 12, limits, O)).toEqual(clip(12, 4, 6, 1, 1));
    expect(trimEdge(C, 'start', 8, limits, O)).toEqual(clip(8, 0, 10, 1, 1)); // brings audio back
    expect(trimEdge(C, 'start', 17.95, limits, O)).toMatchObject({ startTime: 17.95 });
  });

  it('rejects start edges outside [minStart, end − minLength]', () => {
    expect(trimEdge(C, 'start', 7.9, limits, O)).toEqual({ error: 'out-of-range' });
    expect(trimEdge(C, 'start', 17.96, limits, O)).toEqual({ error: 'out-of-range' });
  });

  it('moves the end edge', () => {
    expect(trimEdge(C, 'end', 16, limits, O)).toEqual(clip(10, 2, 6, 1, 1));
    expect(trimEdge(C, 'end', 25, limits, O)).toEqual(clip(10, 2, 15, 1, 1));
    expect(trimEdge(C, 'end', 10.05, limits, O)).toMatchObject({ startTime: 10, sourceOffset: 2 });
  });

  it('rejects end edges outside [start + minLength, maxEnd]', () => {
    expect(trimEdge(C, 'end', 10.04, limits, O)).toEqual({ error: 'out-of-range' });
    expect(trimEdge(C, 'end', 25.1, limits, O)).toEqual({ error: 'out-of-range' });
    const missing = { ...limits, sourceDuration: null };
    expect(trimEdge(C, 'end', 18.5, missing, O)).toEqual({ error: 'out-of-range' });
    expect(trimEdge(C, 'end', 17, missing, O)).toEqual(clip(10, 2, 7, 1, 1));
  });
});
