/** Every user-facing message (README §9.4). Tests assert these exact strings.
 *  † = quoted from A3 §4.4–4.5. */
export const MSG = {
  // import (ER1)
  importUnreadable: (name: string) => `${name} couldn't be read. Use a WAV or MP3 file.`, // †
  importTooLarge: (name: string) => `${name} is larger than 200 MB.`, // †
  importTooLong: (name: string) => `${name} is longer than 30 minutes.`, // †
  importNoTrack: 'Select or add a track first.', // †
  imported: (name: string, duration: string) => `Imported ${name} (${duration})`, // †
  // editing
  editTooShort: 'Each part must be at least 50 ms.', // †
  editOutsideClip: 'Select a region inside the clip.',
  editNoClip: 'Select a clip first.',
  editPlayheadOutside: 'Move the playhead inside the clip to split it.',
  editOverlap: 'That position overlaps another clip.',
  editOutOfRange: 'That edit goes past the start or end of the audio file.',
  fadeInvalid: 'Fade lengths must be numbers of 0 or more seconds.',
  fadeTooLong: "Fade-in plus fade-out can't be longer than the clip.",
  numberInvalid: 'Enter a number of 0 or more seconds.',
  nameEmpty: "Name can't be empty", // †
  nameTooLong: 'Name can be at most 64 characters.',
  // playback (ER2)
  playbackNoOutput: 'Playback stopped: no audio output. Click Play to try again.', // †
  nothingToPlay: 'Nothing to play. Import audio first.',
  // projects (ER3)
  projectDamaged: 'This project file is damaged or from a newer version.', // †
  missingAudioLabel: (name: string) => `Missing audio — re-import ${name}`, // †
  missingAudioWarning: (count: number) =>
    `${count} audio file${count === 1 ? ' is' : 's are'} missing. Those clips are marked.`,
  volumeClamped: (track: string, value: string) =>
    `Track ${track}: volume was out of range and was set to ${value}.`,
  storageFull: 'Browser storage is full. Delete old projects to save.', // †
  saved: (time: string) => `All changes saved ${time}`, // †
  unsaved: 'Unsaved changes',
  loadingWaveform: 'Loading waveform', // †
  // export (ER4)
  nothingToExport: 'Nothing to export', // †
  everythingMuted: 'Every track is muted.', // †
  exportBadName: 'Enter a file name without / \\ : * ? " < > |',
  exportNoMemory: 'Export failed: not enough memory. Try a shorter project.', // †
  exportFailed: (reason: string) => `Export failed: ${reason}. Try a shorter project.`,
  exportCancelled: 'Export cancelled.',
  exported: (file: string, duration: string, mb: string) =>
    `Exported ${file} (${duration}, ${mb} MB)`, // †
  exportClipped: 'Parts of the mix were too loud and were limited.',
  // confirmations
  confirmDeleteTrack: (name: string) => ({
    title: 'Delete track?',
    message: `Delete "${name}" and all its clips?`,
    confirmLabel: 'Delete track',
  }),
  confirmReset: {
    title: 'Reset project?',
    message: 'Remove every track and clip from this project?',
    confirmLabel: 'Reset',
  },
  confirmDiscard: {
    title: 'Discard unsaved changes?',
    message: 'Your unsaved changes to this project will be lost.',
    confirmLabel: 'Discard changes',
  },
  confirmDeleteProject: (name: string) => ({
    title: 'Delete project?',
    message: `Delete the saved project "${name}" and its audio files?`,
    confirmLabel: 'Delete project',
  }),
} as const;
