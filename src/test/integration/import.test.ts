import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditService } from '@/app/editService';
import { createImportService } from '@/app/importService';
import { MSG } from '@/app/messages';
import { createProjectStore } from '@/app/store';
import { decodeFile, type DecodeContext } from '@/io/decoder';
import { createStorage, StorageFullError, type StorageAdapter } from '@/io/storage';
import { MAX_DURATION_S, MAX_FILE_BYTES } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { toJson } from '@/model/serializer';
import { createSourceRegistry } from '@/model/sourceRegistry';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

const MESSAGES = {
  unreadable: MSG.importUnreadable,
  tooLarge: MSG.importTooLarge,
  tooLong: MSG.importTooLong,
};
const realStorage = createStorage();
const noPeaks = async () => ({ sampleRate: 44100, blockSize: 256, length: 0, levels: [] });

const wav = (name = 'voice.wav') => new File([new Uint8Array(64)], name, { type: 'audio/wav' });

type DecodeAudioData = DecodeContext['decodeAudioData'];

/** Real store, EditService, storage and decodeFile; only the browser's decoder is a stand-in. */
function setup(decodeAudioData: DecodeAudioData, storage: StorageAdapter = realStorage) {
  const store = createProjectStore(createEmptyProject('p', createSourceRegistry(), 'proj'));
  const edit = createEditService(store);
  const computePeaks = vi.fn(noPeaks);
  const importer = createImportService({
    store,
    edit,
    storage,
    decode: (file) => decodeFile(file, { decodeAudioData }, MESSAGES),
    computePeaks,
    pickFile: async () => null,
  });
  const track = edit.addTrack();
  return { store, importer, track, computePeaks };
}

/** Everything an import could touch: the project, the registry and the stored files. */
async function snapshot({ store }: ReturnType<typeof setup>) {
  return {
    project: toJson(store.get()),
    sources: store
      .get()
      .sources.all()
      .map((s) => [s.id, s.refCount]),
    version: store.version(),
    stored: await realStorage.sourceIdsForProject('proj'),
  };
}

/** A project that already has a clip, so "unchanged" means more than "still empty". */
async function withExistingClip(app: ReturnType<typeof setup>) {
  const good = createImportService({
    store: app.store,
    edit: createEditService(app.store),
    storage: realStorage,
    decode: (file) =>
      decodeFile(file, { decodeAudioData: async () => fakeAudioBuffer({ duration: 2 }) }, MESSAGES),
    computePeaks: noPeaks,
    pickFile: async () => null,
  });
  const r = await good.importFile(wav('first.wav'), app.track, 0);
  if (!r.ok) throw new Error(r.error);
}

describe('import', () => {
  afterEach(async () => {
    await realStorage.deleteSourcesNotIn([]);
  });

  it('a good file adds one clip, one source and one stored copy', async () => {
    const app = setup(async () => fakeAudioBuffer({ duration: 3 }));
    const r = await app.importer.importFile(wav(), app.track, 1);
    expect(r.ok && r.value).toMatchObject({ fileName: 'voice.wav', duration: 3 });

    const track = app.store.get().tracks[0];
    expect(track.clips).toHaveLength(1);
    expect(track.clips[0]).toMatchObject({ startTime: 1, duration: 3, sourceOffset: 0 });
    const [source] = app.store.get().sources.all();
    expect(source).toMatchObject({ fileName: 'voice.wav', status: 'ready', refCount: 1 });
    expect(await realStorage.sourceIdsForProject('proj')).toEqual([source.id]);
    await vi.waitFor(() => expect(app.store.get().sources.get(source.id)?.peaks).not.toBeNull());
  });

  describe('a failed import leaves the project, registry and storage exactly as they were', () => {
    const cases: Array<
      [string, () => File | { name: string; size: number }, DecodeAudioData, string]
    > = [
      [
        'a decoder that rejects',
        () => wav(),
        () => Promise.reject(new Error('bad data')),
        MSG.importUnreadable('voice.wav'),
      ],
      [
        'audio with no samples',
        () => wav(),
        async () => fakeAudioBuffer({ duration: 0 }),
        MSG.importUnreadable('voice.wav'),
      ],
      [
        'a wrong file type',
        () => wav('notes.txt'),
        async () => fakeAudioBuffer({ duration: 1 }),
        MSG.importUnreadable('notes.txt'),
      ],
      [
        'a file over 200 MB',
        () => ({ name: 'big.wav', size: MAX_FILE_BYTES + 1 }),
        async () => fakeAudioBuffer({ duration: 1 }),
        MSG.importTooLarge('big.wav'),
      ],
      [
        'audio over 30 minutes',
        () => wav('long.mp3'),
        async () =>
          ({ duration: MAX_DURATION_S + 1, length: 1, numberOfChannels: 1 }) as AudioBuffer,
        MSG.importTooLong('long.mp3'),
      ],
    ];

    it.each(cases)('%s', async (_name, makeFile, decodeAudioData, message) => {
      const app = setup(decodeAudioData);
      await withExistingClip(app);
      const before = await snapshot(app);

      const r = await app.importer.importFile(makeFile() as File, app.track, 0);

      expect(r).toEqual({ ok: false, error: message });
      expect(await snapshot(app)).toEqual(before);
      expect(app.computePeaks).not.toHaveBeenCalled();
    });

    it('no track to put it on', async () => {
      const app = setup(async () => fakeAudioBuffer({ duration: 1 }));
      const before = await snapshot(app);
      const noTrack = { ok: false, error: MSG.importNoTrack };
      expect(await app.importer.importFile(wav(), null, 0)).toEqual(noTrack);
      expect(await app.importer.importFile(wav(), 'no-such-track', 0)).toEqual(noTrack);
      expect(await snapshot(app)).toEqual(before);
    });

    it('storage full', async () => {
      const full: StorageAdapter = {
        ...realStorage,
        putSource: () => Promise.reject(new StorageFullError()),
      };
      const app = setup(async () => fakeAudioBuffer({ duration: 1 }), full);
      const before = await snapshot(app);
      expect(await app.importer.importFile(wav(), app.track, 0)).toEqual({
        ok: false,
        error: MSG.storageFull,
      });
      expect(await snapshot(app)).toEqual(before);
    });
  });

  it('a failed import does not stop the next good one', async () => {
    let calls = 0;
    const app = setup(async () => {
      if (++calls === 1) throw new Error('bad data');
      return fakeAudioBuffer({ duration: 2 });
    });
    expect((await app.importer.importFile(wav(), app.track, 0)).ok).toBe(false);
    expect((await app.importer.importFile(wav(), app.track, 0)).ok).toBe(true);
    expect(app.store.get().tracks[0].clips).toHaveLength(1);
  });
});
