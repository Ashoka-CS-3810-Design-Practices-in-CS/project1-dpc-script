import { describe, expect, it } from 'vitest';
import { MSG } from '@/app/messages';
import { SAMPLE_RATE } from '@/model/constants';
import { createEmptyProject } from './projectOps';
import {
  parseProject,
  toJson,
  type ClipJson,
  type ParseMessages,
  type ProjectJson,
} from './serializer';
import { createSourceRegistry } from './sourceRegistry';
import type { Clip, Project } from './types';

const msgs: ParseMessages = { damaged: MSG.projectDamaged, volumeClamped: MSG.volumeClamped };

const clip = (
  id: string,
  sourceId: string,
  startTime: number,
  extra: Partial<Clip> = {},
): Clip => ({
  id,
  sourceId,
  startTime,
  sourceOffset: 0,
  duration: 4,
  fadeIn: 0,
  fadeOut: 0,
  ...extra,
});

function sampleProject(): Project {
  const sources = createSourceRegistry();
  for (const id of ['s1', 's2', 'unused']) {
    sources.add({
      id,
      fileName: `${id}.wav`,
      status: 'ready',
      buffer: null,
      peaks: null,
      refCount: 1,
    });
  }
  const project = createEmptyProject('Demo', sources, 'p1');
  project.tracks = [
    {
      id: 't1',
      name: 'Drums',
      volume: 0.5,
      muted: true,
      soloed: false,
      // one source split into two pieces, with fades
      clips: [
        clip('c1', 's1', 0, { duration: 3, fadeIn: 1 }),
        clip('c2', 's1', 3, { sourceOffset: 3, duration: 5, fadeOut: 2 }),
      ],
    },
    {
      id: 't2',
      name: 'Bass',
      volume: 1,
      muted: false,
      soloed: true,
      clips: [clip('c3', 's2', 2)],
    },
  ];
  return project;
}

/** A small valid project as plain data, for tests to break one field at a time. */
function validJson(): ProjectJson {
  return {
    version: 1,
    id: 'p1',
    name: 'Demo',
    sampleRate: SAMPLE_RATE,
    tracks: [
      {
        id: 't1',
        name: 'Track 1',
        volume: 0.5,
        muted: false,
        soloed: false,
        clips: [clip('c1', 's1', 0)],
      },
    ],
    sources: [{ id: 's1', fileName: 's1.wav' }],
  };
}

const parse = (data: unknown) => parseProject(JSON.stringify(data), msgs);
const damaged = { ok: false, error: MSG.projectDamaged };

/** Parse `validJson()` after `change` has altered it. */
function parseChanged(change: (json: ProjectJson) => void) {
  const json = validJson();
  change(json);
  return parse(json);
}

describe('toJson', () => {
  it('keeps only sources that a clip uses', () => {
    expect(toJson(sampleProject()).sources).toEqual([
      { id: 's1', fileName: 's1.wav' },
      { id: 's2', fileName: 's2.wav' },
    ]);
  });

  it('throws if a clip points at a source the registry lacks', () => {
    const project = sampleProject();
    project.tracks[0].clips.push(clip('c9', 'ghost', 20));
    expect(() => toJson(project)).toThrow('ghost');
  });
});

describe('round trip', () => {
  it('toJson → JSON.stringify → parseProject gives the same data', () => {
    const json = toJson(sampleProject());
    const result = parseProject(JSON.stringify(json), msgs);

    expect(result).toEqual({ ok: true, value: json });
  });
});

describe('invalid projects (A3 Table 2)', () => {
  it('rejects cut-off text', () => {
    const text = JSON.stringify(validJson());
    expect(parseProject(text.slice(0, text.length / 2), msgs)).toEqual(damaged);
  });

  it('rejects a version we do not know', () => {
    expect(parseChanged((j) => ((j as { version: number }).version = 99))).toEqual(damaged);
  });

  it('rejects a missing tracks field, but allows an empty one', () => {
    expect(parseChanged((j) => delete (j as Partial<ProjectJson>).tracks)).toEqual(damaged);
    expect(parseChanged((j) => (j.tracks = [])).ok).toBe(true);
  });

  it('rejects two clips at [0, 4)', () => {
    const result = parseChanged((j) => j.tracks[0].clips.push(clip('c2', 's1', 0)));
    expect(result).toEqual(damaged);
  });

  it.each([['null'], ['[]'], ['42'], ['"text"']])('rejects %s', (text) => {
    expect(parseProject(text, msgs)).toEqual(damaged);
  });

  it.each([
    ['empty id', (j: ProjectJson) => (j.id = '')],
    ['empty name', (j: ProjectJson) => (j.name = '')],
    ['zero sample rate', (j: ProjectJson) => (j.sampleRate = 0)],
    ['text sample rate', (j: ProjectJson) => ((j as { sampleRate: unknown }).sampleRate = '44100')],
    ['track that is not an object', (j: ProjectJson) => (j.tracks = [7 as never])],
    ['track id that is not text', (j: ProjectJson) => ((j.tracks[0] as { id: unknown }).id = 1)],
    ['text volume', (j: ProjectJson) => ((j.tracks[0] as { volume: unknown }).volume = '1')],
    [
      'muted that is not a boolean',
      (j: ProjectJson) => ((j.tracks[0] as { muted: unknown }).muted = 0),
    ],
    [
      'soloed that is not a boolean',
      (j: ProjectJson) => ((j.tracks[0] as { soloed: unknown }).soloed = 0),
    ],
    [
      'clips that is not a list',
      (j: ProjectJson) => ((j.tracks[0] as { clips: unknown }).clips = {}),
    ],
    ['clip that is not an object', (j: ProjectJson) => (j.tracks[0].clips = [null as never])],
    [
      'clip id that is not text',
      (j: ProjectJson) => ((j.tracks[0].clips[0] as { id: unknown }).id = 1),
    ],
    [
      'clip with a text start time',
      (j: ProjectJson) => ((j.tracks[0].clips[0] as { startTime: unknown }).startTime = 'x'),
    ],
    [
      'clip with a text fade',
      (j: ProjectJson) => ((j.tracks[0].clips[0] as { fadeIn: unknown }).fadeIn = 'x'),
    ],
    ['negative start time', (j: ProjectJson) => (j.tracks[0].clips[0].startTime = -1)],
    ['negative source offset', (j: ProjectJson) => (j.tracks[0].clips[0].sourceOffset = -1)],
    ['negative fade', (j: ProjectJson) => (j.tracks[0].clips[0].fadeOut = -1)],
    ['clip shorter than 50 ms', (j: ProjectJson) => (j.tracks[0].clips[0].duration = 0.01)],
    [
      'fades much longer than the clip',
      (j: ProjectJson) => Object.assign(j.tracks[0].clips[0], { fadeIn: 3, fadeOut: 3 }),
    ],
    ['clip using an unlisted source', (j: ProjectJson) => (j.sources = [])],
    [
      'sources that is not a list',
      (j: ProjectJson) => ((j as { sources: unknown }).sources = null),
    ],
    ['source without a file name', (j: ProjectJson) => (j.sources = [{ id: 's1' } as never])],
  ])('rejects %s', (_label, change) => {
    expect(parseChanged(change)).toEqual(damaged);
  });
});

describe('fixing small problems', () => {
  it('allows clips that touch', () => {
    expect(parseChanged((j) => j.tracks[0].clips.push(clip('c2', 's1', 4))).ok).toBe(true);
  });

  it('shrinks fades that overshoot by under one sample', () => {
    const overshoot = 0.5 / SAMPLE_RATE;
    const result = parseChanged((j) =>
      Object.assign(j.tracks[0].clips[0], { fadeIn: 2, fadeOut: 2 + overshoot }),
    );

    expect(result.ok).toBe(true);
    const fixed = (result as { value: ProjectJson }).value.tracks[0].clips[0] as ClipJson;
    expect(fixed.fadeIn + fixed.fadeOut).toBeCloseTo(4, 12);
    expect(fixed.fadeIn).toBeLessThan(2);
  });

  it('clamps volumes to 0–1 and warns (A3 Table 1)', () => {
    const result = parseChanged((j) => {
      j.tracks.push({ ...j.tracks[0], id: 't2', name: 'Loud', volume: 1.2, clips: [] });
      j.tracks[0].name = 'Quiet';
      j.tracks[0].volume = -0.1;
    });

    expect(result).toMatchObject({ ok: true });
    const { value, warnings } = result as { value: ProjectJson; warnings: string[] };
    expect(value.tracks.map((t) => t.volume)).toEqual([0, 1]);
    expect(warnings).toEqual([MSG.volumeClamped('Quiet', '0'), MSG.volumeClamped('Loud', '1')]);
  });
});
