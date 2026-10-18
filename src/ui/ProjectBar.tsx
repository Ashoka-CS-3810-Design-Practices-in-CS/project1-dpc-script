import { useState, type JSX } from 'react';
import { MSG } from '@/app/messages';
import { ExportDialog } from '@/ui/dialogs/ExportDialog';
import { OpenProjectDialog } from '@/ui/dialogs/OpenProjectDialog';
import { confirmDialog, notify } from '@/ui/feedback';
import { formatDuration } from '@/ui/format';
import { useProject, useServices, useViewStore } from '@/ui/servicesContext';

/** The project name (click to rename) and New / Open / Save / Import / Export / Reset. */
export function ProjectBar(): JSX.Element {
  const { projects, importer, transport, store } = useServices();
  const view = useViewStore();
  const project = useProject();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [openDialog, setOpenDialog] = useState(false);
  const [exportDialog, setExportDialog] = useState(false);

  function startRename(): void {
    setDraft(project.name);
    setRenaming(true);
  }

  function commitRename(): void {
    const result = projects.rename(draft);
    // On an error the old name simply stays.
    if (!result.ok) notify.error(result.error);
    setRenaming(false);
  }

  async function onNew(): Promise<void> {
    if (store.isDirty() && !(await confirmDialog(MSG.confirmDiscard))) return;
    projects.newProject();
  }

  async function onSave(): Promise<void> {
    const result = await projects.save();
    if (!result.ok) notify.error(result.error);
  }

  async function onImport(): Promise<void> {
    const result = await importer.pickAndImport(view.get().selectedTrackId, transport.position());
    if (result === null) return; // the picker was cancelled
    if (!result.ok) {
      notify.error(result.error);
      return;
    }
    notify.success(MSG.imported(result.value.fileName, formatDuration(result.value.duration)));
    result.warnings?.forEach(notify.warning);
  }

  async function onReset(): Promise<void> {
    if (await confirmDialog(MSG.confirmReset)) projects.reset();
  }

  return (
    <header className="bar project-bar" aria-label="Project">
      {renaming ? (
        <input
          className="project-name-input"
          aria-label="Project name"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            else if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={() => setRenaming(false)}
        />
      ) : (
        <button
          type="button"
          className="project-name"
          aria-label={`Project name: ${project.name}. Rename`}
          onClick={startRename}
        >
          {project.name}
        </button>
      )}
      <span className="bar-spacer" />
      <button type="button" onClick={onNew}>
        New
      </button>
      <button type="button" onClick={() => setOpenDialog(true)}>
        Open
      </button>
      <button type="button" onClick={onSave}>
        Save
      </button>
      <button type="button" onClick={onImport}>
        Import
      </button>
      <button type="button" onClick={() => setExportDialog(true)}>
        Export
      </button>
      <button type="button" onClick={onReset}>
        Reset
      </button>
      <OpenProjectDialog open={openDialog} onClose={() => setOpenDialog(false)} />
      <ExportDialog open={exportDialog} onClose={() => setExportDialog(false)} />
    </header>
  );
}
