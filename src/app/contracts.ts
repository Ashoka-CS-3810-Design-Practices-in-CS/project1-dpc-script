import type { Clip, ClipId, Project, Seconds, SourceId, Track, TrackId } from '@/model/types';
import type { Result } from '@/model/result';

// ---------- Project store (single owner of the current Project) ----------
/** structure: clips/tracks changed · mix: volume/mute/solo · meta: project name
 *  sources: a source's status/buffer changed · peaks: a source's peaks arrived
 *  project: whole project replaced (New/Open/Reset) · saved: project was saved */
export type ChangeKind = 'structure' | 'mix' | 'meta' | 'sources' | 'peaks' | 'project' | 'saved';
export interface Change {
  kind: ChangeKind;
  sourceId?: SourceId; // for 'sources' and 'peaks'
}
export interface ProjectStore {
  get(): Project;
  /** Replace the whole project. Emits 'project'. Clears dirty. */
  replace(project: Project): void;
  /** Call exactly once after each successful mutation. Bumps version; 'structure' | 'mix' | 'meta' set dirty. */
  commit(change: Change): void;
  version(): number;
  isDirty(): boolean;
  savedAt(): number | null; // epoch ms of the last save
  /** Clears dirty, sets savedAt = Date.now(), emits 'saved'. */
  markSaved(): void;
  subscribe(listener: (change: Change) => void): () => void;
}

// ---------- Edit service (the only code that mutates tracks and clips) ----------
export interface EditService {
  addTrack(): TrackId; // name "Track N", volume NEW_TRACK_VOLUME
  renameTrack(id: TrackId, name: string): Result;
  deleteTrack(id: TrackId): void; // removes its clips and releases their sources
  deleteAllTracks(): void; // Reset: one edit, so one undo step
  setVolume(id: TrackId, volume: number): void; // clamps to 0..1; commit 'mix'
  toggleMute(id: TrackId): void; // commit 'mix'
  toggleSolo(id: TrackId): void; // commit 'mix'
  /** A1 step 6: first free position at or after `at` on the track; retains the source. */
  addClip(trackId: TrackId, sourceId: SourceId, duration: Seconds, at: Seconds): Result<ClipId>;
  /** A4 commit. newStart < 0 is moved to 0. Fails if it overlaps a clip on the destination. */
  moveClip(clipId: ClipId, toTrackId: TrackId, newStart: Seconds): Result;
  /** A5. start/end are timeline seconds. */
  trimToSelection(clipId: ClipId, start: Seconds, end: Seconds): Result;
  trimEdge(clipId: ClipId, edge: 'start' | 'end', newTime: Seconds): Result;
  split(clipId: ClipId, at: Seconds): Result<[ClipId, ClipId]>;
  deleteRegion(clipId: ClipId, start: Seconds, end: Seconds): Result;
  removeClip(clipId: ClipId): void; // releases the source
  setFades(clipId: ClipId, fadeIn: Seconds, fadeOut: Seconds): Result;
  /** Reverts the last edit above (each one is a single step; volume drags on one track count
   *  as one). Fails with MSG.nothingToUndo. The history is cleared when a project is opened. */
  undo(): Result;
  redo(): Result; // fails with MSG.nothingToRedo
  canUndo(): boolean;
  canRedo(): boolean;
}

// ---------- Read-only timeline queries for the UI ----------
export interface ClipLocation {
  track: Track;
  trackIndex: number;
  clip: Clip;
  clipIndex: number;
}
export interface DropPreview {
  trackId: TrackId | null; // null = pointer is not over a track row
  start: Seconds; // after clamping ≥ 0 and snapping
  valid: boolean;
  snapLine: Seconds | null; // time of the snap guide line, if snapped
}
export interface DragSession {
  /** A4, per pointer move. candidateStart = pointer time − grab offset. */
  update(candidateStart: Seconds, trackId: TrackId | null, pxPerSecond: number): DropPreview;
}
export interface EdgeLimits {
  minStart: Seconds; // furthest the start edge may move left
  maxEnd: Seconds; // furthest the end edge may move right
}
export interface TimelineQueries {
  findClip(clipId: ClipId): ClipLocation | null;
  clipAt(trackId: TrackId, t: Seconds): Clip | null; // A3
  visibleClips(trackId: TrackId, from: Seconds, to: Seconds): Clip[]; // A3
  beginDrag(clipId: ClipId, playhead: Seconds): DragSession; // collects snap points
  edgeLimits(clipId: ClipId): EdgeLimits;
  /** A2 draw. [min, max] for columns firstCol … firstCol+count−1 (column 0 = clip's first pixel).
   *  null while the source's peaks are not ready or the source is missing. */
  waveformColumns(
    clip: Clip,
    pxPerSecond: number,
    firstCol: number,
    count: number,
  ): Float32Array | null;
  fadeVolume(clip: Clip, t: Seconds): number; // A7 vol(t), t = seconds since clip start
  audibility(): Map<TrackId, boolean>; // A6, for greying out silenced tracks
  projectEnd(): Seconds; // latest clip end, 0 if no clips
}

// ---------- Transport ----------
export type TransportState = 'stopped' | 'playing' | 'paused';
export interface TransportEvent {
  state: TransportState;
  error?: string; // set when an error forced Stopped (ER2)
}
export interface TransportService {
  play(): Promise<Result>; // resumes the AudioContext (needs a user gesture)
  pause(): void;
  togglePlay(): Promise<Result>;
  stop(): void;
  seek(t: Seconds): void; // clamped to [0, projectEnd]
  position(): Seconds; // read every animation frame
  state(): TransportState;
  subscribe(listener: (e: TransportEvent) => void): () => void;
}

// ---------- Import ----------
export interface ImportedClip {
  clipId: ClipId;
  fileName: string;
  duration: Seconds;
}
export interface ImportService {
  importFile(file: File, trackId: TrackId | null, at: Seconds): Promise<Result<ImportedClip>>;
  /** Opens the file picker; resolves null if the user cancels. */
  pickAndImport(trackId: TrackId | null, at: Seconds): Promise<Result<ImportedClip> | null>;
}

// ---------- Export ----------
export interface ExportSettings {
  fileName: string; // without or with ".wav"
  sampleRate: 44100 | 48000;
  channels: 1 | 2;
}
export interface ExportProgress {
  phase: 'render' | 'encode';
  fraction: number; // 0..1; NaN = indeterminate (render phase)
}
export interface ExportedFile {
  fileName: string; // with ".wav"
  duration: Seconds;
  bytes: number;
}
export interface ExportService {
  check(settings: ExportSettings): Result; // nothing to export / every track muted / bad name
  estimateBytes(settings: ExportSettings): number; // ≈ 6 · L · ch (A3 §3.3)
  export(
    settings: ExportSettings,
    onProgress: (p: ExportProgress) => void,
    signal: AbortSignal,
  ): Promise<Result<ExportedFile>>; // warning MSG.exportClipped if samples were limited
}

// ---------- Projects ----------
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number; // epoch ms
  duration: Seconds;
}
export interface ProjectService {
  init(): Promise<void>; // startup: empty project, orphan cleanup, autosave timer
  newProject(): void; // caller confirms unsaved changes first
  rename(name: string): Result; // project name; commit 'meta'
  save(): Promise<Result>;
  list(): Promise<ProjectSummary[]>;
  open(id: string): Promise<Result>; // warnings: missing audio, clamped volumes
  remove(id: string): Promise<Result>;
  reset(): void; // empties the current project; caller confirms first
  onError(listener: (message: string) => void): () => void; // autosave failures
}

// ---------- Everything the UI can reach ----------
export interface Services {
  store: ProjectStore;
  edit: EditService;
  queries: TimelineQueries;
  transport: TransportService;
  importer: ImportService;
  exporter: ExportService;
  projects: ProjectService;
}
