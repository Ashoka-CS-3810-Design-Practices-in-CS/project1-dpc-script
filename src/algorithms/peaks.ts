import type { PeakPyramid } from '@/algorithms/types';

/** A2 Algorithms 2–3, DS4. A min/max summary of the audio at every zoom level, so drawing a
 *  waveform costs O(width) instead of O(samples). Level k has blocks of blockSize·2^k samples,
 *  stored as [min0, max0, min1, max1, …]. */

/** Builds every level, O(N). Level 0 takes min and max over all channels per block (the last
 *  block may be partial); each next level merges neighbouring pairs until one block is left. */
export function buildPeaks(
  channels: Float32Array[],
  sampleRate: number,
  blockSize: number,
): PeakPyramid {
  const length = channels[0]?.length ?? 0;
  const blocks = Math.ceil(length / blockSize);
  const level0 = new Float32Array(2 * blocks);
  for (let b = 0; b < blocks; b++) {
    const from = b * blockSize;
    const to = Math.min(length, from + blockSize);
    let lo = Infinity;
    let hi = -Infinity;
    for (const samples of channels) {
      for (let i = from; i < to; i++) {
        const v = samples[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    level0[2 * b] = lo;
    level0[2 * b + 1] = hi;
  }

  const levels = [level0];
  for (let prev = level0; prev.length > 2; prev = levels[levels.length - 1]) {
    const count = prev.length / 2;
    const next = new Float32Array(2 * Math.ceil(count / 2));
    for (let i = 0; 2 * i < count; i++) {
      const a = 2 * i;
      const b = a + 1;
      if (b < count) {
        next[2 * i] = Math.min(prev[2 * a], prev[2 * b]);
        next[2 * i + 1] = Math.max(prev[2 * a + 1], prev[2 * b + 1]);
      } else {
        next[2 * i] = prev[2 * a]; // odd last block is carried up
        next[2 * i + 1] = prev[2 * a + 1];
      }
    }
    levels.push(next);
  }
  return { sampleRate, blockSize, length, levels };
}

/** Largest k with blockSize·2^k ≤ samplesPerPixel (0 if spp < blockSize), capped at the
 *  top level. */
export function chooseLevel(p: PeakPyramid, samplesPerPixel: number): number {
  let k = 0;
  while (k + 1 < p.levels.length && p.blockSize * 2 ** (k + 1) <= samplesPerPixel) k += 1;
  return k;
}

/** [min, max] per column; column c covers samples [startSample + c·spp, startSample +
 *  (c+1)·spp). Combines every block of the chosen level that overlaps the column. Columns
 *  outside the audio are [0, 0]. */
export function peakColumns(
  p: PeakPyramid,
  startSample: number,
  samplesPerPixel: number,
  firstCol: number,
  count: number,
): Float32Array {
  const out = new Float32Array(2 * count);
  const k = chooseLevel(p, samplesPerPixel);
  const level = p.levels[k];
  const size = p.blockSize * 2 ** k;
  for (let j = 0; j < count; j++) {
    const col = firstCol + j;
    const from = Math.max(0, startSample + col * samplesPerPixel);
    const to = Math.min(p.length, startSample + (col + 1) * samplesPerPixel);
    if (to <= from) continue;
    const last = Math.ceil(to / size);
    let lo = Infinity;
    let hi = -Infinity;
    for (let b = Math.floor(from / size); b < last; b++) {
      lo = Math.min(lo, level[2 * b]);
      hi = Math.max(hi, level[2 * b + 1]);
    }
    out[2 * j] = lo;
    out[2 * j + 1] = hi;
  }
  return out;
}
