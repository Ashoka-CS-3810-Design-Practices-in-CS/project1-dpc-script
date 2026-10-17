import type { EditService, ProjectStore } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { firstFreeStart } from '@/algorithms/search';
import type { EditErrorCode } from '@/algorithms/types';
import { EPSILON, NEW_TRACK_VOLUME } from '@/model/constants';
import { newId } from '@/model/ids';
import { findClip, findTrack, nextTrackName, validateName } from '@/model/projectOps';
import { done, fail, ok } from '@/model/result';
import { addTrack, canPlace, insertClip, removeClipAt, removeTrack } from '@/model/trackOps';
import type { Clip } from '@/model/types';

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

function notImplemented(name: keyof EditService): never {
  throw new Error(`EditService.${name} not implemented yet`);
}

/** The only code that changes tracks and clips. Every method validates first, changes the
 *  project only on success, then commits exactly once. Trim, split, region delete and fades:
 *  VR-06. */
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

    trimToSelection: () => notImplemented('trimToSelection'),
    trimEdge: () => notImplemented('trimEdge'),
    split: () => notImplemented('split'),
    deleteRegion: () => notImplemented('deleteRegion'),
    setFades: () => notImplemented('setFades'),
  };
}
