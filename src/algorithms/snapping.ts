import { neighbours } from '@/algorithms/search';
import type { ClipLike } from '@/algorithms/types';

/** A4. Snapping and placement while a clip is dragged. Per pointer move the caller does:
 *  clamp start ≥ 0 → snapStart (threshold = SNAP_DISTANCE_PX / pxPerSecond) → clamp ≥ 0
 *  again → placementValid. */

/** Sorted, de-duplicated snap points (clip edges, playhead, 0). Built once per drag. */
export function collectSnapPoints(times: number[]): Float64Array {
  const sorted = Float64Array.from(times).sort();
  let n = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (n === 0 || sorted[i] !== sorted[n - 1]) sorted[n++] = sorted[i];
  }
  return sorted.slice(0, n);
}

/** The point closest to t (binary search), or null if there are none. Tie → the earlier one. */
export function nearest(points: Float64Array, t: number): number | null {
  if (points.length === 0) return null;
  let lo = 0;
  let hi = points.length; // first index with points[i] ≥ t
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return points[0];
  if (lo === points.length) return points[lo - 1];
  return t - points[lo - 1] <= points[lo] - t ? points[lo - 1] : points[lo];
}

/** Snaps whichever edge (start or end) is closer to a point within `threshold` seconds
 *  (inclusive, + eps); tie → start edge. Returns the new start and the point snapped to. */
export function snapStart(
  points: Float64Array,
  start: number,
  duration: number,
  threshold: number,
  eps: number,
): { start: number; snappedTo: number | null } {
  const end = start + duration;
  const s = nearest(points, start);
  const e = nearest(points, end);
  const ds = s === null ? Infinity : Math.abs(s - start);
  const de = e === null ? Infinity : Math.abs(e - end);
  if (ds <= de && ds <= threshold + eps) return { start: s!, snappedTo: s };
  if (de <= threshold + eps) return { start: e! - duration, snappedTo: e };
  return { start, snappedTo: null };
}

/** True if [start, start + duration) overlaps neither neighbour, ignoring `skipIndex` (the
 *  dragged clip when it stays on its track; −1 otherwise). Touching is valid. */
export function placementValid(
  clips: readonly ClipLike[],
  start: number,
  duration: number,
  skipIndex: number,
  eps: number,
): boolean {
  const { prev, next } = neighbours(clips, start, skipIndex);
  if (prev >= 0 && clips[prev].startTime + clips[prev].duration > start + eps) return false;
  if (next >= 0 && clips[next].startTime < start + duration - eps) return false;
  return true;
}
