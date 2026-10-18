import { useEffect, useRef, useState, type JSX } from 'react';
import { MSG } from '@/app/messages';
import { TRACK_HEIGHT_PX } from '@/model/constants';
import type { Track } from '@/model/types';
import { confirmDialog, notify } from '@/ui/feedback';
import { formatDb } from '@/ui/format';
import { useServices, useViewStore } from '@/ui/servicesContext';

export interface TrackHeaderProps {
  track: Track;
  selected: boolean;
  /** Another track is soloed, so this one can't be heard: the header is greyed out. */
  silencedBySolo: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

/** FR1, FR6: one row's name (inline rename), M, S, volume and delete. Clicking the header
 *  selects the track. */
export function TrackHeader({
  track,
  selected,
  silencedBySolo,
  editing,
  onEditingChange,
}: TrackHeaderProps): JSX.Element {
  const { edit } = useServices();
  const view = useViewStore();
  const db = formatDb(track.volume);

  async function onDelete(): Promise<void> {
    if (await confirmDialog(MSG.confirmDeleteTrack(track.name))) edit.deleteTrack(track.id);
  }

  const classes = ['track-header'];
  if (selected) classes.push('selected');
  if (silencedBySolo) classes.push('silenced');

  return (
    <div
      className={classes.join(' ')}
      style={{ height: TRACK_HEIGHT_PX }}
      role="group"
      aria-label={`Track ${track.name}`}
      onClick={() => view.set({ selectedTrackId: track.id })}
    >
      <div className="track-header-row">
        {editing ? (
          <NameInput
            name={track.name}
            onDone={(name) => {
              onEditingChange(false);
              if (name === null) return; // Esc: keep the old name
              const r = edit.renameTrack(track.id, name);
              if (!r.ok) notify.error(r.error); // the old name stays
            }}
          />
        ) : (
          <button
            type="button"
            className="track-name"
            aria-label={`Track name: ${track.name}. Rename`}
            onClick={() => onEditingChange(true)}
          >
            {track.name}
          </button>
        )}
        <button
          type="button"
          className="track-delete"
          aria-label="Delete track"
          title="Delete track"
          onClick={() => void onDelete()}
        >
          ✕
        </button>
      </div>
      <div className="track-header-row">
        <button
          type="button"
          className="track-toggle track-mute"
          aria-label="Mute"
          aria-pressed={track.muted}
          onClick={() => edit.toggleMute(track.id)}
        >
          M
        </button>
        <button
          type="button"
          className="track-toggle track-solo"
          aria-label="Solo"
          aria-pressed={track.soloed}
          onClick={() => edit.toggleSolo(track.id)}
        >
          S
        </button>
        <input
          type="range"
          className="track-volume"
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          aria-label="Volume"
          aria-valuetext={db}
          onChange={(e) => edit.setVolume(track.id, Number(e.target.value))}
        />
        <span className="track-db" aria-hidden="true">
          {db}
        </span>
      </div>
    </div>
  );
}

/** The name being edited: starts with the whole name selected; Enter keeps it, Esc (or
 *  leaving the field) cancels. */
function NameInput({
  name,
  onDone,
}: {
  name: string;
  onDone: (name: string | null) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function finish(value: string | null): void {
    if (done.current) return; // Enter/Esc unmount the field, which also fires blur
    done.current = true;
    onDone(value);
  }

  return (
    <input
      ref={ref}
      className="track-name-input"
      aria-label="Track name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(draft);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(null)}
    />
  );
}
