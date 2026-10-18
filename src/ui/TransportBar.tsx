import { useEffect, useState, type JSX } from 'react';
import { PX_PER_SECOND_MAX, PX_PER_SECOND_MIN } from '@/model/constants';
import { formatTime } from '@/ui/format';
import { notify } from '@/ui/feedback';
import { useServices, useTransportState, useView, useViewStore } from '@/ui/servicesContext';

// The zoom slider runs 0..1 and is logarithmic, so each step zooms by the same factor.
const ZOOM_RANGE = Math.log(PX_PER_SECOND_MAX / PX_PER_SECOND_MIN);
const sliderToZoom = (v: number) => PX_PER_SECOND_MIN * Math.exp(v * ZOOM_RANGE);
const zoomToSlider = (px: number) => Math.log(px / PX_PER_SECOND_MIN) / ZOOM_RANGE;

/** Play/Pause, Stop, the clock, zoom and the snap switch. */
export function TransportBar(): JSX.Element {
  const { transport } = useServices();
  const view = useViewStore();
  const { pxPerSecond, snapEnabled } = useView();
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
      <button type="button" className="primary" aria-label={playLabel} onClick={onPlayClick}>
        {playLabel}
      </button>
      <button type="button" aria-label="Stop" onClick={() => transport.stop()}>
        Stop
      </button>
      <output className="clock" aria-live="off" aria-label="Playhead time">
        {clock}
      </output>
      <span className="bar-spacer" />
      <label className="zoom">
        Zoom
        <input
          type="range"
          aria-label="Zoom"
          min={0}
          max={1}
          step={0.001}
          value={zoomToSlider(pxPerSecond)}
          onChange={(e) => view.set({ pxPerSecond: sliderToZoom(Number(e.target.value)) })}
        />
      </label>
      <button
        type="button"
        aria-pressed={snapEnabled}
        onClick={() => view.set({ snapEnabled: !snapEnabled })}
      >
        Snap
      </button>
    </div>
  );
}
