import type { JSX } from 'react';
import { MSG } from '@/app/messages';
import { notify } from '@/ui/feedback';
import { formatDuration } from '@/ui/format';
import { useServices, useViewStore } from '@/ui/servicesContext';

/** Shown instead of the timeline when the project has no tracks. */
export function EmptyProject(): JSX.Element {
  const { edit, importer } = useServices();
  const view = useViewStore();

  function addTrack(): void {
    view.set({ selectedTrackId: edit.addTrack() });
  }

  // With no track this yields MSG.importNoTrack (README §9.5 R9).
  async function importAudio(): Promise<void> {
    const r = await importer.pickAndImport(view.get().selectedTrackId, 0);
    if (r === null) return; // the picker was cancelled
    if (!r.ok) {
      notify.error(r.error);
      return;
    }
    notify.success(MSG.imported(r.value.fileName, formatDuration(r.value.duration)));
    r.warnings?.forEach(notify.warning);
  }

  return (
    <div className="empty-project">
      <p>This project has no tracks yet.</p>
      <div className="empty-project-buttons">
        <button type="button" className="primary" onClick={addTrack}>
          Add a track
        </button>
        <button type="button" onClick={() => void importAudio()}>
          Import audio
        </button>
      </div>
      <p>You can also drag audio files onto the timeline.</p>
    </div>
  );
}
