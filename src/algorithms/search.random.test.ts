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

/** A3 §2.2: every search is compared with a linear scan over 1 000 random tracks. Times are
 *  multiples of 1/8 s so boundaries (touching clips, t on an edge) come up often. */

const TRACKS = 1000;
const QUERIES = 20;
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

function randomTrack(rand: () => number): ClipLike[] {
  const count = Math.floor(rand() * 16);
  const out: ClipLike[] = [];
  let t = Math.floor(rand() * 8) / 8;
  for (let i = 0; i < count; i++) {
    const gap = rand() < 0.3 ? 0 : Math.floor(rand() * 16) / 8; // 30 % touching
    const duration = (1 + Math.floor(rand() * 24)) / 8;
    out.push({ startTime: t + gap, duration, sourceOffset: 0, fadeIn: 0, fadeOut: 0 });
    t += gap + duration;
  }
  return out;
}

const end = (c: ClipLike) => c.startTime + c.duration;

function firstWhere(clips: ClipLike[], pred: (c: ClipLike, i: number) => boolean): number {
  const i = clips.findIndex(pred);
  return i < 0 ? clips.length : i;
}

const linear = {
  insertionIndex: (clips: ClipLike[], s: number) => firstWhere(clips, (c) => c.startTime > s),
  lastStartingAtOrBefore: (clips: ClipLike[], t: number) =>
    clips.findLastIndex((c) => c.startTime <= t),
  clipIndexAt: (clips: ClipLike[], t: number) =>
    clips.findIndex((c) => c.startTime <= t && t < end(c)),
  visibleRange(clips: ClipLike[], a: number, b: number): [number, number] {
    const first = firstWhere(clips, (c) => end(c) > a);
    return [
      first,
      Math.max(
        first,
        firstWhere(clips, (c) => c.startTime > b),
      ),
    ];
  },
  neighbours(clips: ClipLike[], s: number, skip: number) {
    return {
      prev: clips.findLastIndex((c, i) => i !== skip && c.startTime <= s),
      next: clips.findIndex((c, i) => i !== skip && c.startTime > s),
    };
  },
  firstFreeStart(clips: ClipLike[], at: number, d: number): number {
    const candidates = [at, ...clips.map(end).filter((e) => e > at)];
    const free = (x: number) => clips.every((c) => c.startTime >= x + d - EPS || end(c) <= x + EPS);
    return candidates.find(free)!;
  },
};

describe('search vs linear scan (random)', () => {
  it(`agrees on ${TRACKS} random tracks`, () => {
    const rand = random(3810);
    for (let n = 0; n < TRACKS; n++) {
      const clips = randomTrack(rand);
      const span = clips.length ? end(clips[clips.length - 1]) : 4;
      const time = () => Math.floor((rand() * (span + 3) - 1) * 8) / 8;
      for (let q = 0; q < QUERIES; q++) {
        const t = time();
        const u = time();
        const skip = Math.floor(rand() * (clips.length + 1)) - 1;
        const d = (1 + Math.floor(rand() * 24)) / 8;
        const ctx = `track ${n}, query ${q}`;
        expect(insertionIndex(clips, t), ctx).toBe(linear.insertionIndex(clips, t));
        expect(lastStartingAtOrBefore(clips, t), ctx).toBe(linear.lastStartingAtOrBefore(clips, t));
        expect(clipIndexAt(clips, t), ctx).toBe(linear.clipIndexAt(clips, t));
        expect(visibleRange(clips, t, u), ctx).toEqual(linear.visibleRange(clips, t, u));
        expect(neighbours(clips, t, skip), ctx).toEqual(linear.neighbours(clips, t, skip));
        expect(firstFreeStart(clips, t, d, EPS), ctx).toBe(linear.firstFreeStart(clips, t, d));
      }
    }
  });
});
