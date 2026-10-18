import type { DragSession, ProjectStore, TimelineQueries } from '@/app/contracts';
import { EDIT_OPTS, edgeContext } from '@/app/editService';
import { edgeLimits } from '@/algorithms/edits';
import { fadeVolume } from '@/algorithms/fades';
import { isAudible } from '@/algorithms/mix';
import { peakColumns } from '@/algorithms/peaks';
import { clipIndexAt, visibleRange } from '@/algorithms/search';
import { collectSnapPoints, placementValid, snapStart } from '@/algorithms/snapping';
import { EPSILON, SNAP_DISTANCE_PX } from '@/model/constants';
import { findClip, findTrack, projectEnd } from '@/model/projectOps';
import type { ClipId, Seconds } from '@/model/types';

/** Read-only answers for the timeline UI: hit testing (A3), dragging (A4), edge limits (A5),
 *  waveform columns (A2), fade volume (A7) and audibility (A6). */
export function createTimelineQueries(store: ProjectStore): TimelineQueries {
  /** A clip id that doesn't exist is a bug in the caller (the UI only passes ids it drew). */
  function mustFind(clipId: ClipId) {
    const loc = findClip(store.get(), clipId);
    if (!loc) throw new Error(`Unknown clip: ${clipId}`);
    return loc;
  }

  function beginDrag(clipId: ClipId, playhead: Seconds): DragSession {
    const from = mustFind(clipId);
    const { duration } = from.clip;
    // Snap points are collected once per drag: both edges of every other clip, the playhead and 0.
    const times = [0, playhead];
    for (const track of store.get().tracks) {
      for (const clip of track.clips) {
        if (clip.id !== clipId) times.push(clip.startTime, clip.startTime + clip.duration);
      }
    }
    const points = collectSnapPoints(times);

    return {
      update(candidateStart, trackId, pxPerSecond, snapEnabled) {
        let start = Math.max(0, candidateStart);
        let snapLine: Seconds | null = null;
        if (snapEnabled) {
          const snapped = snapStart(
            points,
            start,
            duration,
            SNAP_DISTANCE_PX / pxPerSecond,
            EPSILON,
          );
          start = Math.max(0, snapped.start);
          snapLine = snapped.snappedTo;
        }
        const to = trackId === null ? null : findTrack(store.get(), trackId);
        const skip = to?.track === from.track ? from.clipIndex : -1;
        const valid = to !== null && placementValid(to.track.clips, start, duration, skip, EPSILON);
        return { trackId, start, valid, snapLine };
      },
    };
  }

  return {
    findClip: (clipId) => findClip(store.get(), clipId),

    clipAt(trackId, t) {
      const found = findTrack(store.get(), trackId);
      if (!found) return null;
      const i = clipIndexAt(found.track.clips, t);
      return i < 0 ? null : found.track.clips[i];
    },

    visibleClips(trackId, from, to) {
      const found = findTrack(store.get(), trackId);
      if (!found) return [];
      const [first, last] = visibleRange(found.track.clips, from, to);
      return found.track.clips.slice(first, last);
    },

    beginDrag,

    edgeLimits(clipId) {
      const loc = mustFind(clipId);
      return edgeLimits(loc.clip, edgeContext(store.get(), loc), EDIT_OPTS);
    },

    waveformColumns(clip, pxPerSecond, firstCol, count) {
      const source = store.get().sources.get(clip.sourceId);
      if (source?.status !== 'ready' || !source.peaks) return null;
      const { sampleRate } = source.peaks;
      const startSample = Math.round(clip.sourceOffset * sampleRate);
      return peakColumns(source.peaks, startSample, sampleRate / pxPerSecond, firstCol, count);
    },

    fadeVolume: (clip, t) => fadeVolume(t, clip.duration, clip.fadeIn, clip.fadeOut),

    audibility() {
      const { tracks } = store.get();
      const anySoloed = tracks.some((t) => t.soloed);
      return new Map(tracks.map((t) => [t.id, isAudible(t, anySoloed)]));
    },

    projectEnd: () => projectEnd(store.get()),
  };
}
