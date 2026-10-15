import { describe, expect, it } from 'vitest';
import { collectSnapPoints, nearest, placementValid } from '@/algorithms/snapping';
import type { ClipLike } from '@/algorithms/types';

/** A3 §2.2: nearest (binary search) and placementValid (neighbours only) against linear
 *  scans. Times are multiples of 1/8 s so ties and touching clips come up often. */

const RUNS = 1000;
const EPS = 1e-9;

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

describe('snapping vs linear scan (random)', () => {
  it(`nearest agrees on ${RUNS} random point sets`, () => {
    const rand = random(3810);
    const grid = () => Math.floor(rand() * 160) / 8 - 2;
    for (let n = 0; n < RUNS; n++) {
      const points = collectSnapPoints(Array.from({ length: Math.floor(rand() * 12) }, grid));
      for (let i = 1; i < points.length; i++) expect(points[i]).toBeGreaterThan(points[i - 1]);
      for (let q = 0; q < 10; q++) {
        const t = grid() + rand() / 8;
        let best: number | null = null;
        for (const p of points) {
          if (best === null || Math.abs(p - t) < Math.abs(best - t)) best = p;
        }
        expect(nearest(points, t), `run ${n}`).toBe(best);
      }
    }
  });

  it(`placementValid agrees with checking every clip on ${RUNS} random tracks`, () => {
    const rand = random(4810);
    for (let n = 0; n < RUNS; n++) {
      const clips: ClipLike[] = [];
      let t = 0;
      for (let i = Math.floor(rand() * 12); i > 0; i--) {
        const gap = rand() < 0.3 ? 0 : Math.floor(rand() * 16) / 8;
        const duration = (1 + Math.floor(rand() * 24)) / 8;
        clips.push({ startTime: t + gap, duration, sourceOffset: 0, fadeIn: 0, fadeOut: 0 });
        t += gap + duration;
      }
      for (let q = 0; q < 10; q++) {
        const start = Math.floor(rand() * (t + 2) * 8) / 8;
        const duration = (1 + Math.floor(rand() * 24)) / 8;
        const skip = Math.floor(rand() * (clips.length + 1)) - 1;
        const overlapsAny = clips.some(
          (c, i) =>
            i !== skip &&
            c.startTime < start + duration - EPS &&
            c.startTime + c.duration > start + EPS,
        );
        expect(placementValid(clips, start, duration, skip, EPS), `run ${n}`).toBe(!overlapsAny);
      }
    }
  });
});
