import { describe, expect, it } from 'vitest';
import {
  checkFades,
  deleteRange,
  splitAt,
  trimEdge,
  trimToRange,
  type EdgeContext,
} from '@/algorithms/edits';
import type { ClipLike, EditError } from '@/algorithms/types';
import { EPSILON, MIN_CLIP_LENGTH, SAMPLE_RATE } from '@/model/constants';

const O = { minLength: MIN_CLIP_LENGTH, sampleRate: SAMPLE_RATE, eps: EPSILON };
const SAMPLE = 1 / SAMPLE_RATE;

function clip(startTime: number, sourceOffset: number, duration: number): ClipLike {
  return { startTime, sourceOffset, duration, fadeIn: 0, fadeOut: 0 };
}

const isError = (r: unknown): r is EditError => typeof r === 'object' && r !== null && 'error' in r;

describe('A3 Table 1 split points (d = 2)', () => {
  const c = clip(0, 0, 2);

  it('T3 minimum clip length', () => {
    expect(splitAt(c, 0.049, O)).toEqual({ error: 'too-short' });
    expect(splitAt(c, 0.05, O)).toEqual([clip(0, 0, 0.05), clip(0.05, 0.05, 1.95)]);
  });

  it.each([
    [0.049, false],
    [0.05, true],
    [1, true],
    [1.95, true],
    [1.951, false],
  ])('split at %s accepted = %s', (t, accepted) => {
    expect(!isError(splitAt(c, t, O))).toBe(accepted);
  });
});

describe('README §9.5 R2 fade limits', () => {
  it('accepts a + b = d as is', () => {
    expect(checkFades(3, 5, 8, O)).toEqual({ fadeIn: 3, fadeOut: 5 });
    expect(checkFades(0, 0, 8, O)).toEqual({ fadeIn: 0, fadeOut: 0 });
  });

  it('scales a + b = d + 1 sample to fit', () => {
    const r = checkFades(4, 4 + SAMPLE, 8, O);
    expect(isError(r)).toBe(false);
    if (!isError(r)) {
      expect(r.fadeIn + r.fadeOut).toBeCloseTo(8, 12);
      expect(r.fadeIn).toBeLessThan(4);
    }
  });

  it('rejects more than one sample too long (5/5 with d = 8)', () => {
    expect(checkFades(5, 5, 8, O)).toEqual({ error: 'fade-too-long' });
    expect(checkFades(4, 4 + 2 * SAMPLE, 8, O)).toEqual({ error: 'fade-too-long' });
  });

  it.each([
    [-1, 0],
    [0, -1],
    [NaN, 0],
    [0, NaN],
    [Infinity, 0],
    [0, Infinity],
  ])('rejects fades %s / %s as invalid', (a, b) => {
    expect(checkFades(a, b, 8, O)).toEqual({ error: 'fade-invalid' });
  });
});

/** Small seeded generator (mulberry32) so failures can be reproduced. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('A5 position invariant (random, A3 §2.2)', () => {
  const RUNS = 1000;
  const rand = random(3810);
  const between = (a: number, b: number) => a + rand() * (b - a);

  function randomClip(): ClipLike {
    const duration = between(MIN_CLIP_LENGTH, 10);
    return {
      startTime: between(0, 20),
      sourceOffset: between(0, 5),
      duration,
      fadeIn: between(0, duration / 2),
      fadeOut: between(0, duration / 2),
    };
  }

  /** Every timeline time inside each piece plays the same source time as in the original. */
  function expectSameAudio(original: ClipLike, pieces: ClipLike[], ctx: string) {
    for (const p of pieces) {
      expect(p.duration, ctx).toBeGreaterThanOrEqual(MIN_CLIP_LENGTH - EPSILON);
      expect(p.fadeIn + p.fadeOut, ctx).toBeLessThanOrEqual(p.duration + 1e-9);
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const t = p.startTime + f * p.duration;
        const want = t - original.startTime + original.sourceOffset;
        expect(t - p.startTime + p.sourceOffset, ctx).toBeCloseTo(want, 9);
      }
    }
  }

  /** Pieces from trim/split/delete stay inside the original clip. */
  function expectInside(original: ClipLike, pieces: ClipLike[], ctx: string) {
    for (const p of pieces) {
      expect(p.startTime, ctx).toBeGreaterThanOrEqual(original.startTime - EPSILON);
      expect(p.startTime + p.duration, ctx).toBeLessThanOrEqual(
        original.startTime + original.duration + EPSILON,
      );
    }
  }

  it(`holds for ${RUNS} random trims, splits, deletes and edge drags`, () => {
    let accepted = 0;
    for (let n = 0; n < RUNS; n++) {
      const c = randomClip();
      const end = c.startTime + c.duration;
      const [s, e] = [between(c.startTime, end), between(c.startTime, end)].sort((x, y) => x - y);
      const ctx = `run ${n}`;

      const trimmed = trimToRange(c, s, e, O);
      const split = splitAt(c, s, O);
      const deleted = deleteRange(c, s, e, O);
      for (const r of [trimmed, split, deleted]) {
        if (isError(r)) continue;
        const pieces = Array.isArray(r) ? r : [r];
        expectInside(c, pieces, ctx);
        expectSameAudio(c, pieces, ctx);
        accepted += 1;
      }

      const limits: EdgeContext = {
        prevEnd: c.startTime - between(0, 3),
        nextStart: end + between(0, 3),
        sourceDuration: c.sourceOffset + c.duration + between(0, 3),
      };
      for (const edge of ['start', 'end'] as const) {
        const r = trimEdge(c, edge, between(c.startTime - 4, end + 4), limits, O);
        if (isError(r)) continue;
        expectSameAudio(c, [r], `${ctx} ${edge}`);
        expect(r.sourceOffset, ctx).toBeGreaterThanOrEqual(-EPSILON);
        expect(r.sourceOffset + r.duration, ctx).toBeLessThanOrEqual(
          limits.sourceDuration! + EPSILON,
        );
        accepted += 1;
      }
    }
    // Most random edits are valid, so the invariant was really exercised.
    expect(accepted).toBeGreaterThan(RUNS * 2);
  });
});
