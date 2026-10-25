import { useEffect, useState, type JSX } from 'react';
import { useModalDialog } from '@/ui/useModalDialog';
import { resolveConfirm, subscribeConfirm, type ConfirmRequest } from '@/ui/feedback';

/** Shows whatever confirmDialog() is asking, one question at a time. */
export function ConfirmDialog(): JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const dialogRef = useModalDialog(request !== null);

  useEffect(() => subscribeConfirm(setRequest), []);

  return (
    <dialog
      ref={dialogRef}
      className="modal confirm-dialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      // Esc counts as Cancel. We close the dialog ourselves, once the answer is in.
      onCancel={(e) => {
        e.preventDefault();
        resolveConfirm(false);
      }}
    >
      {request && (
        // The key makes the buttons start fresh for a queued second question, so focus resets.
        <div key={`${request.title}|${request.message}`}>
          <h2 id="confirm-title">{request.title}</h2>
          <p id="confirm-message">{request.message}</p>
          <div className="dialog-buttons">
            <button type="button" autoFocus onClick={() => resolveConfirm(false)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => resolveConfirm(true)}>
              {request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
