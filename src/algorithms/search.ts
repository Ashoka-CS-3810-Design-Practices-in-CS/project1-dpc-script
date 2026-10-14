import type { ClipLike } from '@/algorithms/types';

/** A3. Searches over a track's clips: sorted by startTime and never overlapping, so their
 *  ends are sorted too. Every function is O(log n) except firstFreeStart. */

function end(clip: ClipLike): number {
  return clip.startTime + clip.duration;
}

/** First index in [0, length] where `pred` is true; `pred` must be false…false, true…true. */
function firstIndex(length: number, pred: (i: number) => boolean): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pred(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First index with startTime > start (clips.length if none): where a clip starting at
 *  `start` is inserted. */
export function insertionIndex(clips: readonly ClipLike[], start: number): number {
  return firstIndex(clips.length, (i) => clips[i].startTime > start);
}

/** Index of the last clip with startTime ≤ t, or −1. */
export function lastStartingAtOrBefore(clips: readonly ClipLike[], t: number): number {
  return insertionIndex(clips, t) - 1;
}

/** A2 Alg. 4: index of the clip with t in [start, end), or −1. */
export function clipIndexAt(clips: readonly ClipLike[], t: number): number {
  const i = lastStartingAtOrBefore(clips, t);
  return i >= 0 && t < end(clips[i]) ? i : -1;
}

/** A2 Alg. 5: clips [first, last) are those that may show in the window [a, b]:
 *  first = first clip ending after a, last = first clip starting after b. */
export function visibleRange(clips: readonly ClipLike[], a: number, b: number): [number, number] {
  const first = firstIndex(clips.length, (i) => end(clips[i]) > a);
  const last = insertionIndex(clips, b);
  return [first, Math.max(first, last)];
}

/** The clips just before and after a clip starting at `start` (prev: last startTime ≤ start;
 *  next: first startTime > start), skipping `skipIndex`. −1 when there is none. */
export function neighbours(
  clips: readonly ClipLike[],
  start: number,
  skipIndex: number,
): { prev: number; next: number } {
  const i = insertionIndex(clips, start);
  let prev = i - 1;
  if (prev === skipIndex) prev -= 1;
  let next = i;
  if (next === skipIndex) next += 1;
  return { prev: prev >= 0 ? prev : -1, next: next < clips.length ? next : -1 };
}

/** A1 step 6: earliest start ≥ at where a clip of `duration` fits without overlapping
 *  (touching is allowed). Walks forward from the binary-search position. */
export function firstFreeStart(
  clips: readonly ClipLike[],
  at: number,
  duration: number,
  eps: number,
): number {
  let j = insertionIndex(clips, at);
  let t = j > 0 ? Math.max(at, end(clips[j - 1])) : at;
  while (j < clips.length && clips[j].startTime < t + duration - eps) {
    t = end(clips[j]);
    j += 1;
  }
  return t;
}
