import { useEffect, useRef } from 'react';

/** The ref for a native <dialog> that is shown modally while `open` is true. */
export function useModalDialog(open = true) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}
