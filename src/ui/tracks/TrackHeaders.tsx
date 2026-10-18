import type { JSX } from 'react';
import { RULER_HEIGHT_PX, TRACK_HEADER_WIDTH_PX, TRACK_HEIGHT_PX } from '@/model/constants';
import { useProject } from '@/ui/servicesContext';

/** One header per track row, lined up with the canvas rows. Names only for now; the controls
 *  (rename, mute, solo, volume, delete, add track) come in VR-09. */
export function TrackHeaders(): JSX.Element {
  const project = useProject();
  return (
    <div className="track-headers" style={{ width: TRACK_HEADER_WIDTH_PX }}>
      <div className="track-headers-ruler" style={{ height: RULER_HEIGHT_PX }} aria-hidden="true" />
      {project.tracks.map((track) => (
        <div key={track.id} className="track-header" style={{ height: TRACK_HEIGHT_PX }}>
          <span className="track-name">{track.name}</span>
        </div>
      ))}
    </div>
  );
}
