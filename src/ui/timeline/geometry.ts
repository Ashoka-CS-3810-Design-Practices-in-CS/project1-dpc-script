import { RULER_HEIGHT_PX, TRACK_HEIGHT_PX } from '@/model/constants';
import type { Seconds } from '@/model/types';

/** Timeline coordinates. x is measured from the left edge of the canvas area, y from the top
 *  of the ruler; the ruler sits above the first track row. */

/** The part of the view state that positions things horizontally. */
export interface Viewport {
  pxPerSecond: number;
  scrollOffset: Seconds;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gap between a clip and the top and bottom of its row, in pixels. */
export const CLIP_INSET_PX = 2;

/** README A1 Q2: x = (t − scrollOffset) · pxPerSecond. */
export function timeToX(t: Seconds, view: Viewport): number {
  return (t - view.scrollOffset) * view.pxPerSecond;
}

/** Inverse of timeToX. */
export function xToTime(x: number, view: Viewport): Seconds {
  return x / view.pxPerSecond + view.scrollOffset;
}

/** y of the top of track row `index`. */
export function rowTop(index: number): number {
  return RULER_HEIGHT_PX + index * TRACK_HEIGHT_PX;
}

/** Track row under y, or null for the ruler and below the last row. */
export function trackIndexAt(y: number, trackCount: number): number | null {
  if (y < RULER_HEIGHT_PX) return null;
  const index = Math.floor((y - RULER_HEIGHT_PX) / TRACK_HEIGHT_PX);
  return index < trackCount ? index : null;
}

/** Height of the ruler plus every track row. */
export function contentHeight(trackCount: number): number {
  return rowTop(trackCount);
}

/** Where a clip is drawn: its time span on its track's row, inset from the row edges. */
export function clipRect(
  clip: { startTime: Seconds; duration: Seconds },
  trackIndex: number,
  view: Viewport,
): Rect {
  return {
    x: timeToX(clip.startTime, view),
    y: rowTop(trackIndex) + CLIP_INSET_PX,
    width: clip.duration * view.pxPerSecond,
    height: TRACK_HEIGHT_PX - 2 * CLIP_INSET_PX,
  };
}
