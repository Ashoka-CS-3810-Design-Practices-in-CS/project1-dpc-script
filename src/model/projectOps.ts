import type { ClipLocation } from '@/app/contracts';
import { MAX_NAME_LENGTH, PROJECT_VERSION, SAMPLE_RATE } from '@/model/constants';
import { newId } from '@/model/ids';
import type { ClipId, Project, Seconds, SourceRegistry, Track, TrackId } from '@/model/types';

/** DS1. A project with no tracks. */
export function createEmptyProject(name: string, sources: SourceRegistry, id = newId()): Project {
  return { version: PROJECT_VERSION, id, name, sampleRate: SAMPLE_RATE, tracks: [], sources };
}

/** Latest clip end over all tracks, 0 if there are no clips. */
export function projectEnd(p: Project): Seconds {
  let latest = 0;
  for (const track of p.tracks) {
    const last = track.clips.at(-1);
    if (last) latest = Math.max(latest, last.startTime + last.duration);
  }
  return latest;
}

export function findTrack(p: Project, id: TrackId): { track: Track; index: number } | null {
  const index = p.tracks.findIndex((t) => t.id === id);
  return index < 0 ? null : { track: p.tracks[index], index };
}

export function findClip(p: Project, id: ClipId): ClipLocation | null {
  for (let trackIndex = 0; trackIndex < p.tracks.length; trackIndex++) {
    const track = p.tracks[trackIndex];
    const clipIndex = track.clips.findIndex((c) => c.id === id);
    if (clipIndex >= 0) return { track, trackIndex, clip: track.clips[clipIndex], clipIndex };
  }
  return null;
}

/** Why a track or project name is invalid; the app layer maps it to MSG.nameEmpty /
 *  MSG.nameTooLong (model may not import app, README §5.2). */
type NameError = 'empty' | 'too-long';

/** null if `name` is valid: 1–MAX_NAME_LENGTH characters and not all spaces. */
export function validateName(name: string): NameError | null {
  if (name.trim() === '') return 'empty';
  if (name.length > MAX_NAME_LENGTH) return 'too-long';
  return null;
}

/** "Track N" with the smallest N ≥ 1 that no track is using. */
export function nextTrackName(p: Project): string {
  const used = new Set(p.tracks.map((t) => t.name));
  let n = 1;
  while (used.has(`Track ${n}`)) n += 1;
  return `Track ${n}`;
}
