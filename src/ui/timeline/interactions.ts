import type { DropPreview, TimelineQueries } from '@/app/contracts';
import {
  CLIP_HEADER_PX,
  EDGE_HANDLE_PX,
  FADE_HANDLE_PX,
  MIN_CLIP_LENGTH,
  RULER_HEIGHT_PX,
} from '@/model/constants';
import type { Clip, ClipId, Seconds, TrackId } from '@/model/types';
import type { ViewState } from '@/ui/viewStore';
import { clipRect, trackIndexAt, xToTime, type Viewport } from './geometry';
import { NO_PREVIEW, type Preview } from './overlay';

/** Pointer interactions on the timeline canvas (VR-08). Pure logic: a gesture turns pointer
 *  positions into previews, view changes, seeks and one final edit, which Timeline.tsx
 *  applies. x and y are relative to the canvas (y = 0 is the top of the ruler). */

/** README §9.5 R10: what a press at a point would do. */
export type Zone =
  | { kind: 'ruler' } // seek
  | { kind: 'row'; trackIndex: number } // empty part of a row: select the track
  | { kind: 'outside' } // below the last row
  | { kind: 'fade'; clip: Clip; trackIndex: number; edge: 'in' | 'out' }
  | { kind: 'trim'; clip: Clip; trackIndex: number; edge: 'start' | 'end' }
  | { kind: 'move'; clip: Clip; trackIndex: number } // the top strip with the file name
  | { kind: 'body'; clip: Clip; trackIndex: number }; // the waveform: region select

export interface HitContext {
  view: Viewport;
  trackIds: readonly TrackId[];
  clipAt: (trackId: TrackId, t: Seconds) => Clip | null;
}

/** Fade squares at the top corners first, then the left/right trim edges, then the top move
 *  strip; the rest of the clip is the waveform body. */
export function hitTest(x: number, y: number, ctx: HitContext): Zone {
  if (y < RULER_HEIGHT_PX) return { kind: 'ruler' };
  const trackIndex = trackIndexAt(y, ctx.trackIds.length);
  if (trackIndex === null) return { kind: 'outside' };
  const clip = ctx.clipAt(ctx.trackIds[trackIndex], xToTime(x, ctx.view));
  if (!clip) return { kind: 'row', trackIndex };
  const r = clipRect(clip, trackIndex, ctx.view);
  if (y < r.y || y >= r.y + r.height) return { kind: 'row', trackIndex }; // gap between clip and row edge

  const fromLeft = x - r.x; // 0 at the clip's first pixel
  const fromRight = r.x + r.width - x; // 1 at the clip's last pixel
  const fromTop = y - r.y;
  if (fromTop < FADE_HANDLE_PX && fromLeft < FADE_HANDLE_PX) {
    return { kind: 'fade', clip, trackIndex, edge: 'in' };
  }
  if (fromTop < FADE_HANDLE_PX && fromRight <= FADE_HANDLE_PX) {
    return { kind: 'fade', clip, trackIndex, edge: 'out' };
  }
  if (fromLeft < EDGE_HANDLE_PX) return { kind: 'trim', clip, trackIndex, edge: 'start' };
  if (fromRight <= EDGE_HANDLE_PX) return { kind: 'trim', clip, trackIndex, edge: 'end' };
  if (fromTop < CLIP_HEADER_PX) return { kind: 'move', clip, trackIndex };
  return { kind: 'body', clip, trackIndex };
}

/** The pointer shape over a zone (while `active`, the gesture's own shape). */
export function cursorFor(zone: Zone, active: boolean): string {
  switch (zone.kind) {
    case 'move':
      return active ? 'grabbing' : 'grab';
    case 'trim':
    case 'fade':
      return 'ew-resize';
    case 'body':
      return 'text';
    case 'ruler':
      return 'pointer';
    default:
      return 'default';
  }
}

/** An edit to make when a gesture ends. */
export type Commit =
  | { kind: 'move'; clipId: ClipId; trackId: TrackId; start: Seconds }
  | { kind: 'fades'; clipId: ClipId; fadeIn: Seconds; fadeOut: Seconds }
  | { kind: 'trim'; clipId: ClipId; edge: 'start' | 'end'; time: Seconds };

/** What one pointer event of a gesture changes. Nothing in the project changes before `end`
 *  (A3 §3.4): the overlay shows the preview instead. */
export interface GestureStep {
  preview: Preview;
  view?: Partial<ViewState>;
  seek?: Seconds;
  commit?: Commit;
}

export interface Gesture {
  readonly zone: Zone;
  /** The step for the pointerdown that started the gesture. */
  readonly down: GestureStep;
  move(x: number, y: number): GestureStep;
  end(x: number, y: number): GestureStep;
  cancel(): GestureStep;
}

export interface GestureDeps {
  queries: TimelineQueries;
  view: () => ViewState;
  trackIds: () => readonly TrackId[];
  playhead: () => Seconds;
}

/** A press closer than this to where it started is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 3;

const NOTHING: GestureStep = { preview: NO_PREVIEW };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Starts the gesture for a pointerdown at (x, y) in `zone`; null if the press does nothing. */
export function beginGesture(
  zone: Zone,
  x0: number,
  y0: number,
  deps: GestureDeps,
): Gesture | null {
  if (zone.kind === 'outside') return null;
  let dragged = false;
  const moved = (x: number, y: number) =>
    (dragged ||= Math.abs(x - x0) >= DRAG_THRESHOLD_PX || Math.abs(y - y0) >= DRAG_THRESHOLD_PX);
  const timeAt = (x: number) => xToTime(x, deps.view());

  if (zone.kind === 'ruler') {
    const seek = (x: number): GestureStep => ({
      preview: NO_PREVIEW,
      seek: Math.max(0, timeAt(x)),
    });
    return { zone, down: seek(x0), move: seek, end: seek, cancel: () => NOTHING };
  }

  if (zone.kind === 'row') {
    const trackId = deps.trackIds()[zone.trackIndex];
    const down = {
      preview: NO_PREVIEW,
      view: { selectedTrackId: trackId, selectedClipId: null, selection: null },
    };
    return { zone, down, move: () => NOTHING, end: () => NOTHING, cancel: () => NOTHING };
  }

  const { clip, trackIndex } = zone;
  const clipEnd = clip.startTime + clip.duration;
  const current = deps.view().selection;
  // Pressing a clip selects it (and its track); a region of another clip is dropped.
  const select: Partial<ViewState> = {
    selectedClipId: clip.id,
    selectedTrackId: deps.trackIds()[trackIndex],
    ...(current?.clipId === clip.id ? {} : { selection: null }),
  };

  if (zone.kind === 'body') {
    const anchor = clamp(timeAt(x0), clip.startTime, clipEnd);
    const step = (x: number, y: number): GestureStep => {
      if (!moved(x, y)) return NOTHING;
      const t = clamp(timeAt(x), clip.startTime, clipEnd);
      const [start, end] = t < anchor ? [t, anchor] : [anchor, t];
      return {
        preview: NO_PREVIEW,
        view: { selection: end > start ? { clipId: clip.id, start, end } : null },
      };
    };
    // A click without dragging selects the clip and clears the region.
    const down = { preview: NO_PREVIEW, view: { ...select, selection: null } };
    return { zone, down, move: step, end: step, cancel: () => NOTHING };
  }

  if (zone.kind === 'move') {
    const grab = timeAt(x0) - clip.startTime;
    const session = deps.queries.beginDrag(clip.id, deps.playhead());
    let last: DropPreview | null = null;
    const move = (x: number, y: number): GestureStep => {
      if (!moved(x, y)) return NOTHING;
      const view = deps.view();
      const ids = deps.trackIds();
      const index = trackIndexAt(y, ids.length);
      const drop = session.update(
        timeAt(x) - grab,
        index === null ? null : ids[index],
        view.pxPerSecond,
        view.snapEnabled,
      );
      last = drop;
      return {
        preview: {
          drag: {
            trackIndex: index,
            start: drop.start,
            duration: clip.duration,
            valid: drop.valid,
            snapLine: drop.snapLine,
          },
          fades: null,
        },
      };
    };
    return {
      zone,
      down: { preview: NO_PREVIEW, view: select },
      move,
      end(x, y) {
        move(x, y);
        // An invalid drop does nothing: the clip stays where it was.
        if (!dragged || !last?.valid || last.trackId === null) return NOTHING;
        return {
          preview: NO_PREVIEW,
          commit: { kind: 'move', clipId: clip.id, trackId: last.trackId, start: last.start },
        };
      },
      cancel: () => NOTHING,
    };
  }

  if (zone.kind === 'fade') {
    let { fadeIn, fadeOut } = clip;
    // Clamped while dragging so the two fades can never add up to more than the clip.
    const move = (x: number, y: number): GestureStep => {
      if (!moved(x, y)) return NOTHING;
      const t = timeAt(x);
      if (zone.edge === 'in') fadeIn = clamp(t - clip.startTime, 0, clip.duration - fadeOut);
      else fadeOut = clamp(clipEnd - t, 0, clip.duration - fadeIn);
      return {
        preview: {
          drag: null,
          fades: { trackIndex, start: clip.startTime, duration: clip.duration, fadeIn, fadeOut },
        },
      };
    };
    return {
      zone,
      down: { preview: NO_PREVIEW, view: select },
      move,
      end(x, y) {
        move(x, y);
        if (!dragged) return NOTHING;
        return { preview: NO_PREVIEW, commit: { kind: 'fades', clipId: clip.id, fadeIn, fadeOut } };
      },
      cancel: () => NOTHING,
    };
  }

  // zone.kind === 'trim'
  const limits = deps.queries.edgeLimits(clip.id);
  let time = zone.edge === 'start' ? clip.startTime : clipEnd;
  const move = (x: number, y: number): GestureStep => {
    if (!moved(x, y)) return NOTHING;
    const t = timeAt(x);
    time =
      zone.edge === 'start'
        ? clamp(t, limits.minStart, clipEnd - MIN_CLIP_LENGTH)
        : clamp(t, clip.startTime + MIN_CLIP_LENGTH, limits.maxEnd);
    const [start, end] = zone.edge === 'start' ? [time, clipEnd] : [clip.startTime, time];
    return {
      preview: {
        drag: { trackIndex, start, duration: end - start, valid: true, snapLine: null },
        fades: null,
      },
    };
  };
  return {
    zone,
    down: { preview: NO_PREVIEW, view: select },
    move,
    end(x, y) {
      move(x, y);
      if (!dragged) return NOTHING;
      return {
        preview: NO_PREVIEW,
        commit: { kind: 'trim', clipId: clip.id, edge: zone.edge, time },
      };
    },
    cancel: () => NOTHING,
  };
}
