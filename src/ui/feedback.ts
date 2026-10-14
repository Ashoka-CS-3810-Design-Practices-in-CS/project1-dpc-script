import { TOAST_MS } from '@/model/constants';

export type ToastKind = 'success' | 'warning' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
}

// ---- toasts ----

let toasts: Toast[] = [];
let nextToastId = 1;
const toastListeners = new Set<(toasts: Toast[]) => void>();

function setToasts(next: Toast[]): void {
  toasts = next;
  toastListeners.forEach((listener) => listener(toasts));
}

function addToast(kind: ToastKind, message: string): void {
  const id = nextToastId++;
  setToasts([...toasts, { id, kind, message }]);
  // Errors stay until the user closes them.
  if (kind !== 'error') setTimeout(() => dismissToast(id), TOAST_MS);
}

export const notify = {
  success: (m: string) => addToast('success', m),
  warning: (m: string) => addToast('warning', m),
  error: (m: string) => addToast('error', m),
};

export function subscribeToasts(listener: (toasts: Toast[]) => void): () => void {
  toastListeners.add(listener);
  listener(toasts);
  return () => {
    toastListeners.delete(listener);
  };
}

export function dismissToast(id: number): void {
  setToasts(toasts.filter((t) => t.id !== id));
}

// ---- confirmation dialog ----

interface PendingConfirm {
  request: ConfirmRequest;
  resolve: (answer: boolean) => void;
}

// The first entry is the one on screen; the rest are waiting their turn.
const confirmQueue: PendingConfirm[] = [];
const confirmListeners = new Set<(req: ConfirmRequest | null) => void>();

function emitConfirm(): void {
  const current = confirmQueue[0]?.request ?? null;
  confirmListeners.forEach((listener) => listener(current));
}

export function confirmDialog(req: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    confirmQueue.push({ request: req, resolve });
    if (confirmQueue.length === 1) emitConfirm();
  });
}

export function subscribeConfirm(listener: (req: ConfirmRequest | null) => void): () => void {
  confirmListeners.add(listener);
  listener(confirmQueue[0]?.request ?? null);
  return () => {
    confirmListeners.delete(listener);
  };
}

/** Called by the dialog component (AB-06) when the user picks an answer. */
export function resolveConfirm(answer: boolean): void {
  confirmQueue.shift()?.resolve(answer);
  emitConfirm();
}
