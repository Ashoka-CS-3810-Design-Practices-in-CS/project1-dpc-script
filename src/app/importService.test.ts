import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeakPyramid } from '@/algorithms/types';
import type { Change, EditService } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { createProjectStore } from '@/app/store';
import { decodeFile, type ImportMessages } from '@/io/decoder';
import { createStorage, StorageFullError } from '@/io/storage';
import { createEmptyProject } from '@/model/projectOps';
import { fail, ok } from '@/model/result';
import { createSourceRegistry } from '@/model/sourceRegistry';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';
import { createImportService, type ImportDeps } from './importService';

const msgs: ImportMessages = {
  unreadable: MSG.importUnreadable,
  tooLarge: MSG.importTooLarge,
  tooLong: MSG.importTooLong,
};
const pyramid: PeakPyramid = { sampleRate: 44100, blockSize: 256, length: 0, levels: [] };

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

const wav = () => new File(['x'], 'voice.wav', { type: 'audio/wav' });

describe('importFile', () => {
  it('stores the bytes, registers the source and adds a clip', async () => {
    const { service, registry, edit } = setup();

    const result = await service.importFile(wav(), 't1', 3);

    expect(result).toEqual({
      ok: true,
      value: { clipId: 'clip1', fileName: 'voice.wav', duration: 2 },
    });
    const [source] = registry.all();
    expect(source).toMatchObject({ fileName: 'voice.wav', status: 'ready', peaks: null });
    expect(edit.addClip).toHaveBeenCalledWith('t1', source.id, 2, 3);

    const stored = await storage.getSource(source.id);
    expect(stored).toMatchObject({ projectId: 'proj', fileName: 'voice.wav', type: 'audio/wav' });
    expect(new Uint8Array(stored!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('fills in the peaks later and announces them', async () => {
    const { service, registry, commits, peaks } = setup();
    await service.importFile(wav(), 't1', 0);
    const [source] = registry.all();
    expect(commits).toEqual([]); // nothing yet; the clip's own commit comes from addClip

    peaks.resolve(pyramid);
    await vi.waitFor(() => expect(commits).toEqual([{ kind: 'peaks', sourceId: source.id }]));
    expect(registry.get(source.id)?.peaks).toBe(pyramid);
  });

  it('ignores peaks for a source that has been removed meanwhile', async () => {
    const { service, registry, commits, peaks } = setup();
    await service.importFile(wav(), 't1', 0);
    const [source] = registry.all();
    registry.release(source.id); // refCount 0 → removed

    peaks.resolve(pyramid);
    await new Promise((r) => setTimeout(r, 0));
    expect(commits).toEqual([]);
  });

  it('keeps going when the peaks fail', async () => {
    const { service, registry, commits, peaks } = setup();
    await service.importFile(wav(), 't1', 0);

    peaks.reject(new Error('worker died'));
    await new Promise((r) => setTimeout(r, 0));
    expect(registry.all()[0].peaks).toBeNull();
    expect(commits).toEqual([]);
  });

  it('refuses without a valid track and does no work', async () => {
    const { service, decode } = setup();

    expect(await service.importFile(wav(), null, 0)).toEqual({
      ok: false,
      error: MSG.importNoTrack,
    });
    expect(await service.importFile(wav(), 'ghost', 0)).toEqual({
      ok: false,
      error: MSG.importNoTrack,
    });
    expect(decode).not.toHaveBeenCalled();
  });

  it('passes a decode failure straight back', async () => {
    const { service, registry } = setup({ decode: async () => fail('nope') });

    expect(await service.importFile(wav(), 't1', 0)).toEqual({ ok: false, error: 'nope' });
    expect(registry.all()).toEqual([]);
  });

  it('reports full storage and leaves the project alone', async () => {
    const full = { ...storage, putSource: () => Promise.reject(new StorageFullError()) };
    const { service, registry, edit } = setup({ storage: full });

    expect(await service.importFile(wav(), 't1', 0)).toEqual({ ok: false, error: MSG.storageFull });
    expect(registry.all()).toEqual([]);
    expect(edit.addClip).not.toHaveBeenCalled();
  });

  it('rethrows other storage errors', async () => {
    const broken = { ...storage, putSource: () => Promise.reject(new Error('disk on fire')) };
    const { service } = setup({ storage: broken });

    await expect(service.importFile(wav(), 't1', 0)).rejects.toThrow('disk on fire');
  });

  it('undoes everything when the clip cannot be added', async () => {
    const { service, registry, edit, computePeaks } = setup();
    edit.addClip.mockReturnValue(fail(MSG.editOverlap) as never);

    const result = await service.importFile(wav(), 't1', 0);

    expect(result).toEqual({ ok: false, error: MSG.editOverlap });
    expect(registry.all()).toEqual([]);
    expect(await storage.sourceIdsForProject('proj')).toEqual([]);
    expect(computePeaks).not.toHaveBeenCalled();
  });
});

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

describe('pickAndImport', () => {
  it('checks the track before opening the picker', async () => {
    const { service, pickFile } = setup();

    expect(await service.pickAndImport(null, 0)).toEqual({ ok: false, error: MSG.importNoTrack });
    expect(pickFile).not.toHaveBeenCalled();
  });

  it('returns null when the picker is cancelled', async () => {
    const { service, decode } = setup({ pickFile: async () => null });

    expect(await service.pickAndImport('t1', 0)).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it('imports the picked file', async () => {
    const { service } = setup();

    const result = await service.pickAndImport('t1', 1);
    expect(result).toMatchObject({ ok: true, value: { fileName: 'picked.wav' } });
  });
});
