import { describe, expect, it, vi } from 'vitest';
import { createDefaultEffects } from '@/engine/effects';
import { createPlaybackEngine, type LiveContext } from '@/engine/playbackEngine';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { Project } from '@/model/types';
import { createRecordingContext } from '@/test/fakeAudio';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

function fakeLive(currentTime = 10) {
  let resumed = true;
  const ctx: LiveContext & { log: string[] } = Object.assign(createRecordingContext(currentTime), {
    state: 'suspended',
    onstatechange: null as (() => void) | null,
    resume: async () => {
      if (!resumed) throw new Error('blocked');
      ctx.state = 'running';
    },
  });
  return { ctx, blockResume: () => (resumed = false) };
}

/** One track (volume 0.5) with one 4 s clip at 2 s, source ready. */
function oneClipProject(): Project {
  const sources = createSourceRegistry();
  sources.add({
    id: 's',
    fileName: 's.wav',
    status: 'ready',
    buffer: fakeAudioBuffer({ duration: 4 }),
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
      { id: 'c', sourceId: 's', startTime: 2, sourceOffset: 0, duration: 4, fadeIn: 0, fadeOut: 0 },
    ],
  });
  return project;
}

describe('playback engine', () => {
  it('creates the context lazily and schedules from currentTime + margin', async () => {
    const { ctx } = fakeLive(10);
    const create = vi.fn(() => ctx);
    const engine = createPlaybackEngine(create, createDefaultEffects());
    expect(create).not.toHaveBeenCalled();
    expect(engine.now()).toBe(0);

    const tc = await engine.start(oneClipProject(), 0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(tc).toBeCloseTo(10.05);
    expect(engine.now()).toBe(10);
    expect(ctx.state).toBe('running');
    expect(ctx.log.some((l) => l.startsWith('src#') && l.includes('.start 12.05 0 4'))).toBe(true);

    await engine.start(oneClipProject(), 0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects when the context cannot be resumed', async () => {
    const { ctx, blockResume } = fakeLive();
    blockResume();
    const engine = createPlaybackEngine(() => ctx, createDefaultEffects());
    await expect(engine.start(oneClipProject(), 0)).rejects.toThrow('blocked');
  });

  it('stopAll stops and disconnects every node, and is safe to repeat', async () => {
    const { ctx } = fakeLive();
    const engine = createPlaybackEngine(() => ctx, createDefaultEffects());
    await engine.start(oneClipProject(), 0);
    ctx.log.length = 0;
    engine.stopAll();
    expect(ctx.log.filter((l) => l.endsWith('.stop'))).toHaveLength(1);
    expect(ctx.log.filter((l) => l.startsWith('disconnect'))).toHaveLength(3); // player, track, master
    ctx.log.length = 0;
    engine.stopAll();
    expect(ctx.log).toEqual([]);
  });

  it('starting again replaces the old graph', async () => {
    const { ctx } = fakeLive();
    const engine = createPlaybackEngine(() => ctx, createDefaultEffects());
    await engine.start(oneClipProject(), 0);
    ctx.log.length = 0;
    await engine.start(oneClipProject(), 3);
    expect(ctx.log.filter((l) => l.endsWith('.stop'))).toHaveLength(1);
  });

  it('updateGains pins, then ramps each track gain over GAIN_RAMP_S', async () => {
    const { ctx } = fakeLive(10);
    const engine = createPlaybackEngine(() => ctx, createDefaultEffects());
    const project = oneClipProject();
    await engine.start(project, 0);

    project.tracks[0].muted = true;
    ctx.log.length = 0;
    engine.updateGains(project);
    expect(ctx.log).toEqual([
      'gain#2.cancel @10',
      'gain#2.set 0.5 @10', // the volume buildMix gave the track
      'gain#2.ramp 0 @10.02',
    ]);
  });

  it('updateGains does nothing before playback or for tracks added since', async () => {
    const { ctx } = fakeLive();
    const engine = createPlaybackEngine(() => ctx, createDefaultEffects());
    const project = oneClipProject();
    engine.updateGains(project);
    await engine.start(project, 0);
    project.tracks.push({
      id: 'new',
      name: 'N',
      volume: 1,
      muted: false,
      soloed: false,
      clips: [],
    });
    ctx.log.length = 0;
    engine.updateGains(project);
    expect(ctx.log.filter((l) => l.includes('cancel'))).toHaveLength(1);
  });

  it('reports when the output goes away while playing', async () => {
    const { ctx } = fakeLive();
    const engine = createPlaybackEngine(() => ctx, createDefaultEffects());
    const errors: string[] = [];
    const off = engine.onError((m) => errors.push(m));

    // The context reaching 'running' is normal, not an error.
    await engine.start(oneClipProject(), 0);
    ctx.state = 'running';
    ctx.onstatechange?.();
    expect(errors).toEqual([]);

    ctx.state = 'suspended';
    ctx.onstatechange?.();
    ctx.state = 'interrupted';
    ctx.onstatechange?.();
    ctx.state = 'closed';
    ctx.onstatechange?.();
    expect(errors).toHaveLength(3);

    off();
    ctx.onstatechange?.();
    expect(errors).toHaveLength(3);
  });

  it('does not treat suspended as an error when nothing is playing', async () => {
    const { ctx } = fakeLive();
    const engine = createPlaybackEngine(() => ctx, createDefaultEffects());
    const errors: string[] = [];
    engine.onError((m) => errors.push(m));
    await engine.start(oneClipProject(), 0);
    engine.stopAll();
    ctx.state = 'suspended';
    ctx.onstatechange?.();
    expect(errors).toEqual([]);
  });
});
