import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { ProjectSummary } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { confirmDialog, notify } from '@/ui/feedback';
import { formatClock, formatDuration } from '@/ui/format';
import { useServices } from '@/ui/servicesContext';
import { report } from '@/ui/shortcuts';
import { useModalDialog } from '@/ui/useModalDialog';
import './openProjectDialog.css';

interface OpenProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

/** FR8: list, open and delete the projects saved in this browser. */
export function OpenProjectDialog({ open, onClose }: OpenProjectDialogProps): JSX.Element | null {
  // The list only exists while open, so every opening loads it fresh.
  return open ? <ProjectList onClose={onClose} /> : null;
}

function lastChanged(epochMs: number): string {
  return `${new Date(epochMs).toLocaleDateString()} ${formatClock(epochMs)}`;
}

function ProjectList({ onClose }: { onClose: () => void }): JSX.Element {
  const { projects, store } = useServices();
  const dialogRef = useModalDialog();
  const firstOpenRef = useRef<HTMLButtonElement>(null);
  const [list, setList] = useState<ProjectSummary[] | null>(null); // null while loading
  const [busy, setBusy] = useState(false);

  // Storage that can't be read shows as an empty list rather than failing.
  const load = useCallback(() => projects.list().catch((): ProjectSummary[] => []), [projects]);

  useEffect(() => {
    let live = true;
    void load().then((summaries) => {
      if (live) setList(summaries);
    });
    return () => {
      live = false;
    };
  }, [load]);

  // Focus starts on the first Open button once the list is there.
  useEffect(() => {
    if (list && list.length > 0) firstOpenRef.current?.focus();
  }, [list]);

  async function openProject(id: string): Promise<void> {
    if (store.isDirty() && !(await confirmDialog(MSG.confirmDiscard))) return;
    setBusy(true);
    const r = await projects.open(id);
    setBusy(false);
    report(r);
    if (r.ok) onClose();
  }

  async function removeProject(p: ProjectSummary): Promise<void> {
    if (!(await confirmDialog(MSG.confirmDeleteProject(p.name)))) return;
    setBusy(true);
    const r = await projects.remove(p.id);
    setBusy(false);
    if (!r.ok) notify.error(r.error);
    setList(await load());
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal open-dialog"
      aria-labelledby="open-title"
      onCancel={(e) => {
        e.preventDefault(); // Esc closes through onClose, so React stays in charge
        onClose();
      }}
    >
      <h2 id="open-title">Open project</h2>
      {list === null ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <p>No saved projects yet.</p>
      ) : (
        <table className="open-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Last changed</th>
              <th scope="col">Length</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((p, i) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{lastChanged(p.updatedAt)}</td>
                <td>{formatDuration(p.duration)}</td>
                <td className="open-actions">
                  <button
                    type="button"
                    className="primary"
                    ref={i === 0 ? firstOpenRef : undefined}
                    aria-label={`Open ${p.name}`}
                    disabled={busy}
                    onClick={() => void openProject(p.id)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${p.name}`}
                    disabled={busy}
                    onClick={() => void removeProject(p)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
