import type { Change, ProjectStore, TimelineQueries } from '@/app/contracts';
import { MSG } from '@/app/messages';
import {
  CLIP_HEADER_PX,
  FADE_HANDLE_PX,
  RULER_HEIGHT_PX,
  TRACK_HEIGHT_PX,
} from '@/model/constants';
import type { AudioSource, Clip, Project, SourceId } from '@/model/types';
import { formatTime } from '@/ui/format';
import { trackColors } from '@/ui/trackColors';
import type { ViewState, ViewStore } from '@/ui/viewStore';
import { clipRect, rowTop, timeToX, xToTime, type Rect } from './geometry';

/** The Canvas 2D calls the timeline uses, so tests can pass a recording fake (fakeCanvas.ts). */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'setTransform'
  | 'clearRect'
  | 'fillRect'
  | 'strokeRect'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'rect'
  | 'roundRect'
  | 'clip'
  | 'fill'
  | 'stroke'
  | 'fillText'
  | 'setLineDash'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textBaseline'
  | 'textAlign'
  | 'globalAlpha'
>;

/** Canvas colours, read from the CSS variables in styles.css and timeline.css. */
export interface Palette {
  bg: string;
  panelBg: string;
  fg: string;
  mutedFg: string;
  border: string;
  accent: string;
  selection: string;
  invalid: string;
  rowSelected: string;
  /** The playhead. */
  signal: string;
  /** Clip colours per track, repeating. */
  tracks: string[];
  fadeShade: string;
}

interface RendererDeps {
  queries: TimelineQueries;
  project: () => Project;
  view: () => ViewState;
  colors: Palette;
  /** Called with a clip id before its drawing calls and null after (renderer tests count
   *  the calls per clip). */
  onClip?: (clipId: string | null) => void;
}

/** Clips of tracks that can't be heard are drawn at this opacity. */
const INAUDIBLE_ALPHA = 0.4;
/** Ruler labels are at least this far apart. */
const MIN_LABEL_SPACING_PX = 90;
const RULER_STEPS_S = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
] as const;
const STRIPE_SPACING_PX = 12;
/** Rounded clip corners. */
const CLIP_RADIUS_PX = 6;
const FONT = '12px system-ui, sans-serif';

/** Seconds between ruler labels: the smallest step that keeps labels MIN_LABEL_SPACING_PX
 *  apart at this zoom. */
function rulerStep(pxPerSecond: number): number {
  for (const step of RULER_STEPS_S) if (step * pxPerSecond >= MIN_LABEL_SPACING_PX) return step;
  return RULER_STEPS_S[RULER_STEPS_S.length - 1];
}

/** Base canvas layer (A3 §3.4): ruler, track rows and the visible clips with their waveform,
 *  fades, selection and missing/loading states. Coordinates are CSS pixels; `resize` scales
 *  by devicePixelRatio. */
export class TimelineRenderer {
  private width = 0;
  private height = 0;
  private readonly ctx: Ctx2D;
  private readonly deps: RendererDeps;

  constructor(ctx: Ctx2D, deps: RendererDeps) {
    this.ctx = ctx;
    this.deps = deps;
  }

  /** Call after the canvas element was resized to width·dpr × height·dpr. */
  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Everything, from scratch. */
  drawAll(): void {
    const { ctx } = this;
    const project = this.deps.project();
    const view = this.deps.view();
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawRuler(view);

    const audible = this.deps.queries.audibility();
    const from = view.scrollOffset;
    const to = xToTime(this.width, view);
    project.tracks.forEach((track, i) => {
      this.drawRow(i, track.id === view.selectedTrackId, { x: 0, width: this.width });
      ctx.globalAlpha = audible.get(track.id) === false ? INAUDIBLE_ALPHA : 1;
      for (const clip of this.deps.queries.visibleClips(track.id, from, to)) {
        this.drawClip(clip, i, project, view);
      }
      ctx.globalAlpha = 1;
    });
  }

  /** Only the visible clips that use `sourceId` (its peaks just arrived). */
  drawClipsUsing(sourceId: SourceId): void {
    const { ctx } = this;
    const project = this.deps.project();
    const view = this.deps.view();
    const audible = this.deps.queries.audibility();
    const from = view.scrollOffset;
    const to = xToTime(this.width, view);
    project.tracks.forEach((track, i) => {
      for (const clip of this.deps.queries.visibleClips(track.id, from, to)) {
        if (clip.sourceId !== sourceId) continue;
        const r = clipRect(clip, i, view);
        // Repaint the row behind the clip first, so nothing of the old drawing is left.
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, rowTop(i), r.width, TRACK_HEIGHT_PX);
        ctx.clip();
        ctx.clearRect(r.x, rowTop(i), r.width, TRACK_HEIGHT_PX);
        this.drawRow(i, track.id === view.selectedTrackId, { x: r.x, width: r.width });
        ctx.globalAlpha = audible.get(track.id) === false ? INAUDIBLE_ALPHA : 1;
        this.drawClip(clip, i, project, view);
        ctx.restore();
      }
    });
  }

  private drawRuler(view: ViewState): void {
    const { ctx } = this;
    const { colors } = this.deps;
    ctx.fillStyle = colors.panelBg;
    ctx.fillRect(0, 0, this.width, RULER_HEIGHT_PX);
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT_PX - 0.5);
    ctx.lineTo(this.width, RULER_HEIGHT_PX - 0.5);

    const step = rulerStep(view.pxPerSecond);
    const first = Math.floor(view.scrollOffset / step) * step;
    const last = xToTime(this.width, view);
    ctx.fillStyle = colors.mutedFg;
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let i = 0; first + i * step <= last; i++) {
      const t = first + i * step;
      const x = Math.round(timeToX(t, view)) + 0.5;
      ctx.moveTo(x, RULER_HEIGHT_PX / 2);
      ctx.lineTo(x, RULER_HEIGHT_PX);
      ctx.fillText(formatTime(t), x + 4, RULER_HEIGHT_PX / 2);
    }
    ctx.stroke();
  }

  private drawRow(index: number, selected: boolean, span: { x: number; width: number }): void {
    const { ctx } = this;
    const { colors } = this.deps;
    const top = rowTop(index);
    ctx.globalAlpha = 1;
    ctx.fillStyle = selected ? colors.rowSelected : colors.bg;
    ctx.fillRect(span.x, top, span.width, TRACK_HEIGHT_PX);
    ctx.fillStyle = colors.border;
    ctx.fillRect(span.x, top + TRACK_HEIGHT_PX - 1, span.width, 1);
  }

  private drawClip(clip: Clip, trackIndex: number, project: Project, view: ViewState): void {
    const { ctx } = this;
    const { colors, onClip } = this.deps;
    const r = clipRect(clip, trackIndex, view);
    const source = project.sources.get(clip.sourceId);
    const body: Rect = {
      x: r.x,
      y: r.y + CLIP_HEADER_PX,
      width: r.width,
      height: r.height - CLIP_HEADER_PX,
    };
    onClip?.(clip.id);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.width, r.height, CLIP_RADIUS_PX);
    ctx.clip();

    const tc = trackColors(trackIndex, colors);
    ctx.fillStyle = tc.clipBg;
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.fillStyle = tc.clipHeader;
    ctx.fillRect(r.x, r.y, r.width, CLIP_HEADER_PX);
    this.label(
      source?.fileName ?? '',
      r.x + FADE_HANDLE_PX + 4,
      r.y + CLIP_HEADER_PX / 2,
      r,
      tc.headerText,
    );

    if (!source || source.status === 'missing') this.drawMissing(body, source);
    else this.drawWaveform(clip, r, body, tc.waveform);
    this.drawFades(clip, r, body);

    if (view.selection?.clipId === clip.id) {
      const x0 = timeToX(view.selection.start, view);
      const x1 = timeToX(view.selection.end, view);
      ctx.fillStyle = colors.selection;
      ctx.fillRect(x0, r.y, x1 - x0, r.height);
    }

    // Fade handles at the top corners (README §9.5 R10).
    ctx.fillStyle = colors.fg;
    ctx.fillRect(r.x, r.y, FADE_HANDLE_PX, FADE_HANDLE_PX);
    ctx.fillRect(r.x + r.width - FADE_HANDLE_PX, r.y, FADE_HANDLE_PX, FADE_HANDLE_PX);
    ctx.restore();

    // The border also shows where two touching clips meet (that is how a split shows).
    const selected = view.selectedClipId === clip.id;
    ctx.strokeStyle = selected ? colors.accent : colors.border;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1, CLIP_RADIUS_PX);
    ctx.stroke();
    onClip?.(null);
  }

  private drawWaveform(clip: Clip, r: Rect, body: Rect, color: string): void {
    const { ctx } = this;
    const view = this.deps.view();
    // Only the columns that are on screen; column 0 is the clip's first pixel.
    const firstCol = Math.max(0, Math.floor(-r.x));
    const lastCol = Math.min(Math.ceil(r.width), Math.ceil(this.width - r.x));
    const count = lastCol - firstCol;
    if (count <= 0) return;
    const columns = this.deps.queries.waveformColumns(clip, view.pxPerSecond, firstCol, count);
    if (!columns) {
      this.label(MSG.loadingWaveform, r.x + 6, body.y + body.height / 2, r);
      return;
    }
    const mid = body.y + body.height / 2;
    const half = body.height / 2 - 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 0; j < count; j++) {
      const x = r.x + firstCol + j + 0.5;
      ctx.moveTo(x, mid - columns[2 * j + 1] * half);
      ctx.lineTo(x, mid - columns[2 * j] * half + 0.5);
    }
    ctx.stroke();
  }

  /** Diagonal stripes and "Missing audio — re-import name" (state is not shown by colour alone). */
  private drawMissing(body: Rect, source: AudioSource | undefined): void {
    const { ctx } = this;
    ctx.strokeStyle = this.deps.colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = body.x - body.height; x < body.x + body.width; x += STRIPE_SPACING_PX) {
      ctx.moveTo(x, body.y + body.height);
      ctx.lineTo(x + body.height, body.y);
    }
    ctx.stroke();
    this.label(
      MSG.missingAudioLabel(source?.fileName ?? ''),
      body.x + 6,
      body.y + body.height / 2,
      body,
    );
  }

  /** Shades the part above each fade's volume line (A7). */
  private drawFades(clip: Clip, r: Rect, body: Rect): void {
    const { ctx } = this;
    const { queries, colors } = this.deps;
    const pps = this.deps.view().pxPerSecond;
    const yAt = (t: number) => body.y + body.height * (1 - queries.fadeVolume(clip, t));
    ctx.fillStyle = colors.fadeShade;
    if (clip.fadeIn > 0) {
      const xa = r.x + clip.fadeIn * pps;
      ctx.beginPath();
      ctx.moveTo(r.x, body.y);
      ctx.lineTo(r.x, yAt(0));
      ctx.lineTo(xa, yAt(clip.fadeIn));
      ctx.lineTo(xa, body.y);
      ctx.closePath();
      ctx.fill();
    }
    if (clip.fadeOut > 0) {
      const xb = r.x + (clip.duration - clip.fadeOut) * pps;
      const xe = r.x + r.width;
      ctx.beginPath();
      ctx.moveTo(xb, body.y);
      ctx.lineTo(xb, yAt(clip.duration - clip.fadeOut));
      ctx.lineTo(xe, yAt(clip.duration));
      ctx.lineTo(xe, body.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** One line of text, cut off at the edge of `within`. */
  private label(text: string, x: number, y: number, within: Rect, color?: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(within.x, within.y, within.width, within.height);
    ctx.clip();
    ctx.fillStyle = color ?? this.deps.colors.fg;
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

/** Change kinds that redraw everything; `peaks` redraws only the clips of its source and
 *  `saved` changes nothing on the canvas. */
const DRAW_ALL_KINDS: ReadonlySet<Change['kind']> = new Set<Change['kind']>([
  'structure',
  'mix',
  'meta',
  'sources',
  'project',
]);

interface RedrawOptions {
  renderer: Pick<TimelineRenderer, 'drawAll' | 'drawClipsUsing'>;
  store: ProjectStore;
  view: ViewStore;
  queries: TimelineQueries;
  requestFrame: (callback: () => void) => void;
}

interface Redraws {
  /** Schedule a full redraw on the next frame (e.g. after a resize). */
  requestAll(): void;
  dispose(): void;
}

/** Redraw policy (VR-07): store and view changes schedule at most one drawAll per animation
 *  frame; a `peaks` change only redraws the clips using that source. If the selected clip no
 *  longer exists, its selection is cleared. */
export function attachRedraws({
  renderer,
  store,
  view,
  queries,
  requestFrame,
}: RedrawOptions): Redraws {
  let all = false;
  const sources = new Set<SourceId>();
  let scheduled = false;
  let disposed = false;

  function flush(): void {
    scheduled = false;
    if (disposed) return;
    if (all) renderer.drawAll();
    else for (const id of sources) renderer.drawClipsUsing(id);
    all = false;
    sources.clear();
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    requestFrame(flush);
  }

  function requestAll(): void {
    all = true;
    schedule();
  }

  const offStore = store.subscribe((change) => {
    if (change.kind === 'peaks' && change.sourceId !== undefined) {
      sources.add(change.sourceId);
      schedule();
      return;
    }
    if (!DRAW_ALL_KINDS.has(change.kind)) return;
    const { selectedClipId, selection } = view.get();
    const gone = (id: string | undefined) => id !== undefined && !queries.findClip(id);
    if (gone(selectedClipId ?? undefined) || gone(selection?.clipId)) {
      view.set({ selectedClipId: null, selection: null }); // schedules the redraw below
    }
    requestAll();
  });
  const offView = view.subscribe(requestAll);

  return {
    requestAll,
    dispose() {
      disposed = true;
      offStore();
      offView();
    },
  };
}
