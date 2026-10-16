import type { JSX } from 'react';

/** Stub (AB-06): an empty bar of the right height. Real: AB-08. */
export function TransportBar(): JSX.Element {
  return <div className="bar transport-bar" role="toolbar" aria-label="Transport" />;
}
