import { describe, expect, it } from 'vitest';
import { createDefaultEffects } from '@/engine/effects';
import { buildMix } from '@/engine/graphBuilder';
import { renderMix } from '@/engine/offlineRenderer';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import { createRecordingContext } from '@/test/fakeAudio';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

describe('renderMix', () => {
  it('renders ceil(end · rate) frames through the shared mix builder from 0', async () => {
    const sources = createSourceRegistry();
    sources.add({
      id: 's',
      fileName: 's.wav',
      status: 'ready',
      buffer: fakeAudioBuffer({ duration: 1.5 }),
      peaks: null,
      refCount: 1,
    });
    const project = createEmptyProject('p', sources);
    project.tracks.push({
      id: 't',
      name: 'T',
      volume: 0.5,
      muted: false,
      soloed: false,
      clips: [
        {
          id: 'c',
          sourceId: 's',
          startTime: 0.5,
          sourceOffset: 0.25,
          duration: 1.001,
          fadeIn: 0.1,
          fadeOut: 0,
        },
      ],
    });

    const asked: number[][] = [];
    const rendered = fakeAudioBuffer({ duration: 1 });
    const recording = Object.assign(createRecordingContext(), {
      startRendering: async () => rendered,
    });
    const result = await renderMix(
      project,
      48000,
      1,
      createDefaultEffects(),
      (ch, length, rate) => {
        asked.push([ch, length, rate]);
        return recording;
      },
    );

    expect(result).toBe(rendered);
    expect(asked).toEqual([[1, Math.ceil(1.501 * 48000), 48000]]);

    // The same graph playback would build at p = 0, tc = 0.
    const reference = createRecordingContext();
    buildMix(reference, project, 0, 0, createDefaultEffects());
    expect(recording.log).toEqual(reference.log);
  });
});
