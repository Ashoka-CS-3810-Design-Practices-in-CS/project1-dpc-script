import type { JSX } from 'react';

/** ⌘ on a Mac, Ctrl everywhere else. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/** Every keyboard shortcut, grouped, for the help dialog (the keys themselves are in
 *  shortcuts.ts). */
export const SHORTCUT_GROUPS: { title: string; items: { keys: string; does: string }[] }[] = [
  {
    title: 'Playback',
    items: [
      { keys: 'Space', does: 'Play / pause' },
      { keys: 'Home', does: 'Stop and go back to the start' },
      { keys: '← / →', does: 'Move the selected clip, or the playhead on the ruler, by 10 ms' },
      { keys: 'Shift + ← / →', does: 'The same, by 1 s' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: 'S', does: 'Split the clip at the playhead' },
      { keys: 'T', does: 'Trim the clip to the selected region' },
      { keys: 'Delete', does: 'Delete the selected region' },
      { keys: 'Backspace', does: 'Remove the selected clip' },
      { keys: 'M', does: 'Mute / unmute the selected track' },
      { keys: 'O', does: 'Solo / unsolo the selected track' },
      { keys: 'N', does: 'Add a track' },
      { keys: `${MOD} + Z`, does: 'Undo' },
      { keys: `${MOD} + Shift + Z  or  ${MOD} + Y`, does: 'Redo' },
    ],
  },
  {
    title: 'Project',
    items: [
      { keys: 'I', does: 'Import an audio file' },
      { keys: 'E', does: 'Export a WAV file' },
      { keys: `${MOD} + O`, does: 'Open a saved project' },
      { keys: `${MOD} + S`, does: 'Save' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: '+ / −', does: 'Zoom in / out' },
      { keys: `${MOD} + mouse wheel`, does: 'Zoom around the pointer' },
      { keys: 'Shift + mouse wheel', does: 'Scroll sideways' },
      { keys: '?', does: 'Show this list' },
    ],
  },
];

/** A key hint shown beside a button's label. Hidden from screen readers, which hear the
 *  button's name (and the shortcut through aria-keyshortcuts) instead. */
export function Kbd({ keys }: { keys: string }): JSX.Element {
  return (
    <kbd className="kbd" aria-hidden="true">
      {keys}
    </kbd>
  );
}
