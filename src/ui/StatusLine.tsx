import { useEffect, useState, type JSX } from 'react';
import { MSG } from '@/app/messages';
import { formatClock } from '@/ui/format';
import { useProject, useServices } from '@/ui/servicesContext';

/** Bottom line: "Unsaved changes", or when the project was last saved. */
export function StatusLine(): JSX.Element {
  const { store, projects } = useServices();
  useProject(); // so we redraw whenever the store changes

  // An autosave that failed. It goes away by itself once a save works (savedAt changes).
  const [autosaveError, setAutosaveError] = useState<{ message: string; savedAt: number | null }>();
  useEffect(
    () => projects.onError((message) => setAutosaveError({ message, savedAt: store.savedAt() })),
    [projects, store],
  );

  const savedAt = store.savedAt();
  let text = '';
  if (store.isDirty()) text = MSG.unsaved;
  else if (savedAt !== null) text = MSG.saved(formatClock(savedAt));
  if (autosaveError && autosaveError.savedAt === savedAt) text = autosaveError.message;

  return (
    <footer className="status-line" role="status">
      {text}
    </footer>
  );
}
