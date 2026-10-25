import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditService } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { createProjectService } from '@/app/projectService';
import { createProjectStore } from '@/app/store';
import { createStorage, StorageFullError, type StorageAdapter } from '@/io/storage';
import { AUTOSAVE_MS } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { Clip, Project } from '@/model/types';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

const clip = (
  id: string,
  sourceId: string,
  startTime: number,
  extra: Partial<Clip> = {},
): Clip => ({
  id,
  sourceId,
  startTime,
  sourceOffset: 0.5,
  duration: 2,
  fadeIn: 0.25,
  fadeOut: 0.75,
  ...extra,
});

/** Source ids → the byte that tells the fake decoder which file it was given. */
const BYTE: Record<string, number> = { a: 1, b: 2, c: 3 };
const bytesOf = (sourceId: string) => new Uint8Array([BYTE[sourceId]]).buffer;

/** Two tracks; source `a` is used twice (a split clip), `b` once. Everything non-default. */
function sampleProject(): Project {
  const sources = createSourceRegistry();
  for (const [id, refCount] of [
    ['a', 2],
    ['b', 1],
  ] as const) {
    sources.add({
      id,
      fileName: `${id}.wav`,
      status: 'ready',
      buffer: null,
      peaks: null,
      refCount,
    });
  }
  const project = createEmptyProject('My mix', sources, 'project-1');
  project.tracks.push(
    {
      id: 't1',
      name: 'Drums',
      volume: 0.8,
      muted: false,
      soloed: true,
      clips: [clip('c1', 'a', 0), clip('c2', 'a', 3, { sourceOffset: 2.5 })],
    },
    {
      id: 't2',
      name: 'Bass',
      volume: 0.3,
      muted: true,
      soloed: false,
      clips: [clip('c3', 'b', 1)],
    },
  );
  return project;
}

/** Real storage and store; decoding and peaks are fakes that record what they were asked. */
function setup(initial: Project = createEmptyProject('Untitled project', createSourceRegistry())) {
  const storage = createStorage();
  const store = createProjectStore(initial);
  const decoded: number[] = [];
  const deleted: string[] = [];
  const edit = {
    deleteTrack: vi.fn((id: string) => {
      const project = store.get();
      const track = project.tracks.find((t) => t.id === id)!;
      track.clips.forEach((c) => project.sources.release(c.sourceId));
      project.tracks = project.tracks.filter((t) => t.id !== id);
      store.commit({ kind: 'structure' });
      deleted.push(id);
    }),
  };
  const computePeaks = vi.fn(async () => ({
    sampleRate: 44100,
    blockSize: 256,
    length: 0,
    levels: [],
  }));
  const service = createProjectService({
    store,
    storage,
    edit: edit as unknown as EditService,
    decode: async (bytes) => {
      decoded.push(new Uint8Array(bytes)[0]);
      return fakeAudioBuffer({ duration: 5 });
    },
    computePeaks,
  });
  return { service, store, storage, decoded, deleted, edit, computePeaks };
}

async function storeSources(storage: StorageAdapter, projectId: string, ids: string[]) {
  for (const id of ids) {
    await storage.putSource({
      id,
      projectId,
      fileName: `${id}.wav`,
      type: 'audio/wav',
      bytes: bytesOf(id),
    });
  }
}

async function wipe(storage: StorageAdapter) {
  for (const p of await storage.listProjects()) await storage.deleteProject(p.id);
  await storage.deleteSourcesNotIn([]);
}

describe('project service', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await wipe(createStorage());
  });

  describe('save and open', () => {
    it.each([
      [{ a: 0, b: 1, c: 10 }, ['a', 'b', 'c']],
      [{ a: 2, b: 5, c: 0 }, ['c', 'a', 'b']],
    ])('decodes in timeline order: the earliest clip first (%j)', async (starts, order) => {
      const sources = createSourceRegistry();
      const project = createEmptyProject('p', sources, 'project-1');
      for (const [id, startTime] of Object.entries(starts)) {
        sources.add({
          id,
          fileName: `${id}.wav`,
          status: 'ready',
          buffer: null,
          peaks: null,
          refCount: 1,
        });
        project.tracks.push({
          id: `t-${id}`,
          name: id,
          volume: 1,
          muted: false,
          soloed: false,
          clips: [clip(`clip-${id}`, id, startTime)],
        });
      }
      const { service, storage, decoded } = setup(project);
      await storeSources(storage, 'project-1', ['a', 'b', 'c']);
      await service.save();
      await service.open('project-1');
      await vi.waitFor(() => expect(decoded).toHaveLength(3));
      expect(decoded).toEqual(order.map((id) => BYTE[id]));
    });

    it('marks audio that is not in storage as missing, warns, and the rest still loads', async () => {
      const { service, store, storage } = setup(sampleProject());
      await storeSources(storage, 'project-1', ['a']); // b is missing
      await service.save();

      const opened = await service.open('project-1');
      expect(opened).toEqual({
        ok: true,
        value: undefined,
        warnings: [MSG.missingAudioWarning(1)],
      });
      expect(store.get().sources.get('b')?.status).toBe('missing');
      expect(store.get().tracks).toHaveLength(2); // the clips are still there
      await vi.waitFor(() => expect(store.get().sources.get('a')?.status).toBe('ready'));
      expect(store.get().sources.get('b')?.status).toBe('missing');
    });

    it('opens a damaged file, a newer version and a missing record with projectDamaged', async () => {
      const { service, store, storage } = setup(sampleProject());
      const current = store.get();
      for (const json of ['{"version":1,"id":', '{"version":99,"id":"x","name":"x"}', '"text"']) {
        await storage.putProject({ id: 'bad', name: 'bad', updatedAt: 1, duration: 0, json });
        expect(await service.open('bad')).toEqual({ ok: false, error: MSG.projectDamaged });
        expect(store.get()).toBe(current); // the open project is untouched
      }
      expect(await service.open('nope')).toEqual({ ok: false, error: MSG.projectDamaged });
      expect(store.get()).toBe(current);
    });
  });

  describe('save', () => {
    it('storage full → storageFull and the project stays unsaved', async () => {
      const real = createStorage();
      const store = createProjectStore(sampleProject());
      const service = createProjectService({
        store,
        storage: { ...real, putProject: () => Promise.reject(new StorageFullError()) },
        edit: {} as EditService,
        decode: async () => fakeAudioBuffer({ duration: 1 }),
        computePeaks: async () => ({ sampleRate: 1, blockSize: 1, length: 0, levels: [] }),
      });
      store.commit({ kind: 'mix' });
      expect(await service.save()).toEqual({ ok: false, error: MSG.storageFull });
      expect(store.isDirty()).toBe(true);
    });

    it('stays unsaved if the project was edited while it was being written', async () => {
      const { service, store } = setup(sampleProject());
      const saving = service.save();
      store.commit({ kind: 'structure' });
      await saving;
      expect(store.isDirty()).toBe(true);
    });
  });

  describe('autosave', () => {
    // A storage that is just a spy: IndexedDB would hang under fake timers.
    function autosaveSetup(putProject = vi.fn(async () => {})) {
      const storage = {
        putProject,
        listProjects: async () => [],
        deleteSourcesNotIn: async () => {},
        sourceIdsForProject: async () => [],
      } as unknown as StorageAdapter;
      const store = createProjectStore(createEmptyProject('p', createSourceRegistry()));
      const service = createProjectService({
        store,
        storage,
        edit: {} as EditService,
        decode: async () => fakeAudioBuffer({ duration: 1 }),
        computePeaks: async () => ({ sampleRate: 1, blockSize: 1, length: 0, levels: [] }),
      });
      return { service, store, putProject };
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('saves every AUTOSAVE_MS, but only when there are unsaved changes', async () => {
      const { service, store, putProject } = autosaveSetup();
      await service.init();

      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      expect(putProject).not.toHaveBeenCalled();

      store.commit({ kind: 'structure' });
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      expect(putProject).toHaveBeenCalledTimes(1);
      expect(store.isDirty()).toBe(false);

      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      expect(putProject).toHaveBeenCalledTimes(1);
    });
  });
});
