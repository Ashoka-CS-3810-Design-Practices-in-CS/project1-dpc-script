import { fail, ok, type Result } from '@/model/result';
import { EPSILON, MIN_CLIP_LENGTH, PROJECT_VERSION, SAMPLE_RATE } from '@/model/constants';
import type { Project } from '@/model/types';

export interface ClipJson {
  id: string;
  sourceId: string;
  startTime: number;
  sourceOffset: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
}

export interface TrackJson {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
  soloed: boolean;
  clips: ClipJson[];
}

export interface ProjectJson {
  version: 1;
  id: string;
  name: string;
  sampleRate: number;
  tracks: TrackJson[];
  sources: { id: string; fileName: string }[];
}

/** The user-facing texts parseProject needs. The model can't import app/messages (README §5.2),
 *  so the caller passes them in from MSG. */
export interface ParseMessages {
  damaged: string;
  volumeClamped: (track: string, value: string) => string;
}

/** The project as plain data. Only sources that some clip uses are included. */
export function toJson(p: Project): ProjectJson {
  const usedSourceIds = new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.sourceId)));
  return {
    version: PROJECT_VERSION,
    id: p.id,
    name: p.name,
    sampleRate: p.sampleRate,
    tracks: p.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      volume: t.volume,
      muted: t.muted,
      soloed: t.soloed,
      clips: t.clips.map((c) => ({ ...c })),
    })),
    sources: [...usedSourceIds].map((id) => {
      const source = p.sources.get(id);
      if (!source) throw new Error(`Clip uses unknown source: ${id}`);
      return { id, fileName: source.fileName };
    }),
  };
}

// ---- parsing ----
// Each reader returns the clean value, or null if the data is not valid.

type Obj = Record<string, unknown>;

const isObject = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === 'string' && x !== '';
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function readClip(raw: unknown): ClipJson | null {
  if (!isObject(raw)) return null;
  const { id, sourceId, startTime, sourceOffset, duration } = raw;
  let { fadeIn, fadeOut } = raw;

  if (typeof id !== 'string' || typeof sourceId !== 'string') return null;
  if (!isNumber(startTime) || !isNumber(sourceOffset) || !isNumber(duration)) return null;
  if (!isNumber(fadeIn) || !isNumber(fadeOut)) return null;
  if (startTime < 0 || sourceOffset < 0 || fadeIn < 0 || fadeOut < 0) return null;
  if (duration < MIN_CLIP_LENGTH - EPSILON) return null;

  // Fades a hair too long (rounding) are shrunk to fit; anything bigger is a bad file (R2).
  const overshoot = fadeIn + fadeOut - duration;
  if (overshoot > 1 / SAMPLE_RATE) return null;
  if (overshoot > 0) {
    const scale = duration / (fadeIn + fadeOut);
    fadeIn *= scale;
    fadeOut *= scale;
  }

  return { id, sourceId, startTime, sourceOffset, duration, fadeIn, fadeOut };
}

function readClips(raw: unknown): ClipJson[] | null {
  if (!Array.isArray(raw)) return null;
  const clips: ClipJson[] = [];
  for (const item of raw) {
    const clip = readClip(item);
    if (!clip) return null;
    clips.push(clip);
  }

  clips.sort((a, b) => a.startTime - b.startTime);
  for (let i = 1; i < clips.length; i++) {
    const previous = clips[i - 1];
    // Touching is fine, overlapping is not.
    if (clips[i].startTime < previous.startTime + previous.duration - EPSILON) return null;
  }
  return clips;
}

function readTrack(raw: unknown, msgs: ParseMessages, warnings: string[]): TrackJson | null {
  if (!isObject(raw)) return null;
  const { id, name, volume, muted, soloed } = raw;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  if (typeof volume !== 'number') return null;
  if (typeof muted !== 'boolean' || typeof soloed !== 'boolean') return null;

  const clips = readClips(raw.clips);
  if (!clips) return null;

  // A volume outside 0–1 is not worth rejecting the file for: fix it and say so.
  const clamped = Math.min(1, Math.max(0, volume));
  if (clamped !== volume) warnings.push(msgs.volumeClamped(name, String(clamped)));

  return { id, name, volume: clamped, muted, soloed, clips };
}

function readSources(raw: unknown): ProjectJson['sources'] | null {
  if (!Array.isArray(raw)) return null;
  const sources: ProjectJson['sources'] = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.fileName !== 'string') {
      return null;
    }
    sources.push({ id: item.id, fileName: item.fileName });
  }
  return sources;
}

function readProject(text: string, msgs: ParseMessages, warnings: string[]): ProjectJson | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null; // cut-off or not JSON at all
  }

  if (!isObject(data) || data.version !== PROJECT_VERSION) return null;
  const { id, name, sampleRate } = data;
  if (!isText(id) || !isText(name)) return null;
  if (!isNumber(sampleRate) || sampleRate <= 0) return null;
  if (!Array.isArray(data.tracks)) return null; // an empty list is fine (R4), a missing one is not

  const tracks: TrackJson[] = [];
  for (const item of data.tracks) {
    const track = readTrack(item, msgs, warnings);
    if (!track) return null;
    tracks.push(track);
  }

  const sources = readSources(data.sources);
  if (!sources) return null;
  const known = new Set(sources.map((s) => s.id));
  if (tracks.some((t) => t.clips.some((c) => !known.has(c.sourceId)))) return null;

  return { version: PROJECT_VERSION, id, name, sampleRate, tracks, sources };
}

/** Checks and cleans project text from storage. Unknown extra fields are dropped. */
export function parseProject(text: string, msgs: ParseMessages): Result<ProjectJson> {
  const warnings: string[] = [];
  const project = readProject(text, msgs, warnings);
  if (!project) return fail(msgs.damaged);
  return ok(project, warnings.length > 0 ? warnings : undefined);
}
