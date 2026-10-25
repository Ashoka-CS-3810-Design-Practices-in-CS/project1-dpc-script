import { useState, type JSX } from 'react';
import { RULER_HEIGHT_PX, TRACK_HEADER_WIDTH_PX } from '@/model/constants';
import type { TrackId } from '@/model/types';
import { useProject, useServices, useView, useViewStore } from '@/ui/servicesContext';
import { Kbd } from '@/ui/shortcutList';
import { TrackHeader } from './TrackHeader';
import './tracks.css';

/** One header per track row, lined up with the canvas rows, and "+ Add track" below them. */
export function TrackHeaders(): JSX.Element {
  const { edit, queries } = useServices();
  const viewStore = useViewStore();
  const { selectedTrackId } = useView();
  const project = useProject();
  const [editingId, setEditingId] = useState<TrackId | null>(null);

  const audible = queries.audibility();
  const anySoloed = project.tracks.some((t) => t.soloed);

  // A3 §4.3: the new track is selected and its name opens for typing.
  function addTrack(): void {
    const id = edit.addTrack();
    viewStore.set({ selectedTrackId: id });
    setEditingId(id);
  }

  return (
    <div className="track-headers" style={{ width: TRACK_HEADER_WIDTH_PX }}>
      <div className="track-headers-ruler" style={{ height: RULER_HEIGHT_PX }} aria-hidden="true" />
      {project.tracks.map((track, index) => (
        <TrackHeader
          key={track.id}
          track={track}
          color={`var(--track-${(index % 8) + 1})`}
          selected={track.id === selectedTrackId}
          silencedBySolo={anySoloed && audible.get(track.id) === false}
          editing={track.id === editingId}
          onEditingChange={(editing) => setEditingId(editing ? track.id : null)}
        />
      ))}
      <button type="button" className="add-track" title="Add a track (N)" onClick={addTrack}>
        + Add track <Kbd keys="N" />
      </button>
    </div>
  );
}
