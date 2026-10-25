import { useEffect, useRef, useState, type JSX } from 'react';
import { MSG } from '@/app/messages';
import { notify } from '@/ui/feedback';
import { formatClock } from '@/ui/format';
import { useProject, useServices } from '@/ui/servicesContext';

/** Bottom line: "Unsaved changes", or when the project was last saved. */
export function StatusLine(): JSX.Element {
  const { store, projects } = useServices();
  useProject(); // so we redraw whenever the store changes

  // An autosave that failed. It goes away by itself once a save works (savedAt changes).
  const [autosaveError, setAutosaveError] = useState<{ message: string; savedAt: number | null }>();
  // It also pops up as a toast, once per kind of failure until a save works again (autosave
  // retries every 30 s, and errors stay until closed).
  const lastToast = useRef<string | null>(null);
  useEffect(() => {
    const offError = projects.onError((message) => {
      setAutosaveError({ message, savedAt: store.savedAt() });
      if (message !== lastToast.current) notify.error(message);
      lastToast.current = message;
    });
    const offSaved = store.subscribe((c) => {
      if (c.kind === 'saved') lastToast.current = null;
    });
    return () => {
      offError();
      offSaved();
    };
  }, [projects, store]);

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
