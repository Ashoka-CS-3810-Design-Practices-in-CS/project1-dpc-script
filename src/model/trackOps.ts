import { insertionIndex, neighbours } from '@/algorithms/search';
import { EPSILON } from '@/model/constants';
import type { Clip, ClipId, Project, Seconds, Track, TrackId } from '@/model/types';

/** DS1/DS2 operations. Each keeps every track's clips sorted and non-overlapping and throws
 *  if a call would break that; callers validate first and turn failures into messages. */

function end(clip: Clip): Seconds {
  return clip.startTime + clip.duration;
}

/** True if each clip ends at or before the next one starts (touching is allowed). */
function inOrder(clips: readonly Clip[]): boolean {
  for (let i = 1; i < clips.length; i++) {
    if (end(clips[i - 1]) > clips[i].startTime + EPSILON) return false;
  }
  return true;
}

function checkIndex(track: Track, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= track.clips.length) {
    throw new RangeError(`No clip at index ${index} on track ${track.id}.`);
  }
}

export function addTrack(p: Project, track: Track): void {
  if (!inOrder(track.clips)) throw new Error(`Track ${track.id} has overlapping clips.`);
  p.tracks.push(track);
}

export function removeTrack(p: Project, id: TrackId): Track | null {
  const index = p.tracks.findIndex((t) => t.id === id);
  return index < 0 ? null : p.tracks.splice(index, 1)[0];
}

/** A4: true if a clip at [start, start + duration) fits between its neighbours, ignoring the
 *  clip `ignoreClipId` (the one being moved). Only the clip before and after can collide. */
export function canPlace(
  track: Track,
  start: Seconds,
  duration: Seconds,
  ignoreClipId: ClipId | null,
): boolean {
  const clips = track.clips;
  const i = insertionIndex(clips, start);
  const skip = clips[i - 1]?.id === ignoreClipId ? i - 1 : clips[i]?.id === ignoreClipId ? i : -1;
  const { prev, next } = neighbours(clips, start, skip);
  if (prev >= 0 && end(clips[prev]) > start + EPSILON) return false;
  if (next >= 0 && clips[next].startTime < start + duration - EPSILON) return false;
  return true;
}

/** Binary-search insert; returns the clip's index. */
export function insertClip(track: Track, clip: Clip): number {
  if (!canPlace(track, clip.startTime, clip.duration, null)) {
    throw new Error(`Clip ${clip.id} overlaps another clip on track ${track.id}.`);
  }
  const index = insertionIndex(track.clips, clip.startTime);
  track.clips.splice(index, 0, clip);
  return index;
}

export function removeClipAt(track: Track, index: number): Clip {
  checkIndex(track, index);
  return track.clips.splice(index, 1)[0];
}

/** Replaces the clip at `index` with 0, 1 or 2 pieces (edits). The pieces must be in order
 *  and fit between the replaced clip's neighbours. */
export function replaceClipAt(track: Track, index: number, pieces: Clip[]): void {
  checkIndex(track, index);
  const clips = track.clips;
  const around = [...clips.slice(Math.max(0, index - 1), index), ...pieces];
  if (index + 1 < clips.length) around.push(clips[index + 1]);
  if (!inOrder(around)) throw new Error(`Edit pieces overlap on track ${track.id}.`);
  clips.splice(index, 1, ...pieces);
}
