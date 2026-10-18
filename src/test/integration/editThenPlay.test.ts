import { describe, expect, it } from 'vitest';
import { createEditService } from '@/app/editService';
import { createProjectStore } from '@/app/store';
import { createDefaultEffects } from '@/engine/effects';
import { buildMix } from '@/engine/graphBuilder';
import { NEW_TRACK_VOLUME } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import { createRecordingContext } from '@/test/fakeAudio';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

/** A real store and EditService with two ready sources: A (10 s) and B (3 s). */
function setup() {
  const registry = createSourceRegistry();
  for (const [id, seconds] of [
    ['A', 10],
    ['B', 3],
  ] as const) {
    registry.add({
      id,
      fileName: `${id}.wav`,
      status: 'ready',
      buffer: fakeAudioBuffer({ duration: seconds }),
      peaks: null,
      refCount: 0,
    });
  }
  const store = createProjectStore(createEmptyProject('p', registry));
  return { store, edit: createEditService(store) };
}

const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('edit, then play', () => {
  it('split, move, fades and mute give exactly the hand-worked schedule', () => {
    const { store, edit } = setup();
    const t1 = edit.addTrack();
    const t2 = edit.addTrack();

    // Track 1: A at 0 (0–10), split at 4 into [0–4] and [4–10], then the right piece moves to 5.
    const clipA = must(edit.addClip(t1, 'A', 10, 0));
    const [left, right] = must(edit.split(clipA, 4));
    must(edit.moveClip(right, t1, 5));
    must(edit.setFades(left, 1, 2));
    // Track 2: B at 2 (2–5), muted.
    must(edit.addClip(t2, 'B', 3, 2));
    edit.toggleMute(t2);

    // Play from p = 3 s; the audio clock says position 3 sounds at t = 20.05.
    const ctx = createRecordingContext(20);
    buildMix(ctx, store.get(), 3, 20.05, createDefaultEffects());

    // Left piece [0–4]: playing from 3 s in, so it starts now (20.05) 3 s into the file, for 1 s.
    //   fade: vol(3) = (4 − 3) / 2 = 0.5 now, down to 0 one second later.
    // Right piece [5–11] of the file from 4 s: starts 2 s from now, whole piece, no fades.
    // Muted track: still scheduled, at gain 0. B [2–5], 1 s in, for 2 s.
    expect(ctx.log).toEqual([
      'gain#1 = 1', // master
      'connect gain#1 -> destination',
      `gain#2 = ${Number(NEW_TRACK_VOLUME.toFixed(6))}`, // track 1
      'connect gain#2 -> gain#1',
      'src#3.buffer = 10s',
      'connect src#3 -> gain#4',
      'gain#4.set 0.5 @20.05',
      'gain#4.ramp 0 @21.05',
      'connect gain#4 -> gain#2',
      'src#3.start 20.05 3 1',
      'src#5.buffer = 10s',
      'connect src#5 -> gain#6',
      'gain#6.set 1 @22.05',
      'connect gain#6 -> gain#2',
      'src#5.start 22.05 4 6',
      'gain#7 = 0', // track 2, muted
      'connect gain#7 -> gain#1',
      'src#8.buffer = 3s',
      'connect src#8 -> gain#9',
      'gain#9.set 1 @20.05',
      'connect gain#9 -> gain#7',
      'src#8.start 20.05 1 2',
    ]);
  });

  it('playing from the start schedules every clip at its own time', () => {
    const { store, edit } = setup();
    const t = edit.addTrack();
    const clip = must(edit.addClip(t, 'B', 3, 1));
    must(edit.trimEdge(clip, 'start', 2)); // cuts 1 s off the front: now [2–4] of the timeline
    const ctx = createRecordingContext();
    buildMix(ctx, store.get(), 0, 0, createDefaultEffects());
    expect(ctx.log.filter((l) => l.includes('.start'))).toEqual(['src#3.start 2 1 2']);
  });

  it('a change after the first build shows in the next build', () => {
    const { store, edit } = setup();
    const t = edit.addTrack();
    must(edit.addClip(t, 'A', 10, 0));
    const first = createRecordingContext();
    buildMix(first, store.get(), 0, 0, createDefaultEffects());

    edit.toggleSolo(t);
    edit.setVolume(t, 0.25);
    const second = createRecordingContext();
    buildMix(second, store.get(), 0, 0, createDefaultEffects());

    expect(first.log).toContain(`gain#2 = ${Number(NEW_TRACK_VOLUME.toFixed(6))}`);
    expect(second.log).toContain('gain#2 = 0.25');
  });

  it('soloing one track silences the others, even a loud one', () => {
    const { store, edit } = setup();
    const quiet = edit.addTrack();
    const loud = edit.addTrack();
    edit.setVolume(loud, 1);
    must(edit.addClip(quiet, 'A', 10, 0));
    must(edit.addClip(loud, 'B', 3, 0));
    edit.toggleSolo(quiet);
    const ctx = createRecordingContext();
    buildMix(ctx, store.get(), 0, 0, createDefaultEffects());
    expect(ctx.log).toContain(`gain#2 = ${Number(NEW_TRACK_VOLUME.toFixed(6))}`);
    expect(ctx.log).toContain('gain#5 = 0'); // the loud track
  });
});
