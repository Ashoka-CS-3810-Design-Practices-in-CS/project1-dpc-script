/** Every fixed number and name in the app (README §7). Use these, never the literal. */

/** Project file format version (A2 DS7). */
export const PROJECT_VERSION = 1;
/** Project sample rate in Hz (A3 [DEC]). */
export const SAMPLE_RATE = 44100;
/** Sample rates offered by the Export dialog (A3 §4.1). */
export const EXPORT_SAMPLE_RATES = [44100, 48000] as const;

/** Shortest allowed clip or edit piece, in seconds (A1 FR5). */
export const MIN_CLIP_LENGTH = 0.05;
/** Tolerance for time comparisons, in seconds; far below one sample (1/44100 s). */
export const EPSILON = 1e-9;
/** Snap distance in pixels, inclusive: 8 px snaps, 9 px does not (A3 Table 1). */
export const SNAP_DISTANCE_PX = 8;

/** Largest importable file, in bytes (A3 [DEC]). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** Longest importable file, in seconds: 30 min (A3 [DEC]). */
export const MAX_DURATION_S = 1800;
/** File extensions accepted by import (A1 FR2). */
export const ACCEPTED_EXTENSIONS = ['.wav', '.mp3'] as const;
/** Maximum length of track and project names (A3 Table 2). */
export const MAX_NAME_LENGTH = 64;

/** Volume of a new track: −6 dB as linear gain (A3 §4.7). */
export const NEW_TRACK_VOLUME = 0.5011872336272722;
/** Delay between "play" and the first scheduled sound, in seconds (A3 T2). */
export const SCHEDULE_MARGIN_S = 0.05;
/** Ramp length for click-free gain changes, in seconds (A2 A6). */
export const GAIN_RAMP_S = 0.02;
/** Samples per block at peak-pyramid level 0 (A3 §3.2, §3.6). */
export const PEAK_BLOCK_SIZE = 256;

/** Arrow-key nudge of clips and the playhead, in seconds (A3 §4.2). */
export const NUDGE_S = 0.01;
/** Shift + arrow-key nudge, in seconds (A3 §4.2). */
export const NUDGE_SHIFT_S = 1;

/** Autosave interval in milliseconds (A3 R2). */
export const AUTOSAVE_MS = 30000;
/** Warnings and successes auto-hide after this many ms; errors stay until closed (A3 §4.5). */
export const TOAST_MS = 4000;

/** Timeline zoom in pixels per second. */
export const PX_PER_SECOND_DEFAULT = 100;
export const PX_PER_SECOND_MIN = 10;
export const PX_PER_SECOND_MAX = 1000;
/** Zoom factor of the + / − keys. */
export const ZOOM_STEP = 1.25;

/** Timeline layout, in pixels. */
export const TRACK_HEIGHT_PX = 96;
export const RULER_HEIGHT_PX = 28;
export const TRACK_HEADER_WIDTH_PX = 240;
/** Top strip of a clip that moves it (README §9.5 R10). */
export const CLIP_HEADER_PX = 16;
/** Left/right clip edge that trims it. */
export const EDGE_HANDLE_PX = 6;
/** Square at a clip's top corners that sets its fades. */
export const FADE_HANDLE_PX = 10;
/** Narrowest supported layout (A3 §4.6). */
export const MIN_LAYOUT_WIDTH_PX = 1280;
/** Smallest clickable target, 24 × 24 px (A3 §4.7). */

/** IndexedDB database name (A2 DS7). */
export const DB_NAME = 'dpcs-editor';
