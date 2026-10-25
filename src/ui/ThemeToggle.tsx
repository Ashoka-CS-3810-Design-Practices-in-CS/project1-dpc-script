import { useState, type JSX } from 'react';

type Theme = 'cream' | 'ink';
const KEY = 'dpcs-theme';

/** A switch between the cream look (knob on the sun) and the ink look (knob on the moon).
 *  index.html applies the saved choice before the first paint; this switches it and remembers it. */
export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(
    document.documentElement.dataset.theme === 'ink' ? 'ink' : 'cream',
  );
  const ink = theme === 'ink';

  function toggle(): void {
    const next: Theme = ink ? 'cream' : 'ink';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage is blocked: the choice just lasts until the page is closed.
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={ink}
      aria-label="Dark theme"
      title={ink ? 'Switch to the cream theme' : 'Switch to the ink (dark) theme'}
      className="theme-switch"
      onClick={toggle}
    >
      <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" />
        <path
          d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
      </svg>
      <span className="theme-knob" aria-hidden="true" />
    </button>
  );
}
