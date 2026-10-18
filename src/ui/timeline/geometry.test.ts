import { describe, expect, it } from 'vitest';
import { RULER_HEIGHT_PX, TRACK_HEIGHT_PX } from '@/model/constants';
import {
  CLIP_INSET_PX,
  clipRect,
  contentHeight,
  rowTop,
  timeToX,
  trackIndexAt,
  xToTime,
} from '@/ui/timeline/geometry';

describe('time ↔ x', () => {
  it('x = (t − scrollOffset) · pxPerSecond', () => {
    expect(timeToX(3, { pxPerSecond: 100, scrollOffset: 0 })).toBe(300);
    expect(timeToX(3, { pxPerSecond: 100, scrollOffset: 1 })).toBe(200);
    expect(timeToX(0, { pxPerSecond: 50, scrollOffset: 2 })).toBe(-100);
  });

  it.each([
    [10, 0],
    [100, 0],
    [100, 12.5],
    [1000, 3.3],
    [37, 0.01],
  ])('round trips at %d px/s, scroll %d', (pxPerSecond, scrollOffset) => {
    const view = { pxPerSecond, scrollOffset };
    for (const t of [0, 0.05, 1, 4.123, 60, 1799.99]) {
      expect(xToTime(timeToX(t, view), view)).toBeCloseTo(t, 9);
    }
    for (const x of [0, 1, 250.5, 1280]) {
      expect(timeToX(xToTime(x, view), view)).toBeCloseTo(x, 9);
    }
  });
});

describe('rows', () => {
  it('rows start below the ruler', () => {
    expect(rowTop(0)).toBe(RULER_HEIGHT_PX);
    expect(rowTop(2)).toBe(RULER_HEIGHT_PX + 2 * TRACK_HEIGHT_PX);
    expect(contentHeight(3)).toBe(RULER_HEIGHT_PX + 3 * TRACK_HEIGHT_PX);
  });

  it('trackIndexAt round trips with rowTop', () => {
    for (let i = 0; i < 4; i++) {
      expect(trackIndexAt(rowTop(i), 4)).toBe(i);
      expect(trackIndexAt(rowTop(i) + TRACK_HEIGHT_PX - 1, 4)).toBe(i);
    }
  });

  it('the ruler and the space below the last row are no track', () => {
    expect(trackIndexAt(0, 4)).toBeNull();
    expect(trackIndexAt(RULER_HEIGHT_PX - 1, 4)).toBeNull();
    expect(trackIndexAt(rowTop(4), 4)).toBeNull();
    expect(trackIndexAt(RULER_HEIGHT_PX, 0)).toBeNull();
  });
});

describe('clipRect', () => {
  it('spans the clip on its row, inset from the row edges', () => {
    expect(
      clipRect({ startTime: 2, duration: 1.5 }, 1, { pxPerSecond: 100, scrollOffset: 1 }),
    ).toEqual({
      x: 100,
      y: rowTop(1) + CLIP_INSET_PX,
      width: 150,
      height: TRACK_HEIGHT_PX - 2 * CLIP_INSET_PX,
    });
  });
});
