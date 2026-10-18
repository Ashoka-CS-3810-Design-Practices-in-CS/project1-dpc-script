import { useEffect, useRef, type JSX } from 'react';
import { EmptyProject } from '@/ui/EmptyProject';
import { useProject, useServices, useViewStore } from '@/ui/servicesContext';
import { TrackHeaders } from '@/ui/tracks/TrackHeaders';
import { contentHeight } from './geometry';
import { drawOverlay } from './overlay';
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

    const { store, queries, transport } = services;
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

    // The overlay is redrawn on every change, and every frame while playing.
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
          { playhead: transport.position(), drag: null },
          colors,
        );
        if (transport.state() === 'playing') requestOverlay();
      });
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

    return () => {
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

  return (
    <main aria-label="Timeline" className="timeline" ref={rootRef}>
      {hasTracks ? (
        <div className="timeline-scroll">
          <div className="timeline-content" style={{ height }}>
            <TrackHeaders />
            <div className="timeline-canvas-area" ref={areaRef}>
              <canvas ref={baseRef} aria-hidden="true" />
              <canvas ref={overlayRef} aria-hidden="true" />
            </div>
          </div>
        </div>
      ) : (
        <EmptyProject />
      )}
    </main>
  );
}
