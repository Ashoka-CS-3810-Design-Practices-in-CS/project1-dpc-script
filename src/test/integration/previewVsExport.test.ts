import { describe, expect, it } from 'vitest';
import { createEditService } from '@/app/editService';
import { createProjectStore } from '@/app/store';
import { createDefaultEffects } from '@/engine/effects';
import { buildMix } from '@/engine/graphBuilder';
import { renderMix, type OfflineContextLike } from '@/engine/offlineRenderer';
import { createEmptyProject, projectEnd } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import { createRecordingContext } from '@/test/fakeAudio';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** Three clips over three tracks, with a split, fades, a different volume and a muted track. */
function threeClipProject() {
  const registry = createSourceRegistry();
  for (const [id, seconds] of [
    ['voice', 6],
    ['music', 8],
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
  const store = createProjectStore(createEmptyProject('mix', registry));
  const edit = createEditService(store);
  const t1 = edit.addTrack();
  const t2 = edit.addTrack();
  const t3 = edit.addTrack();

  const voice = must(edit.addClip(t1, 'voice', 6, 0));
  const [first, second] = must(edit.split(voice, 2.5));
  must(edit.moveClip(second, t1, 4)); // a gap between the two pieces
  must(edit.setFades(first, 0.5, 1));
  const music = must(edit.addClip(t2, 'music', 8, 1));
  must(edit.setFades(music, 2, 2));
  edit.setVolume(t2, 0.3);
  must(edit.addClip(t3, 'voice', 6, 0));
  edit.toggleMute(t3);
  return store.get();
}

describe('preview vs export', () => {
  it('playback from 0 and the offline render build the same audio graph, call for call', async () => {
    const project = threeClipProject();
    const effects = createDefaultEffects();

    // As playback does it: from the start, with tc = 0.
    const preview = createRecordingContext();
    buildMix(preview, project, 0, 0, effects);

    // As the export does it, through renderMix, with a recording context standing in.
    const asked: number[][] = [];
    const rendered = fakeAudioBuffer({ duration: 1 });
    const offline = Object.assign(createRecordingContext(), {
      startRendering: async () => rendered,
    });
    const out = await renderMix(project, 44100, 2, effects, (channels, length, rate) => {
      asked.push([channels, length, rate]);
      return offline as OfflineContextLike;
    });

    expect(out).toBe(rendered);
    expect(asked).toEqual([[2, Math.ceil(projectEnd(project) * 44100), 44100]]);
    expect(preview.log.length).toBeGreaterThan(20); // the graph is not trivially empty
    expect(offline.log).toEqual(preview.log);
  });

  it('building the same project twice gives identical logs', () => {
    const project = threeClipProject();
    const a = createRecordingContext();
    const b = createRecordingContext();
    buildMix(a, project, 0, 0, createDefaultEffects());
    buildMix(b, project, 0, 0, createDefaultEffects());
    expect(a.log).toEqual(b.log);
  });

  it('the export is exactly as long as the project, at either sample rate', async () => {
    const project = threeClipProject(); // the last clip, music, ends at 1 + 8 = 9 s
    expect(projectEnd(project)).toBe(9);
    const lengths: number[] = [];
    for (const rate of [44100, 48000]) {
      await renderMix(project, rate, 1, createDefaultEffects(), (_channels, length) => {
        lengths.push(length);
        return Object.assign(createRecordingContext(), {
          startRendering: async () => fakeAudioBuffer({ duration: 1 }),
        });
      });
    }
    expect(lengths).toEqual([9 * 44100, 9 * 48000]);
  });
});
