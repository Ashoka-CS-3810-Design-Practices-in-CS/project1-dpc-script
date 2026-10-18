import type { JSX } from 'react';

/** Shown instead of the timeline when the project has no tracks. Placeholder; the Add a track
 *  and Import audio buttons come in VR-09. */
export function EmptyProject(): JSX.Element {
  return (
    <div className="empty-project">
      <p>This project has no tracks yet.</p>
    </div>
  );
}
