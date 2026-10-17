import { describe, expect, it } from 'vitest';
import { buildPeaks, chooseLevel, peakColumns } from '@/algorithms/peaks';
import { PEAK_BLOCK_SIZE, SAMPLE_RATE } from '@/model/constants';

const f32 = (...v: number[]) => Float32Array.from(v);
const arr = (a: Float32Array) => [...a];

// 10 samples, blocks of 4: [1,-2,3,0] [5,-1,0,0] [-4,2]
const SIGNAL = f32(1, -2, 3, 0, 5, -1, 0, 0, -4, 2);

describe('buildPeaks', () => {
  it('builds level 0 per block and merges pairs, carrying an odd last block', () => {
    const p = buildPeaks([SIGNAL], SAMPLE_RATE, 4);
    expect(p).toMatchObject({ sampleRate: SAMPLE_RATE, blockSize: 4, length: 10 });
    expect(p.levels.map(arr)).toEqual([
      [-2, 3, -1, 5, -4, 2],
      [-2, 5, -4, 2],
      [-4, 5],
    ]);
  });

  it('takes min and max over all channels', () => {
    const p = buildPeaks([f32(0, 1, 0, 0), f32(0, 0, -3, 0)], SAMPLE_RATE, 2);
    expect(p.levels.map(arr)).toEqual([
      [0, 1, -3, 0],
      [-3, 1],
    ]);
  });

  it('stops at one block, and handles no audio', () => {
    expect(buildPeaks([f32(1, 2)], SAMPLE_RATE, 4).levels.map(arr)).toEqual([[1, 2]]);
    expect(buildPeaks([], SAMPLE_RATE, 4)).toMatchObject({
      length: 0,
      levels: [new Float32Array()],
    });
  });

  it('uses less than 1.6 % extra memory for 1 000 000 samples (README §7)', () => {
    const n = 1_000_000;
    const p = buildPeaks([new Float32Array(n)], SAMPLE_RATE, PEAK_BLOCK_SIZE);
    const values = p.levels.reduce((sum, level) => sum + level.length, 0);
    expect(values).toBe(15638); // 2·(3907 + 1954 + … + 1) blocks
    expect(values).toBeLessThan(0.016 * n);
  });
});

describe('chooseLevel', () => {
  const p = buildPeaks([SIGNAL], SAMPLE_RATE, 4); // block sizes 4, 8, 16

  it('picks the largest level whose block fits in one pixel', () => {
    expect(chooseLevel(p, 1)).toBe(0);
    expect(chooseLevel(p, 4)).toBe(0);
    expect(chooseLevel(p, 7.9)).toBe(0);
    expect(chooseLevel(p, 8)).toBe(1);
    expect(chooseLevel(p, 16)).toBe(2);
  });

  it('never goes past the top level', () => {
    expect(chooseLevel(p, 1000)).toBe(2);
  });
});

describe('peakColumns', () => {
  const p = buildPeaks([SIGNAL], SAMPLE_RATE, 4);

  it('gives [min, max] per column and [0, 0] past the end', () => {
    expect(arr(peakColumns(p, 0, 4, 0, 4))).toEqual([-2, 3, -1, 5, -4, 2, 0, 0]);
  });

  it('starts from firstCol and startSample', () => {
    expect(arr(peakColumns(p, 0, 4, 1, 2))).toEqual([-1, 5, -4, 2]);
    expect(arr(peakColumns(p, 2, 4, 0, 1))).toEqual([-2, 5]); // samples [2, 6) span two blocks
  });

  it('uses the block containing a column when zoomed in past one block per pixel', () => {
    expect(arr(peakColumns(p, 0, 2, 0, 2))).toEqual([-2, 3, -2, 3]);
  });

  it('combines higher-level blocks when zoomed out', () => {
    expect(arr(peakColumns(p, 0, 16, 0, 1))).toEqual([-4, 5]);
  });

  it('returns zeros before the start of the audio', () => {
    expect(arr(peakColumns(p, -8, 4, 0, 2))).toEqual([0, 0, 0, 0]);
  });
});
