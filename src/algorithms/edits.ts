import type { ClipLike, EditError, EditErrorCode } from '@/algorithms/types';

/** A5. Non-destructive edits: they only compute new clip numbers and never touch audio.
 *  All times are timeline seconds. Every function returns new objects and never mutates. */

/** Passed by the caller (EditService: MIN_CLIP_LENGTH, SAMPLE_RATE, EPSILON). */
export interface EditOpts {
  minLength: number;
  sampleRate: number;
  eps: number;
}

/** Where a clip's edges may go: the neighbouring clips and the length of its audio file
 *  (null = audio missing). */
export interface EdgeContext {
  prevEnd: number;
  nextStart: number;
  sourceDuration: number | null;
}

const fail = (error: EditErrorCode): EditError => ({ error });

function clipEnd(c: ClipLike): number {
  return c.startTime + c.duration;
}

/** Scales fadeIn and fadeOut proportionally when they don't fit (a + b > d). */
export function fitFades(c: ClipLike): ClipLike {
  const total = c.fadeIn + c.fadeOut;
  if (total <= c.duration) return { ...c };
  const k = c.duration / total;
  return { ...c, fadeIn: c.fadeIn * k, fadeOut: c.fadeOut * k };
}

/** The part of `c` covering timeline [start, end]. The audio stays at the same timeline
 *  position: sourceOffset moves by as much as startTime does. */
function piece(c: ClipLike, start: number, end: number, fadeIn: number, fadeOut: number) {
  return fitFades({
    ...c,
    startTime: start,
    sourceOffset: c.sourceOffset + (start - c.startTime),
    duration: end - start,
    fadeIn,
    fadeOut,
  });
}

/** [start, end] clamped to the clip, or null if it is not a region inside the clip. */
function within(c: ClipLike, start: number, end: number, o: EditOpts): [number, number] | null {
  if (!(start >= c.startTime - o.eps && end <= clipEnd(c) + o.eps && end > start + o.eps)) {
    return null;
  }
  return [Math.max(start, c.startTime), Math.min(end, clipEnd(c))];
}

/** Keep only [start, end]. Both fades are kept (shrunk if they no longer fit). */
export function trimToRange(
  c: ClipLike,
  start: number,
  end: number,
  o: EditOpts,
): ClipLike | EditError {
  const region = within(c, start, end, o);
  if (!region) return fail('outside-clip');
  const [s, e] = region;
  if (e - s < o.minLength - o.eps) return fail('too-short');
  return piece(c, s, e, c.fadeIn, c.fadeOut);
}

/** Split at timeline time t. Left keeps fadeIn, right keeps fadeOut (A3 T1). */
export function splitAt(c: ClipLike, t: number, o: EditOpts): [ClipLike, ClipLike] | EditError {
  const u = t - c.startTime;
  if (!(u >= 0 && u <= c.duration)) return fail('outside-clip');
  if (u < o.minLength - o.eps || u > c.duration - o.minLength + o.eps) return fail('too-short');
  return [piece(c, c.startTime, t, c.fadeIn, 0), piece(c, t, clipEnd(c), 0, c.fadeOut)];
}

/** Remove [start, end] from the clip: 0 pieces (whole clip), 1 (region touches an end, like a
 *  trim: fades kept) or 2 (middle: split fade semantics). */
export function deleteRange(
  c: ClipLike,
  start: number,
  end: number,
  o: EditOpts,
): ClipLike[] | EditError {
  const region = within(c, start, end, o);
  if (!region) return fail('outside-clip');
  const [s, e] = region;
  const atStart = s <= c.startTime + o.eps;
  const atEnd = e >= clipEnd(c) - o.eps;
  const pieces: ClipLike[] = [];
  if (!atStart) pieces.push(piece(c, c.startTime, s, c.fadeIn, atEnd ? c.fadeOut : 0));
  if (!atEnd) pieces.push(piece(c, e, clipEnd(c), atStart ? c.fadeIn : 0, c.fadeOut));
  if (pieces.some((p) => p.duration < o.minLength - o.eps)) return fail('too-short');
  return pieces;
}

/** How far each edge may be dragged outward: not before 0, the previous clip or the start of
 *  the audio file; not after the next clip or the end of the audio file. With the audio
 *  missing, the end edge cannot move past the current end. */
export function edgeLimits(
  c: ClipLike,
  limits: EdgeContext,
  o: EditOpts,
): { minStart: number; maxEnd: number } {
  void o; // same options as every other edit, unused here
  const audioStart = c.startTime - c.sourceOffset; // timeline time of the file's first sample
  return {
    minStart: Math.max(0, limits.prevEnd, audioStart),
    maxEnd:
      limits.sourceDuration === null
        ? clipEnd(c)
        : Math.min(limits.nextStart, audioStart + limits.sourceDuration),
  };
}

/** Drag one edge to timeline time t. Moving outward brings back previously trimmed audio. */
export function trimEdge(
  c: ClipLike,
  edge: 'start' | 'end',
  t: number,
  limits: EdgeContext,
  o: EditOpts,
): ClipLike | EditError {
  const { minStart, maxEnd } = edgeLimits(c, limits, o);
  if (edge === 'start') {
    if (!(t >= minStart - o.eps && t <= clipEnd(c) - o.minLength + o.eps)) {
      return fail('out-of-range');
    }
    return piece(c, Math.max(t, minStart), clipEnd(c), c.fadeIn, c.fadeOut);
  }
  if (!(t >= c.startTime + o.minLength - o.eps && t <= maxEnd + o.eps)) {
    return fail('out-of-range');
  }
  return piece(c, c.startTime, Math.min(t, maxEnd), c.fadeIn, c.fadeOut);
}

/** README §9.5 R2: fades a (in) and b (out) for a clip of length d. Up to one sample too long
 *  is scaled to fit; more is rejected. */
export function checkFades(
  a: number,
  b: number,
  d: number,
  o: EditOpts,
): { fadeIn: number; fadeOut: number } | EditError {
  if (!(Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0)) {
    return fail('fade-invalid');
  }
  const total = a + b;
  if (total <= d + o.eps) return { fadeIn: a, fadeOut: b };
  if (total <= d + 1 / o.sampleRate + o.eps) {
    return { fadeIn: (a * d) / total, fadeOut: (b * d) / total };
  }
  return fail('fade-too-long');
}
