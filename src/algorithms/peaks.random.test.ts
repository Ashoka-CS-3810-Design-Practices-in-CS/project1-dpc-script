import { describe, expect, it } from 'vitest';
import { buildPeaks, chooseLevel, peakColumns } from '@/algorithms/peaks';
import { SAMPLE_RATE } from '@/model/constants';

/** A3 §2.2: the peak pyramid and its columns are compared with brute-force min/max over the
 *  raw samples, for 1 000 random signals. */

const SIGNALS = 1000;

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

/** [min, max] over all channels for samples [from, to). */
function bruteMinMax(channels: Float32Array[], from: number, to: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const ch of channels) {
    for (let i = from; i < to; i++) {
      lo = Math.min(lo, ch[i]);
      hi = Math.max(hi, ch[i]);
    }
  }
  return [lo, hi];
}

describe('peak pyramid vs brute force (random)', () => {
  it(`agrees on ${SIGNALS} random signals`, () => {
    const rand = random(3810);
    const blockSizes = [1, 3, 4, 16, 64];
    for (let n = 0; n < SIGNALS; n++) {
      const length = Math.floor(rand() * 3000);
      const channelCount = 1 + Math.floor(rand() * 2);
      const channels = Array.from({ length: channelCount }, () =>
        Float32Array.from({ length }, () => rand() * 2 - 1),
      );
      const blockSize = blockSizes[Math.floor(rand() * blockSizes.length)];
      const p = buildPeaks(channels, SAMPLE_RATE, blockSize);
      const ctx = `signal ${n} (length ${length}, block ${blockSize})`;

      // Every level equals brute force over its blocks' sample ranges (one expect per level:
      // an expect per block is too slow for 1 000 signals).
      p.levels.forEach((level, k) => {
        const size = blockSize * 2 ** k;
        const expected: number[] = [];
        for (let b = 0; b < Math.ceil(length / size); b++) {
          expected.push(...bruteMinMax(channels, b * size, Math.min(length, (b + 1) * size)));
        }
        expect([...level], `${ctx} level ${k}`).toEqual(expected);
      });
      expect(p.levels.at(-1)!.length, ctx).toBeLessThanOrEqual(2);

      // Columns at several zoom levels.
      for (const spp of [0.5, 1, 3.7, blockSize, 2.5 * blockSize, 100]) {
        const k = chooseLevel(p, spp);
        const size = blockSize * 2 ** k;
        const startSample = rand() * length;
        const firstCol = Math.floor(rand() * 5);
        const count = 20;
        const cols = peakColumns(p, startSample, spp, firstCol, count);
        const expected: number[] = [];
        const outside: string[] = [];
        for (let j = 0; j < count; j++) {
          const from = Math.max(0, startSample + (firstCol + j) * spp);
          const to = Math.min(length, startSample + (firstCol + j + 1) * spp);
          if (to <= from) {
            expected.push(0, 0);
            continue;
          }
          // Exactly the blocks of the chosen level that cover the column…
          expected.push(
            ...bruteMinMax(
              channels,
              Math.floor(from / size) * size,
              Math.min(length, Math.ceil(to / size) * size),
            ),
          );
          // …so the column's own samples always lie inside [min, max].
          const [lo, hi] = bruteMinMax(channels, Math.ceil(from), Math.ceil(to));
          if (lo <= hi && (cols[2 * j] > lo || cols[2 * j + 1] < hi)) outside.push(`col ${j}`);
        }
        expect([...cols], `${ctx} spp ${spp}`).toEqual(expected);
        expect(outside, `${ctx} spp ${spp}`).toEqual([]);
      }
    }
  });
});
