import { useEffect, useState, type JSX, type KeyboardEvent } from 'react';
import { NUDGE_S, NUDGE_SHIFT_S, RULER_HEIGHT_PX } from '@/model/constants';
import type { Clip, Track } from '@/model/types';
import { formatTime } from '@/ui/format';
import { useProject, useServices, useViewStore } from '@/ui/servicesContext';

/** README §9.5 R13: keyboard paths for what the canvas does with the mouse. */

/** "Clip voice.wav on Narration, starts 00:03.000, 42.500 s". */
export function clipLabel(clip: Clip, track: Track, fileName: string): string {
  return `Clip ${fileName} on ${track.name}, starts ${formatTime(clip.startTime)}, ${clip.duration.toFixed(3)} s`;
}

/** One visually-hidden focusable button per clip, in timeline order; Enter selects the clip. */
export function ClipButtons(): JSX.Element {
  const project = useProject();
  const view = useViewStore();
  const clips = project.tracks
    .flatMap((track, trackIndex) => track.clips.map((clip) => ({ clip, track, trackIndex })))
    .sort((a, b) => a.clip.startTime - b.clip.startTime || a.trackIndex - b.trackIndex);

  return (
    <ul className="visually-hidden" aria-label="Clips">
      {clips.map(({ clip, track }) => (
        <li key={clip.id}>
          <button
            type="button"
            onClick={() => {
              const { selection } = view.get();
              view.set({
                selectedClipId: clip.id,
                selectedTrackId: track.id,
                selection: selection?.clipId === clip.id ? selection : null,
              });
            }}
          >
            {clipLabel(clip, track, project.sources.get(clip.sourceId)?.fileName ?? '')}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The time ruler as a focusable slider: ←/→ move the playhead by NUDGE_S (Shift:
 *  NUDGE_SHIFT_S). It lies over the canvas ruler without taking its pointer events, so the
 *  focus outline shows on the ruler. */
export function RulerSlider(): JSX.Element {
  const { transport, queries } = useServices();
  const [position, setPosition] = useState(() => transport.position());
  const end = queries.projectEnd();

  // Stopping, seeking elsewhere and playback ending move the playhead too.
  useEffect(() => transport.subscribe(() => setPosition(transport.position())), [transport]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (e.shiftKey ? NUDGE_SHIFT_S : NUDGE_S) * (e.key === 'ArrowLeft' ? -1 : 1);
    transport.seek(transport.position() + step); // clamped to [0, project end]
    setPosition(transport.position());
  }

  return (
    <div
      className="ruler-slider"
      style={{ height: RULER_HEIGHT_PX }}
      role="slider"
      tabIndex={0}
      aria-label="Playhead position"
      aria-valuemin={0}
      aria-valuemax={end}
      aria-valuenow={position}
      aria-valuetext={formatTime(position)}
      onKeyDown={onKeyDown}
      onFocus={() => setPosition(transport.position())}
    />
  );
}
