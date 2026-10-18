import { describe, expect, it, vi } from 'vitest';
import { encodeWav } from '@/algorithms/wav';
import type { ExportProgress, ExportSettings } from '@/app/contracts';
import { createExportService, type ExportDeps } from '@/app/exportService';
import { MSG } from '@/app/messages';
import { createProjectStore } from '@/app/store';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { SourceStatus } from '@/model/types';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

const settings = (patch: Partial<ExportSettings> = {}): ExportSettings => ({
  fileName: 'mix',
  sampleRate: 44100,
  channels: 2,
  ...patch,
});

interface ProjectOptions {
  status?: SourceStatus;
  volume?: number;
  muted?: boolean;
  clips?: boolean;
}

function makeStore({
  status = 'ready',
  volume = 1,
  muted = false,
  clips = true,
}: ProjectOptions = {}) {
  const sources = createSourceRegistry();
  sources.add({
    id: 's',
    fileName: 's.wav',
    status,
    buffer: status === 'ready' ? fakeAudioBuffer({ duration: 2 }) : null,
    peaks: null,
    refCount: 1,
  });
  const project = createEmptyProject('p', sources);
  project.tracks.push({
    id: 't',
    name: 'T',
    volume,
    muted,
    soloed: false,
    clips: clips
      ? [
          {
            id: 'c',
            sourceId: 's',
            startTime: 0,
            sourceOffset: 0,
            duration: 2,
            fadeIn: 0,
            fadeOut: 0,
          },
        ]
      : [],
  });
  return createProjectStore(project);
}

function setup(options: ProjectOptions = {}, overrides: Partial<ExportDeps> = {}) {
  const store = makeStore(options);
  const downloads: Array<{ blob: Blob; fileName: string }> = [];
  const deps: ExportDeps = {
    store,
    render: async (_project, rate, channels) =>
      fakeAudioBuffer({ duration: 2, sampleRate: rate, channels, fill: () => 0.25 }),
    encode: async (channels, rate, onProgress) => {
      const result = encodeWav(channels, rate, onProgress);
      return result;
    },
    download: (blob, fileName) => void downloads.push({ blob, fileName }),
    ...overrides,
  };
  return { service: createExportService(deps), downloads, store };
}

const noProgress = () => {};

describe('export service: check', () => {
  it('accepts a normal project and name', () => {
    expect(setup().service.check(settings()).ok).toBe(true);
  });

  it.each(['', '   ', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b'])(
    'rejects the file name %j',
    (fileName) => {
      expect(setup().service.check(settings({ fileName }))).toEqual({
        ok: false,
        error: MSG.exportBadName,
      });
    },
  );

  it('rejects a project with no clips', () => {
    expect(setup({ clips: false }).service.check(settings())).toEqual({
      ok: false,
      error: MSG.nothingToExport,
    });
  });

  it('ignores clips whose audio is not loaded', () => {
    expect(setup({ status: 'missing' }).service.check(settings())).toEqual({
      ok: false,
      error: MSG.nothingToExport,
    });
    expect(setup({ status: 'loading' }).service.check(settings()).ok).toBe(false);
  });

  it('rejects when every track with audio is silent', () => {
    const muted = { ok: false, error: MSG.everythingMuted };
    expect(setup({ muted: true }).service.check(settings())).toEqual(muted);
    expect(setup({ volume: 0 }).service.check(settings())).toEqual(muted);
  });

  it('is fine if only some tracks are silent', () => {
    const { service, store } = setup();
    const project = store.get();
    project.tracks.push({ ...project.tracks[0], id: 't2', muted: true });
    expect(service.check(settings()).ok).toBe(true);
  });
});

describe('export service: estimateBytes', () => {
  it('is 6 bytes per sample per channel', () => {
    const { service } = setup();
    expect(service.estimateBytes(settings())).toBe(6 * 88200 * 2);
    expect(service.estimateBytes(settings({ sampleRate: 48000, channels: 1 }))).toBe(6 * 96000);
  });
});

describe('export service: export', () => {
  it('renders, encodes and downloads a .wav, reporting progress', async () => {
    const { service, downloads } = setup();
    const progress: ExportProgress[] = [];
    const result = await service.export(
      settings(),
      (p) => progress.push(p),
      new AbortController().signal,
    );

    expect(result).toEqual({
      ok: true,
      value: { fileName: 'mix.wav', duration: 2, bytes: 44 + 2 * 88200 * 2 },
    });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].fileName).toBe('mix.wav');
    expect(downloads[0].blob.type).toBe('audio/wav');
    expect(downloads[0].blob.size).toBe(44 + 2 * 88200 * 2);
    expect(Number.isNaN(progress[0].fraction)).toBe(true);
    expect(progress[0].phase).toBe('render');
    expect(progress.at(-1)).toEqual({ phase: 'encode', fraction: 1 });
  });

  it('a one-sample mix is a valid WAV of 44 + 2·ch bytes', async () => {
    for (const channels of [1, 2] as const) {
      const { service, downloads } = setup(
        {},
        {
          render: async (_p, rate, ch) =>
            fakeAudioBuffer({ duration: 1 / rate, sampleRate: rate, channels: ch }),
        },
      );
      await service.export(settings({ channels }), noProgress, new AbortController().signal);
      expect(downloads[0].blob.size).toBe(44 + 2 * channels);
    }
  });

  it('does not add .wav twice, in any letter case, and trims the name', async () => {
    const { service, downloads } = setup();
    const signal = new AbortController().signal;
    await service.export(settings({ fileName: 'song.wav' }), noProgress, signal);
    await service.export(settings({ fileName: 'Song.WAV' }), noProgress, signal);
    await service.export(settings({ fileName: '  take 2  ' }), noProgress, signal);
    expect(downloads.map((d) => d.fileName)).toEqual(['song.wav', 'Song.WAV', 'take 2.wav']);
  });

  it('a failed check downloads nothing and does not render', async () => {
    const render = vi.fn();
    const { service, downloads } = setup({ clips: false }, { render });
    const result = await service.export(settings(), noProgress, new AbortController().signal);
    expect(result).toEqual({ ok: false, error: MSG.nothingToExport });
    expect(render).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('cancelling during the render downloads nothing', async () => {
    const controller = new AbortController();
    const encode = vi.fn();
    const { service, downloads } = setup(
      {},
      {
        render: async () => {
          controller.abort();
          return fakeAudioBuffer({ duration: 1 });
        },
        encode,
      },
    );
    const result = await service.export(settings(), noProgress, controller.signal);
    expect(result).toEqual({ ok: false, error: MSG.exportCancelled });
    expect(encode).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('cancelling during the encode downloads nothing', async () => {
    const controller = new AbortController();
    const { service, downloads } = setup(
      {},
      {
        encode: async () => {
          controller.abort();
          throw new DOMException('Aborted', 'AbortError');
        },
      },
    );
    const result = await service.export(settings(), noProgress, controller.signal);
    expect(result).toEqual({ ok: false, error: MSG.exportCancelled });
    expect(downloads).toEqual([]);
  });

  it('an encoder that finishes after the abort still downloads nothing', async () => {
    const controller = new AbortController();
    const { service, downloads } = setup(
      {},
      {
        encode: async (channels, rate) => {
          controller.abort();
          return encodeWav(channels, rate);
        },
      },
    );
    const result = await service.export(settings(), noProgress, controller.signal);
    expect(result).toEqual({ ok: false, error: MSG.exportCancelled });
    expect(downloads).toEqual([]);
  });

  it('a RangeError or an out-of-memory error → exportNoMemory', async () => {
    for (const error of [
      new RangeError('Array buffer allocation failed'),
      new Error('Out of memory'),
    ]) {
      const { service, downloads } = setup({}, { render: () => Promise.reject(error) });
      const result = await service.export(settings(), noProgress, new AbortController().signal);
      expect(result).toEqual({ ok: false, error: MSG.exportNoMemory });
      expect(downloads).toEqual([]);
    }
  });

  it('any other error → exportFailed with its message', async () => {
    for (const [thrown, reason] of [
      [new Error('boom'), 'boom'],
      ['plain text', 'plain text'],
    ] as const) {
      const { service, downloads } = setup({}, { encode: () => Promise.reject(thrown) });
      const result = await service.export(settings(), noProgress, new AbortController().signal);
      expect(result).toEqual({ ok: false, error: MSG.exportFailed(reason) });
      expect(downloads).toEqual([]);
    }
  });

  it('warns when samples were limited', async () => {
    const { service } = setup(
      {},
      {
        render: async (_p, rate, channels) =>
          fakeAudioBuffer({ duration: 0.01, sampleRate: rate, channels, fill: () => 1.5 }),
      },
    );
    const result = await service.export(settings(), noProgress, new AbortController().signal);
    expect(result.ok && result.warnings).toEqual([MSG.exportClipped]);
  });

  it('has no warning when nothing was limited', async () => {
    const result = await setup().service.export(
      settings(),
      noProgress,
      new AbortController().signal,
    );
    expect(result.ok && result.warnings).toBeUndefined();
  });
});
