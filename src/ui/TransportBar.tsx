import { useEffect, useState, type JSX } from 'react';
import { PX_PER_SECOND_MAX, PX_PER_SECOND_MIN } from '@/model/constants';
import { formatTime } from '@/ui/format';
import { notify } from '@/ui/feedback';
import { Kbd } from '@/ui/shortcutList';
import { ThemeToggle } from '@/ui/ThemeToggle';
import { useServices, useTransportState, useView, useViewStore } from '@/ui/servicesContext';

// The zoom slider runs 0..1 and is logarithmic, so each step zooms by the same factor.
const ZOOM_RANGE = Math.log(PX_PER_SECOND_MAX / PX_PER_SECOND_MIN);
const sliderToZoom = (v: number) => PX_PER_SECOND_MIN * Math.exp(v * ZOOM_RANGE);
const zoomToSlider = (px: number) => Math.log(px / PX_PER_SECOND_MIN) / ZOOM_RANGE;

/** Play/Pause, Stop, the clock and zoom. */
export function TransportBar(): JSX.Element {
  const { transport } = useServices();
  const view = useViewStore();
  const { pxPerSecond } = useView();
  const state = useTransportState();
  const [clock, setClock] = useState(() => formatTime(transport.position()));

  // Redraw the clock every animation frame, straight from the audio clock.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setClock(formatTime(transport.position()));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [transport]);

  // Errors that stop playback on their own (the output went away) arrive as events.
  useEffect(
    () =>
      transport.subscribe((e) => {
        if (e.error) notify.error(e.error);
      }),
    [transport],
  );

  async function onPlayClick(): Promise<void> {
    performance.mark('dpcs:play-click');
    const result = await transport.togglePlay();
    if (!result.ok) notify.error(result.error);
  }

  const playLabel = state === 'playing' ? 'Pause' : 'Play';

  return (
    <div className="bar transport-bar" role="toolbar" aria-label="Transport">
      <button
        type="button"
        className="primary"
        aria-label={playLabel}
        aria-keyshortcuts="Space"
        title={`${playLabel} (Space)`}
        onClick={onPlayClick}
      >
        {playLabel} <Kbd keys="Space" />
      </button>
      <button
        type="button"
        aria-label="Stop"
        aria-keyshortcuts="Escape"
        title="Stop and go back to the start (Esc)"
        onClick={() => transport.stop()}
      >
        Stop <Kbd keys="Esc" />
      </button>
      <output className="clock" aria-live="off" aria-label="Playhead time">
        {clock}
      </output>
      <span className="bar-spacer" />
      <label className="zoom">
        Zoom
        <input
          title="Zoom (+ / −, or Ctrl + mouse wheel)"
          type="range"
          aria-label="Zoom"
          min={0}
          max={1}
          step={0.001}
          value={zoomToSlider(pxPerSecond)}
          onChange={(e) => view.set({ pxPerSecond: sliderToZoom(Number(e.target.value)) })}
        />
      </label>
      <span className="bar-divider" aria-hidden="true" />
      <button
        type="button"
        title="Show every keyboard shortcut (?)"
        onClick={() => view.set({ dialog: 'shortcuts' })}
      >
        Shortcuts <Kbd keys="?" />
      </button>
      <ThemeToggle />
    </div>
  );
}
