import { useEffect, useRef, type DragEvent, type JSX } from 'react';
import { MSG } from '@/app/messages';
import { EmptyProject } from '@/ui/EmptyProject';
import { notify } from '@/ui/feedback';
import { formatDuration } from '@/ui/format';
import { useProject, useServices, useViewStore } from '@/ui/servicesContext';
import { report } from '@/ui/shortcuts';
import { TrackHeaders } from '@/ui/tracks/TrackHeaders';
import { ClipButtons, RulerSlider } from './accessible';
import { contentHeight, trackIndexAt } from './geometry';
import {
  beginGesture,
  cursorFor,
  hitTest,
  type Commit,
  type Gesture,
  type GestureStep,
} from './interactions';
import { drawOverlay, NO_PREVIEW, type Preview } from './overlay';
import { attachRedraws, TimelineRenderer, type Palette } from './renderer';
import './timeline.css';

/** Pixels per wheel "line" when the browser reports line deltas (Firefox mouse wheels). */
const WHEEL_LINE_PX = 16;

/** Canvas colours from the CSS variables (styles.css, timeline.css). */
function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: v('--bg'),
    panelBg: v('--panel-bg'),
    fg: v('--fg'),
    mutedFg: v('--muted-fg'),
    border: v('--border'),
    accent: v('--accent'),
    selection: v('--selection'),
    invalid: v('--invalid'),
    rowSelected: v('--tl-row-selected'),
    clipBg: v('--tl-clip-bg'),
    clipHeader: v('--tl-clip-header'),
    waveform: v('--tl-waveform'),
    fadeShade: v('--tl-fade-shade'),
  };
}

/** Track headers + the two stacked timeline canvases (A3 §3.4), or the empty-project prompt
 *  when there are no tracks. Vertical scrolling is native (headers and canvas move together);
 *  horizontal scrolling changes view.scrollOffset. */
export function Timeline(): JSX.Element {
  const services = useServices();
  const view = useViewStore();
  const project = useProject();
  const trackCount = project.tracks.length;
  const hasTracks = trackCount > 0;
  const height = contentHeight(trackCount);

  const rootRef = useRef<HTMLElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const resizeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const area = areaRef.current;
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (!root || !area || !base || !overlay) return; // no tracks: nothing to draw
    const baseCtx = base.getContext('2d');
    const overlayCtx = overlay.getContext('2d');
    if (!baseCtx || !overlayCtx) return;

    const { store, queries, transport, edit } = services;
    const colors = readPalette(root);
    const renderer = new TimelineRenderer(baseCtx, {
      queries,
      project: () => store.get(),
      view: () => view.get(),
      colors,
    });
    const redraws = attachRedraws({
      renderer,
      store,
      view,
      queries,
      requestFrame: (f) => void requestAnimationFrame(f),
    });

    let size = { width: 0, height: 0 };
    let disposed = false;
    let overlayPending = false;
    let preview: Preview = NO_PREVIEW;

    // The overlay is redrawn on every change and pointer move, and every frame while playing.
    function requestOverlay(): void {
      if (overlayPending || disposed) return;
      overlayPending = true;
      requestAnimationFrame(() => {
        overlayPending = false;
        if (disposed) return;
        drawOverlay(
          overlayCtx!,
          size,
          view.get(),
          { playhead: transport.position(), ...preview },
          colors,
        );
        if (transport.state() === 'playing') requestOverlay();
      });
    }

    // Seeking while dragging on the ruler happens at most once per animation frame.
    let pendingSeek: number | null = null;
    function requestSeek(t: number): void {
      if (pendingSeek === null) {
        requestAnimationFrame(() => {
          if (!disposed && pendingSeek !== null) transport.seek(pendingSeek);
          pendingSeek = null;
        });
      }
      pendingSeek = t;
    }

    function commit(c: Commit): void {
      if (c.kind === 'move') report(edit.moveClip(c.clipId, c.trackId, c.start));
      else if (c.kind === 'fades') report(edit.setFades(c.clipId, c.fadeIn, c.fadeOut));
      else report(edit.trimEdge(c.clipId, c.edge, c.time));
    }

    function apply(step: GestureStep): void {
      preview = step.preview;
      if (step.view) view.set(step.view);
      if (step.seek !== undefined) requestSeek(step.seek);
      if (step.commit) commit(step.commit);
      requestOverlay();
    }

    // Both canvases cover the visible width and every row, scaled for sharp high-DPI drawing.
    function resize(): void {
      const dpr = window.devicePixelRatio || 1;
      size = { width: area!.clientWidth, height: contentHeight(store.get().tracks.length) };
      for (const canvas of [base!, overlay!]) {
        canvas.width = Math.round(size.width * dpr);
        canvas.height = Math.round(size.height * dpr);
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
      }
      renderer.resize(size.width, size.height, dpr);
      overlayCtx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraws.requestAll();
      requestOverlay();
    }
    resizeRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(area);
    resize();

    const offStore = store.subscribe(requestOverlay);
    const offView = view.subscribe(requestOverlay);
    const offTransport = transport.subscribe(requestOverlay);

    // Shift + wheel, or a horizontal trackpad swipe, scrolls the timeline sideways.
    function onWheel(e: WheelEvent): void {
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horizontal) return;
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1;
      const delta = (e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX) * unit;
      if (delta === 0) return;
      e.preventDefault();
      const { scrollOffset, pxPerSecond } = view.get();
      view.set({ scrollOffset: scrollOffset + delta / pxPerSecond });
    }
    area.addEventListener('wheel', onWheel, { passive: false });

    // Pointer gestures (README §9.5 R10) on the top canvas, with pointer capture so a drag
    // keeps going outside the canvas.
    const gestureDeps = {
      queries,
      view: () => view.get(),
      trackIds: () => store.get().tracks.map((t) => t.id),
      playhead: () => transport.position(),
    };
    let gesture: Gesture | null = null;

    function pointAt(e: PointerEvent): [number, number] {
      const r = overlay!.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    function zoneAt(x: number, y: number) {
      const trackIds = gestureDeps.trackIds();
      return hitTest(x, y, { view: view.get(), trackIds, clipAt: queries.clipAt });
    }

    function onPointerDown(e: PointerEvent): void {
      if (e.button !== 0 || gesture) return;
      const [x, y] = pointAt(e);
      gesture = beginGesture(zoneAt(x, y), x, y, gestureDeps);
      if (!gesture) return;
      overlay!.setPointerCapture(e.pointerId);
      overlay!.style.cursor = cursorFor(gesture.zone, true);
      apply(gesture.down);
    }

    function onPointerMove(e: PointerEvent): void {
      const [x, y] = pointAt(e);
      if (gesture) apply(gesture.move(x, y));
      else overlay!.style.cursor = cursorFor(zoneAt(x, y), false);
    }

    function onPointerUp(e: PointerEvent): void {
      if (!gesture) return;
      const [x, y] = pointAt(e);
      const g = gesture;
      gesture = null;
      if (overlay!.hasPointerCapture(e.pointerId)) overlay!.releasePointerCapture(e.pointerId);
      apply(g.end(x, y));
      overlay!.style.cursor = cursorFor(zoneAt(x, y), false);
    }

    function onPointerCancel(): void {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      apply(g.cancel());
    }

    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerup', onPointerUp);
    overlay.addEventListener('pointercancel', onPointerCancel);

    return () => {
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
      overlay.removeEventListener('pointercancel', onPointerCancel);
      disposed = true;
      resizeRef.current = null;
      observer.disconnect();
      redraws.dispose();
      offStore();
      offView();
      offTransport();
      area.removeEventListener('wheel', onWheel);
    };
  }, [services, view, hasTracks]);

  // Adding or removing a track changes the canvas height.
  useEffect(() => {
    resizeRef.current?.();
  }, [height]);

  function onDragOver(e: DragEvent<HTMLElement>): void {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); // allows the drop
    e.dataTransfer.dropEffect = 'copy';
  }

  // Dropped files go on the track under the pointer (else the selected track), at the
  // playhead. One at a time, so each finds the next free position.
  async function onDrop(e: DragEvent<HTMLElement>): Promise<void> {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    const area = areaRef.current;
    const { tracks } = services.store.get();
    const index = area
      ? trackIndexAt(e.clientY - area.getBoundingClientRect().top, tracks.length)
      : null;
    const trackId = index === null ? view.get().selectedTrackId : tracks[index].id;
    for (const file of files) {
      const r = await services.importer.importFile(file, trackId, services.transport.position());
      report(r);
      if (r.ok) notify.success(MSG.imported(r.value.fileName, formatDuration(r.value.duration)));
    }
  }

  return (
    <main
      aria-label="Timeline"
      className="timeline"
      ref={rootRef}
      onDragOver={onDragOver}
      onDrop={(e) => void onDrop(e)}
    >
      {hasTracks ? (
        <div className="timeline-scroll">
          <div className="timeline-content" style={{ height }}>
            <TrackHeaders />
            <div className="timeline-canvas-area" ref={areaRef}>
              <canvas ref={baseRef} aria-hidden="true" />
              <canvas ref={overlayRef} aria-hidden="true" />
              <RulerSlider />
            </div>
          </div>
          <ClipButtons />
        </div>
      ) : (
        <EmptyProject />
      )}
    </main>
  );
}
