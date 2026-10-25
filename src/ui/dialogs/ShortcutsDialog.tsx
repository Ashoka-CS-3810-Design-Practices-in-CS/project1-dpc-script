import type { JSX } from 'react';
import { SHORTCUT_GROUPS } from '@/ui/shortcutList';
import { useView, useViewStore } from '@/ui/servicesContext';
import { useModalDialog } from '@/ui/useModalDialog';
import './shortcutsDialog.css';

/** The "?" list of every keyboard shortcut. Shows while view.dialog is 'shortcuts'. */
export function ShortcutsDialog(): JSX.Element | null {
  const { dialog } = useView();
  return dialog === 'shortcuts' ? <ShortcutList /> : null;
}

function ShortcutList(): JSX.Element {
  const view = useViewStore();
  const dialogRef = useModalDialog();
  const close = () => view.set({ dialog: null });

  return (
    <dialog
      ref={dialogRef}
      className="modal shortcuts-dialog"
      aria-labelledby="shortcuts-title"
      onCancel={(e) => {
        e.preventDefault(); // Esc closes through React
        close();
      }}
    >
      <h2 id="shortcuts-title">Keyboard shortcuts</h2>
      <p className="muted">Shortcuts are off while you are typing in a field.</p>
      <div className="shortcuts-grid">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.items.map((item) => (
                <div key={item.keys} className="shortcut-row">
                  <dt>
                    <kbd className="kbd">{item.keys}</kbd>
                  </dt>
                  <dd>{item.does}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="dialog-buttons">
        <button type="button" className="primary" autoFocus onClick={close}>
          Close
        </button>
      </div>
    </dialog>
  );
}
