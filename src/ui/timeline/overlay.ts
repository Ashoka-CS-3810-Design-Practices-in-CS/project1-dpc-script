import type { Seconds } from '@/model/types';
import { clipRect, timeToX, type Viewport } from './geometry';
import type { Ctx2D, Palette } from './renderer';

/** What a clip drag looks like right now (filled in by the interactions, VR-08). */
export interface DragPreview {
  trackIndex: number | null; // null = pointer is not over a track row
  start: Seconds;
  duration: Seconds;
  valid: boolean;
  snapLine: Seconds | null;
}

export interface OverlayState {
  playhead: Seconds;
  drag: DragPreview | null;
}

/** Overlay canvas layer (A3 §3.4): the playhead line and the drag preview with its snap
 *  guide. Cheap enough to redraw every animation frame while playing or dragging. */
export function drawOverlay(
  ctx: Ctx2D,
  size: { width: number; height: number },
  view: Viewport,
  state: OverlayState,
  colors: Pick<Palette, 'accent' | 'invalid' | 'fg'>,
): void {
  ctx.clearRect(0, 0, size.width, size.height);

  const { drag } = state;
  if (drag) {
    if (drag.snapLine !== null) {
      const x = Math.round(timeToX(drag.snapLine, view)) + 0.5;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (drag.trackIndex !== null) {
      const r = clipRect({ startTime: drag.start, duration: drag.duration }, drag.trackIndex, view);
      // Red outline when the drop is not allowed; the clip stays where it was until release.
      ctx.strokeStyle = drag.valid ? colors.accent : colors.invalid;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2);
    }
  }

  const x = Math.round(timeToX(state.playhead, view)) + 0.5;
  if (x >= 0 && x <= size.width) {
    ctx.strokeStyle = colors.fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size.height);
    ctx.stroke();
  }
}
