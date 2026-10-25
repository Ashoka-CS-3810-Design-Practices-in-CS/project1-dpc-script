import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeakPyramid } from '@/algorithms/types';
import type { Change, EditService } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { createProjectStore } from '@/app/store';
import { decodeFile, type ImportMessages } from '@/io/decoder';
import { createStorage } from '@/io/storage';
import { createEmptyProject } from '@/model/projectOps';
import { ok } from '@/model/result';
import { createSourceRegistry } from '@/model/sourceRegistry';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';
import { createImportService, type ImportDeps } from './importService';

const msgs: ImportMessages = {
  unreadable: MSG.importUnreadable,
  tooLarge: MSG.importTooLarge,
  tooLong: MSG.importTooLong,
};

const storage = createStorage();
afterEach(() => storage.deleteSourcesNotIn([]));

/** A project with one track "t1", real registry and storage, and fakes for the rest. */
function setup(overrides: Partial<ImportDeps> = {}) {
  const registry = createSourceRegistry();
  const store = createProjectStore(createEmptyProject('Test', registry, 'proj'));
  store.get().tracks.push({
    id: 't1',
    name: 'Track 1',
    volume: 1,
    muted: false,
    soloed: false,
    clips: [],
  });
  const commits: Change[] = [];
  store.subscribe((c) => commits.push(c));

  const edit = { addClip: vi.fn(() => ok('clip1')) };
  const peaks: { resolve: (p: PeakPyramid) => void; reject: (e: unknown) => void } = {
    resolve: () => {},
    reject: () => {},
  };
  const computePeaks = vi.fn(
    () =>
      new Promise<PeakPyramid>((resolve, reject) => {
        peaks.resolve = resolve;
        peaks.reject = reject;
      }),
  );
  const decode = vi.fn(async () =>
    ok({ buffer: fakeAudioBuffer({ duration: 2 }), bytes: new Uint8Array([1, 2, 3]).buffer }),
  );
  const pickFile = vi.fn(async () => new File(['x'], 'picked.wav', { type: 'audio/wav' }));

  const service = createImportService({
    store,
    edit: edit as unknown as EditService,
    storage,
    decode,
    computePeaks,
    pickFile,
    ...overrides,
  });
  return { service, registry, store, commits, edit, computePeaks, peaks, decode, pickFile };
}

describe('T4 invalid imports leave project unchanged', () => {
  /** The real decoder, with a fake browser decoder underneath. */
  function realDecoder(decodeAudioData: (data: ArrayBuffer) => Promise<AudioBuffer>) {
    return (file: File) => decodeFile(file, { decodeAudioData }, msgs);
  }

  async function expectUnchanged(
    t: ReturnType<typeof setup>,
    file: File,
    message: string,
  ): Promise<void> {
    expect(await t.service.importFile(file, 't1', 0)).toEqual({ ok: false, error: message });
    expect(t.registry.all()).toEqual([]);
    expect(await storage.sourceIdsForProject('proj')).toEqual([]);
    expect(t.commits).toEqual([]);
    expect(t.edit.addClip).not.toHaveBeenCalled();
  }

  it('(a) a text file named notes.wav', async () => {
    const t = setup({ decode: realDecoder(() => Promise.reject(new Error('cannot decode'))) });
    await expectUnchanged(t, new File(['hello'], 'notes.wav'), MSG.importUnreadable('notes.wav'));
  });

  it('(b) an empty .mp3', async () => {
    const t = setup({ decode: realDecoder(() => Promise.reject(new Error('cannot decode'))) });
    await expectUnchanged(t, new File([], 'empty.mp3'), MSG.importUnreadable('empty.mp3'));
  });

  it('(c) a 250 MB .wav is rejected before it is read', async () => {
    const decodeAudioData = vi.fn();
    const arrayBuffer = vi.fn();
    const t = setup({ decode: realDecoder(decodeAudioData) });
    const huge = { name: 'big.wav', size: 250 * 1024 * 1024, arrayBuffer } as unknown as File;

    await expectUnchanged(t, huge, MSG.importTooLarge('big.wav'));
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it('(d) a 40-minute .mp3', async () => {
    const forty = { length: 2400 * 44100, duration: 2400, sampleRate: 44100 } as AudioBuffer;
    const t = setup({ decode: realDecoder(() => Promise.resolve(forty)) });
    await expectUnchanged(t, new File(['x'], 'long.mp3'), MSG.importTooLong('long.mp3'));
  });
});
