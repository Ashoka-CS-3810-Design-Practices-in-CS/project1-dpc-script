import type { JSX } from 'react';

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Stub (AB-06). Real: AB-09. */
export function ExportDialog(props: ExportDialogProps): JSX.Element | null {
  void props;
  return null;
}
