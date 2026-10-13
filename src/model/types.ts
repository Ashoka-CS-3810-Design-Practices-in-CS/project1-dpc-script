import type { PeakPyramid } from '@/algorithms/types';
export type { PeakPyramid };

export type Seconds = number;
export type SourceId = string;
export type TrackId = string;
export type ClipId = string;

export interface Clip {
  id: ClipId;
  sourceId: SourceId;
  startTime: Seconds;
  sourceOffset: Seconds;
  duration: Seconds;
  fadeIn: Seconds;
  fadeOut: Seconds;
}

export interface Track {
  id: TrackId;
  name: string; // 1–64 chars, not all spaces
  volume: number; // 0..1 linear gain
  muted: boolean;
  soloed: boolean;
  clips: Clip[]; // DS2: sorted by startTime, never overlapping
}

/** 'loading' = being decoded (after Open); 'missing' = bytes not in storage. */
export type SourceStatus = 'loading' | 'ready' | 'missing';

export interface AudioSource {
  id: SourceId;
  fileName: string;
  status: SourceStatus;
  buffer: AudioBuffer | null; // non-null only when status === 'ready'
  peaks: PeakPyramid | null; // null until the peaks worker finishes ("Loading waveform")
  refCount: number; // number of clips using this source
}

/** DS3. The only place that holds decoded sample arrays. */
export interface SourceRegistry {
  get(id: SourceId): AudioSource | undefined;
  add(source: AudioSource): void; // inserted with the refCount given (0 on import)
  retain(id: SourceId): void;
  release(id: SourceId): void; // refCount 0 → entry removed (memory freed)
  update(id: SourceId, patch: Partial<Pick<AudioSource, 'status' | 'buffer' | 'peaks'>>): void;
  all(): AudioSource[];
}

/** DS1. */
export interface Project {
  version: 1;
  id: string;
  name: string; // 1–64 chars
  sampleRate: number; // SAMPLE_RATE
  tracks: Track[]; // array order = display order
  sources: SourceRegistry;
}
