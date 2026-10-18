import type { ClipLocation, EditService, ProjectStore } from '@/app/contracts';
import { MSG } from '@/app/messages';
import {
  checkFades,
  deleteRange,
  splitAt,
  trimEdge as trimClipEdge,
  trimToRange,
  type EdgeContext,
  type EditOpts,
} from '@/algorithms/edits';
import { firstFreeStart } from '@/algorithms/search';
import type { ClipLike, EditError, EditErrorCode } from '@/algorithms/types';
import { EPSILON, MIN_CLIP_LENGTH, NEW_TRACK_VOLUME, SAMPLE_RATE } from '@/model/constants';
import { newId } from '@/model/ids';
import { findClip, findTrack, nextTrackName, validateName } from '@/model/projectOps';
import { done, fail, ok } from '@/model/result';
import {
  addTrack,
  canPlace,
  insertClip,
  removeClipAt,
  removeTrack,
  replaceClipAt,
} from '@/model/trackOps';
import type { Clip, ClipId, Project } from '@/model/types';

const EDIT_MESSAGES: Record<EditErrorCode, string> = {
  'too-short': MSG.editTooShort,
  'outside-clip': MSG.editOutsideClip,
  'fade-invalid': MSG.fadeInvalid,
  'fade-too-long': MSG.fadeTooLong,
  'out-of-range': MSG.editOutOfRange,
};

/** The user-facing message for an A5 edit error code. */
export function editErrorMessage(code: EditErrorCode): string {
  return EDIT_MESSAGES[code];
}

/** A5 options for every edit (README §7). */
export const EDIT_OPTS: EditOpts = {
  minLength: MIN_CLIP_LENGTH,
  sampleRate: SAMPLE_RATE,
  eps: EPSILON,
};

function isEditError<T extends object>(r: T | EditError): r is EditError {
  return 'error' in r;
}

/** Where the clip's edges may go: its neighbours on the track and the length of its audio
 *  (null while the source isn't ready). */
export function edgeContext(p: Project, loc: ClipLocation): EdgeContext {
  const { clips } = loc.track;
  const prev = clips[loc.clipIndex - 1];
  const next = clips[loc.clipIndex + 1];
  const source = p.sources.get(loc.clip.sourceId);
  return {
    prevEnd: prev ? prev.startTime + prev.duration : 0,
    nextStart: next ? next.startTime : Infinity,
    sourceDuration: source?.status === 'ready' && source.buffer ? source.buffer.duration : null,
  };
}

/** A clip of `base`'s source with the numbers of an edit piece. */
function toClip(base: Clip, piece: ClipLike, id: ClipId): Clip {
  return {
    id,
    sourceId: base.sourceId,
    startTime: piece.startTime,
    sourceOffset: piece.sourceOffset,
    duration: piece.duration,
    fadeIn: piece.fadeIn,
    fadeOut: piece.fadeOut,
  };
}

/** The only code that changes tracks and clips. Every method validates first, changes the
 *  project only on success, then commits exactly once. */
export function createEditService(store: ProjectStore): EditService {
  return {
    addTrack() {
      const p = store.get();
      const id = newId();
      addTrack(p, {
        id,
        name: nextTrackName(p),
        volume: NEW_TRACK_VOLUME,
        muted: false,
        soloed: false,
        clips: [],
      });
      store.commit({ kind: 'structure' });
      return id;
    },

    renameTrack(id, name) {
      const found = findTrack(store.get(), id);
      if (!found) return fail(MSG.importNoTrack);
      const error = validateName(name);
      if (error) return fail(error === 'empty' ? MSG.nameEmpty : MSG.nameTooLong);
      found.track.name = name;
      store.commit({ kind: 'structure' });
      return done();
    },

    deleteTrack(id) {
      const p = store.get();
      const found = findTrack(p, id);
      if (!found) return;
      for (const clip of found.track.clips) p.sources.release(clip.sourceId);
      removeTrack(p, id);
      store.commit({ kind: 'structure' });
    },

    setVolume(id, volume) {
      const found = findTrack(store.get(), id);
      if (!found) return;
      found.track.volume = Math.min(1, Math.max(0, volume));
      store.commit({ kind: 'mix' });
    },

    toggleMute(id) {
      const found = findTrack(store.get(), id);
      if (!found) return;
      found.track.muted = !found.track.muted;
      store.commit({ kind: 'mix' });
    },

    toggleSolo(id) {
      const found = findTrack(store.get(), id);
      if (!found) return;
      found.track.soloed = !found.track.soloed;
      store.commit({ kind: 'mix' });
    },

    addClip(trackId, sourceId, duration, at) {
      const p = store.get();
      const found = findTrack(p, trackId);
      if (!found) return fail(MSG.importNoTrack);
      // A clip for a source the registry doesn't know is a bug in the caller.
      if (!p.sources.get(sourceId)) throw new Error(`Unknown source: ${sourceId}`);
      const clip: Clip = {
        id: newId(),
        sourceId,
        startTime: firstFreeStart(found.track.clips, Math.max(0, at), duration, EPSILON),
        sourceOffset: 0,
        duration,
        fadeIn: 0,
        fadeOut: 0,
      };
      insertClip(found.track, clip);
      p.sources.retain(sourceId);
      store.commit({ kind: 'structure' });
      return ok(clip.id);
    },

    moveClip(clipId, toTrackId, newStart) {
      const p = store.get();
      const from = findClip(p, clipId);
      if (!from) return fail(MSG.editNoClip);
      const to = findTrack(p, toTrackId);
      if (!to) return fail(MSG.importNoTrack);
      const start = Math.max(0, newStart); // A3 Table 2: a start before 0 becomes 0
      if (!canPlace(to.track, start, from.clip.duration, clipId)) return fail(MSG.editOverlap);
      removeClipAt(from.track, from.clipIndex);
      insertClip(to.track, { ...from.clip, startTime: start });
      store.commit({ kind: 'structure' });
      return done();
    },

    removeClip(clipId) {
      const p = store.get();
      const found = findClip(p, clipId);
      if (!found) return;
      removeClipAt(found.track, found.clipIndex);
      p.sources.release(found.clip.sourceId);
      store.commit({ kind: 'structure' });
    },

    trimToSelection(clipId, start, end) {
      const loc = findClip(store.get(), clipId);
      if (!loc) return fail(MSG.editNoClip);
      const r = trimToRange(loc.clip, start, end, EDIT_OPTS);
      if (isEditError(r)) return fail(editErrorMessage(r.error));
      replaceClipAt(loc.track, loc.clipIndex, [toClip(loc.clip, r, loc.clip.id)]);
      store.commit({ kind: 'structure' });
      return done();
    },

    trimEdge(clipId, edge, newTime) {
      const p = store.get();
      const loc = findClip(p, clipId);
      if (!loc) return fail(MSG.editNoClip);
      const r = trimClipEdge(loc.clip, edge, newTime, edgeContext(p, loc), EDIT_OPTS);
      if (isEditError(r)) return fail(editErrorMessage(r.error));
      replaceClipAt(loc.track, loc.clipIndex, [toClip(loc.clip, r, loc.clip.id)]);
      store.commit({ kind: 'structure' });
      return done();
    },

    split(clipId, at) {
      const p = store.get();
      const loc = findClip(p, clipId);
      if (!loc) return fail(MSG.editNoClip);
      const r = splitAt(loc.clip, at, EDIT_OPTS);
      if (isEditError(r)) return fail(editErrorMessage(r.error));
      const left = toClip(loc.clip, r[0], loc.clip.id); // the left piece keeps the original id
      const right = toClip(loc.clip, r[1], newId());
      replaceClipAt(loc.track, loc.clipIndex, [left, right]);
      p.sources.retain(loc.clip.sourceId); // the extra piece holds its own reference
      store.commit({ kind: 'structure' });
      return ok<[ClipId, ClipId]>([left.id, right.id]);
    },

    deleteRegion(clipId, start, end) {
      const p = store.get();
      const loc = findClip(p, clipId);
      if (!loc) return fail(MSG.editNoClip);
      const r = deleteRange(loc.clip, start, end, EDIT_OPTS);
      if (isEditError(r)) return fail(editErrorMessage(r.error));
      const pieces = r.map((piece, i) => toClip(loc.clip, piece, i === 0 ? loc.clip.id : newId()));
      replaceClipAt(loc.track, loc.clipIndex, pieces);
      if (pieces.length === 0) p.sources.release(loc.clip.sourceId);
      if (pieces.length === 2) p.sources.retain(loc.clip.sourceId);
      store.commit({ kind: 'structure' });
      return done();
    },

    setFades(clipId, fadeIn, fadeOut) {
      const loc = findClip(store.get(), clipId);
      if (!loc) return fail(MSG.editNoClip);
      const r = checkFades(fadeIn, fadeOut, loc.clip.duration, EDIT_OPTS);
      if (isEditError(r)) return fail(editErrorMessage(r.error));
      replaceClipAt(loc.track, loc.clipIndex, [{ ...loc.clip, ...r }]);
      store.commit({ kind: 'structure' });
      return done();
    },
  };
}
