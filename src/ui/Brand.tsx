import type { JSX } from 'react';

/** The logo: braces around a waveform, then the wordmark. Its colours follow the theme. */
export function Brand(): JSX.Element {
  return (
    <div className="brand">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <g fill="none" stroke="var(--accent)" strokeWidth="5.5" strokeLinejoin="round">
          <path d="M23 9H21Q13 9 13 17V26Q13 32 6 32Q13 32 13 38V47Q13 55 21 55H23" />
          <path d="M41 9H43Q51 9 51 17V26Q51 32 58 32Q51 32 51 38V47Q51 55 43 55H41" />
        </g>
        <g strokeWidth="3" strokeLinecap="round">
          <line x1="27" y1="29" x2="27" y2="35" stroke="var(--signal)" />
          <line x1="31" y1="23" x2="31" y2="41" stroke="var(--accent)" />
          <line x1="35" y1="19" x2="35" y2="45" stroke="var(--signal)" />
          <line x1="39" y1="26" x2="39" y2="38" stroke="var(--accent)" />
        </g>
      </svg>
      <span className="brand-word">
        DPC<i>.</i>Script_
      </span>
    </div>
  );
}
