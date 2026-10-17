import type { JSX } from 'react';
import { MSG } from '@/app/messages';
import { formatClock } from '@/ui/format';
import { useProject, useServices } from '@/ui/servicesContext';

/** Bottom line: "Unsaved changes", or when the project was last saved. */
export function StatusLine(): JSX.Element {
  const { store } = useServices();
  useProject(); // so we redraw whenever the store changes

  const savedAt = store.savedAt();
  let text = '';
  if (store.isDirty()) text = MSG.unsaved;
  else if (savedAt !== null) text = MSG.saved(formatClock(savedAt));

  return (
    <footer className="status-line" role="status">
      {text}
    </footer>
  );
}
