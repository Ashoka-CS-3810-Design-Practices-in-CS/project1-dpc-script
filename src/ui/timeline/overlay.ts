import { CLIP_HEADER_PX } from '@/model/constants';
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

/** The fade lengths a fade-handle drag would set (VR-08). */
export interface FadePreview {
  trackIndex: number;
  start: Seconds;
  duration: Seconds;
  fadeIn: Seconds;
  fadeOut: Seconds;
}

/** What a pointer gesture shows on the overlay: a clip outline (move, trim) and/or a fade
 *  envelope. */
export interface Preview {
  drag: DragPreview | null;
  fades: FadePreview | null;
}

export const NO_PREVIEW: Preview = { drag: null, fades: null };

export interface OverlayState extends Preview {
  playhead: Seconds;
}

/** Overlay canvas layer (A3 §3.4): the playhead line and the gesture previews (drag outline,
 *  snap guide, fade envelope). Cheap enough to redraw every animation frame while playing or
 *  dragging. */
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

  const { fades } = state;
  if (fades) {
    // The volume envelope: up from silence over fadeIn, full, down to silence over fadeOut.
    const r = clipRect(
      { startTime: fades.start, duration: fades.duration },
      fades.trackIndex,
      view,
    );
    const top = r.y + CLIP_HEADER_PX;
    const bottom = r.y + r.height;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x, fades.fadeIn > 0 ? bottom : top);
    ctx.lineTo(r.x + fades.fadeIn * view.pxPerSecond, top);
    ctx.lineTo(r.x + r.width - fades.fadeOut * view.pxPerSecond, top);
    ctx.lineTo(r.x + r.width, fades.fadeOut > 0 ? bottom : top);
    ctx.stroke();
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
