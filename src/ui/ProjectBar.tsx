import { useState, type JSX } from 'react';
import { MSG } from '@/app/messages';
import { ExportDialog } from '@/ui/dialogs/ExportDialog';
import { OpenProjectDialog } from '@/ui/dialogs/OpenProjectDialog';
import { Brand } from '@/ui/Brand';
import { ShortcutsDialog } from '@/ui/dialogs/ShortcutsDialog';
import { confirmDialog, notify } from '@/ui/feedback';
import { useProject, useServices, useView, useViewStore } from '@/ui/servicesContext';
import { Kbd, MOD } from '@/ui/shortcutList';
import { pickAndImportAudio, report } from '@/ui/shortcuts';

/** The project name (click to rename) and New / Open / Save / Import / Export / Reset. */
export function ProjectBar(): JSX.Element {
  const services = useServices();
  const { projects, edit, store } = services;
  const view = useViewStore();
  const { dialog } = useView();
  const project = useProject();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

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
    report(await projects.save());
  }

  async function onReset(): Promise<void> {
    if (await confirmDialog(MSG.confirmReset)) projects.reset();
  }

  return (
    <header className="bar project-bar" aria-label="Project">
      <Brand />
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
      <button
        type="button"
        title={`Undo (${MOD}+Z)`}
        aria-keyshortcuts={`${MOD}+Z`}
        disabled={!edit.canUndo()}
        onClick={() => report(edit.undo())}
      >
        Undo <Kbd keys={`${MOD}+Z`} />
      </button>
      <button
        type="button"
        title={`Redo (${MOD}+Y or ${MOD}+Shift+Z)`}
        aria-keyshortcuts={`${MOD}+Shift+Z`}
        disabled={!edit.canRedo()}
        onClick={() => report(edit.redo())}
      >
        Redo <Kbd keys={`${MOD}+Y`} />
      </button>
      <span className="bar-divider" aria-hidden="true" />
      <button type="button" onClick={onNew}>
        New
      </button>
      <button
        type="button"
        title={`Open a saved project (${MOD}+O)`}
        onClick={() => view.set({ dialog: 'open' })}
      >
        Open <Kbd keys={`${MOD}+O`} />
      </button>
      <button type="button" title={`Save (${MOD}+S)`} onClick={onSave}>
        Save <Kbd keys={`${MOD}+S`} />
      </button>
      <button
        type="button"
        title="Import an audio file (I)"
        onClick={() => void pickAndImportAudio(services, view)}
      >
        Import <Kbd keys="I" />
      </button>
      <button
        type="button"
        title="Export a WAV file (E)"
        onClick={() => view.set({ dialog: 'export' })}
      >
        Export <Kbd keys="E" />
      </button>
      <button type="button" onClick={onReset}>
        Reset
      </button>
      <OpenProjectDialog open={dialog === 'open'} onClose={() => view.set({ dialog: null })} />
      <ExportDialog open={dialog === 'export'} onClose={() => view.set({ dialog: null })} />
      <ShortcutsDialog />
    </header>
  );
}
