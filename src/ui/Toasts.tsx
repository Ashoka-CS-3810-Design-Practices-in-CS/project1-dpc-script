import { useEffect, useState, type JSX } from 'react';
import { dismissToast, subscribeToasts, type Toast, type ToastKind } from '@/ui/feedback';

const ICONS: Record<ToastKind, string> = { success: '✓', warning: '⚠', error: '✕' };
const LABELS: Record<ToastKind, string> = {
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
};

/** The corner stack of messages. Errors announce themselves; the rest wait politely. */
export function Toasts(): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-icon" aria-hidden="true">
            {ICONS[toast.kind]}
          </span>
          <span className="toast-message">
            <span className="visually-hidden">{LABELS[toast.kind]}: </span>
            {toast.message}
          </span>
          <button type="button" aria-label="Close message" onClick={() => dismissToast(toast.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
