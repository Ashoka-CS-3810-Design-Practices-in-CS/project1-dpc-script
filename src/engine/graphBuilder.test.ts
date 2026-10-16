import { describe, expect, it } from 'vitest';
import type { AudioContextLike } from './audioTypes';
import { createDefaultEffects, EffectRegistry, type ClipEffect } from './effects';
import { buildMix } from './graphBuilder';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { AudioSource, Clip, Project, SourceStatus, Track } from '@/model/types';
import { createRecordingContext } from '@/test/fakeAudio';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

const buffer10 = fakeAudioBuffer({ duration: 10 });

function source(id: string, status: SourceStatus = 'ready'): AudioSource {
  return {
    id,
    fileName: `${id}.wav`,
    status,
    buffer: status === 'ready' ? buffer10 : null,
    peaks: null,
    refCount: 1,
  };
}

function clip(id: string, sourceId: string, s: number, o: number, d: number, f = [0, 0]): Clip {
  return { id, sourceId, startTime: s, sourceOffset: o, duration: d, fadeIn: f[0], fadeOut: f[1] };
}

function track(id: string, clips: Clip[], extra: Partial<Track> = {}): Track {
  return { id, name: id, volume: 0.5, muted: false, soloed: false, clips, ...extra };
}

function projectWith(tracks: Track[], sources: AudioSource[]): Project {
  const registry = createSourceRegistry();
  sources.forEach((s) => registry.add(s));
  const project = createEmptyProject('Test', registry, 'p');
  project.tracks = tracks;
  return project;
}

/** The start() calls of a log, without the node numbers. */
const starts = (log: string[]) =>
  log.filter((l) => l.includes('.start ')).map((l) => l.replace(/^src#\d+\./, ''));

/** Gain automation lines, without the node numbers. */
const automation = (log: string[]) =>
  log.filter((l) => /\.(set|ramp) /.test(l)).map((l) => l.replace(/^gain#\d+\./, ''));

describe('buildMix', () => {
  it('T2 clips before/across/after the playhead', () => {
    // Clips are {start, sourceOffset, duration}: X {3, 1, 4}, Y {8, 0, 2}, Z {1, 0, 3}.
    const project = projectWith(
      [
        track('tx', [clip('x', 'sx', 3, 1, 4)]),
        track('ty', [clip('y', 'sy', 8, 0, 2)]),
        track('tz', [clip('z', 'sz', 1, 0, 3)]),
      ],
      [source('sx'), source('sy'), source('sz')],
    );
    const ctx = createRecordingContext(10);

    buildMix(ctx, project, 5, 10.05, createDefaultEffects());

    // X is already playing (2 s in), Y starts 3 s from now, Z is over.
    expect(starts(ctx.log)).toEqual(['start 10.05 3 2', 'start 13.05 0 2']);
  });

  it('puts fade events at absolute times', () => {
    const project = projectWith([track('t', [clip('c', 's', 0, 0, 10, [2, 4])])], [source('s')]);
    const ctx = createRecordingContext();

    buildMix(ctx, project, 0, 1, createDefaultEffects());

    expect(automation(ctx.log)).toEqual(['set 0 @1', 'ramp 1 @3', 'set 1 @7', 'ramp 0 @11']);
  });

  it('starts from the right volume when seeking into a fade-in', () => {
    const project = projectWith([track('t', [clip('c', 's', 0, 0, 10, [2, 4])])], [source('s')]);
    const ctx = createRecordingContext();

    buildMix(ctx, project, 1, 1, createDefaultEffects());

    expect(automation(ctx.log)).toEqual(['set 0.5 @1', 'ramp 1 @2', 'set 1 @6', 'ramp 0 @10']);
    expect(starts(ctx.log)).toEqual(['start 1 1 9']);
  });

  it('starts from the right volume when seeking into a fade-out', () => {
    const project = projectWith([track('t', [clip('c', 's', 0, 0, 10, [2, 4])])], [source('s')]);
    const ctx = createRecordingContext();

    buildMix(ctx, project, 8, 1, createDefaultEffects());

    expect(automation(ctx.log)).toEqual(['set 0.5 @1', 'ramp 0 @3']);
  });

  it('sets track gains from mute and solo, and still schedules silent tracks', () => {
    const tracks = (soloA: boolean) => [
      track('a', [clip('ca', 's', 0, 0, 4)], { volume: 0.8, muted: !soloA, soloed: soloA }),
      track('b', [clip('cb', 's', 0, 0, 4)], { volume: 0.6 }),
    ];

    const muted = buildMix(
      createRecordingContext(),
      projectWith(tracks(false), [source('s')]),
      0,
      0,
      createDefaultEffects(),
    );
    expect(muted.trackGains.get('a')?.gain.value).toBe(0);
    expect(muted.trackGains.get('b')?.gain.value).toBe(0.6);
    expect(muted.players).toHaveLength(2); // the muted track is still scheduled

    const solo = buildMix(
      createRecordingContext(),
      projectWith(tracks(true), [source('s')]),
      0,
      0,
      createDefaultEffects(),
    );
    expect(solo.trackGains.get('a')?.gain.value).toBe(0.8);
    expect(solo.trackGains.get('b')?.gain.value).toBe(0);
  });

  it('skips clips whose source is loading or missing', () => {
    const project = projectWith(
      [
        track('t', [
          clip('ok', 'ready', 0, 0, 2),
          clip('l', 'loading', 2, 0, 2),
          clip('m', 'missing', 4, 0, 2),
          clip('none', 'unregistered', 6, 0, 2),
        ]),
      ],
      [source('ready'), source('loading', 'loading'), source('missing', 'missing')],
    );
    const ctx = createRecordingContext();

    const graph = buildMix(ctx, project, 0, 0, createDefaultEffects());

    expect(graph.players).toHaveLength(1);
    expect(starts(ctx.log)).toEqual(['start 0 0 2']);
  });

  it('keeps the master gain at 1', () => {
    const graph = buildMix(
      createRecordingContext(),
      projectWith([], []),
      0,
      0,
      createDefaultEffects(),
    );
    expect(graph.master.gain.value).toBe(1);
  });

  it('wires player → fade → track gain → master → destination (DS5)', () => {
    const project = projectWith([track('t', [clip('c', 's', 0, 0, 4)])], [source('s')]);
    const ctx = createRecordingContext();

    buildMix(ctx, project, 0, 0, createDefaultEffects());

    expect(ctx.log).toEqual([
      'gain#1 = 1', // master
      'connect gain#1 -> destination',
      'gain#2 = 0.5', // track
      'connect gain#2 -> gain#1',
      'src#3.buffer = 10s', // player
      'connect src#3 -> gain#4', // fade gain
      'gain#4.set 1 @0',
      'connect gain#4 -> gain#2',
      'src#3.start 0 0 4',
    ]);
  });

  it('runs every registered effect, in order', () => {
    const chain = (id: string): ClipEffect => ({
      id,
      apply(ctx: AudioContextLike, input) {
        const gain = ctx.createGain();
        input.connect(gain);
        return gain;
      },
    });
    const effects = new EffectRegistry();
    effects.register(chain('one'));
    effects.register(chain('two'));
    const project = projectWith([track('t', [clip('c', 's', 0, 0, 4)])], [source('s')]);
    const ctx = createRecordingContext();

    buildMix(ctx, project, 0, 0, effects);

    // player (src#3) → first effect (gain#4) → second effect (gain#5) → track gain (gain#2)
    expect(ctx.log.filter((l) => l.startsWith('connect'))).toEqual([
      'connect gain#1 -> destination',
      'connect gain#2 -> gain#1',
      'connect src#3 -> gain#4',
      'connect gain#4 -> gain#5',
      'connect gain#5 -> gain#2',
    ]);
  });

  it('builds the same graph every time (the basis of the preview = export test)', () => {
    const project = projectWith(
      [
        track('a', [clip('c1', 's', 0, 0, 4, [1, 1]), clip('c2', 's', 4, 2, 3, [0, 1])]),
        track('b', [clip('c3', 's', 1, 0, 5)], { muted: true }),
      ],
      [source('s')],
    );
    const first = createRecordingContext();
    const second = createRecordingContext();

    buildMix(first, project, 0, 0, createDefaultEffects());
    buildMix(second, project, 0, 0, createDefaultEffects());

    expect(first.log.length).toBeGreaterThan(10);
    expect(second.log).toEqual(first.log);
  });
});
