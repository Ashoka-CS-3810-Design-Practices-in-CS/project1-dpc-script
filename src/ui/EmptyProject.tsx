import type { JSX } from 'react';
import { useServices, useViewStore } from '@/ui/servicesContext';
import { pickAndImportAudio } from '@/ui/shortcuts';

/** Shown instead of the timeline when the project has no tracks. */
export function EmptyProject(): JSX.Element {
  const services = useServices();
  const { edit } = services;
  const view = useViewStore();

  function addTrack(): void {
    view.set({ selectedTrackId: edit.addTrack() });
  }

  return (
    <div className="empty-project">
      <p>This project has no tracks yet.</p>
      <div className="empty-project-buttons">
        <button type="button" className="primary" onClick={addTrack}>
          Add a track
        </button>
        <button type="button" onClick={() => void pickAndImportAudio(services, view)}>
          Import audio
        </button>
      </div>
      <p>You can also drag audio files onto the timeline.</p>
    </div>
  );
}
