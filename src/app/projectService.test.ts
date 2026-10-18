import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditService } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { createProjectService } from '@/app/projectService';
import { createProjectStore } from '@/app/store';
import { createStorage, StorageFullError, type StorageAdapter } from '@/io/storage';
import { AUTOSAVE_MS } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { toJson } from '@/model/serializer';
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

const flush = () => vi.waitFor(() => {}, { interval: 1 });

describe('project service', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await wipe(createStorage());
  });

  describe('save and open', () => {
    it('restores names, order, clips, trims, fades, volume, mute and solo exactly', async () => {
      const original = sampleProject();
      const { service, store, storage } = setup(original);
      await storeSources(storage, 'project-1', ['a', 'b']);
      const expected = toJson(original);

      expect(await service.save()).toEqual({ ok: true, value: undefined });
      service.newProject();
      expect(store.get().tracks).toEqual([]);

      const opened = await service.open('project-1');
      expect(opened).toEqual({ ok: true, value: undefined });
      expect(toJson(store.get())).toEqual(expected);
    });

    it('rebuilds reference counts, and the shared source is counted once per clip', async () => {
      const { service, store, storage } = setup(sampleProject());
      await storeSources(storage, 'project-1', ['a', 'b']);
      await service.save();
      await service.open('project-1');
      const sources = store.get().sources;
      expect(sources.get('a')?.refCount).toBe(2);
      expect(sources.get('b')?.refCount).toBe(1);
    });

    it('opens at once with sources loading, then decodes them and computes the peaks', async () => {
      const { service, store, storage, computePeaks } = setup(sampleProject());
      await storeSources(storage, 'project-1', ['a', 'b']);
      await service.save();
      const kinds: string[] = [];
      store.subscribe((c) => kinds.push(`${c.kind}:${c.sourceId ?? ''}`));

      await service.open('project-1');
      expect(kinds).toEqual(['project:']);
      expect(store.get().sources.get('a')?.status).toBe('loading');
      expect(store.isDirty()).toBe(false);

      await vi.waitFor(() => expect(kinds).toContain('peaks:b'));
      expect(kinds).toEqual(
        expect.arrayContaining(['sources:a', 'sources:b', 'peaks:a', 'peaks:b']),
      );
      const a = store.get().sources.get('a')!;
      expect(a.status).toBe('ready');
      expect(a.buffer).not.toBeNull();
      expect(a.peaks).not.toBeNull();
      expect(computePeaks).toHaveBeenCalledTimes(2);
    });

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

    it('marks a source missing when its audio cannot be decoded', async () => {
      const { storage, store } = setup(sampleProject());
      const failing = createProjectService({
        store,
        storage,
        edit: {} as EditService,
        decode: async (bytes) => {
          if (new Uint8Array(bytes)[0] === BYTE.a) throw new Error('bad audio');
          return fakeAudioBuffer({ duration: 1 });
        },
        computePeaks: () => Promise.reject(new Error('no peaks')),
      });
      await storeSources(storage, 'project-1', ['a', 'b']);
      await failing.save();
      await failing.open('project-1');
      await vi.waitFor(() => expect(store.get().sources.get('b')?.status).toBe('ready'));
      expect(store.get().sources.get('a')?.status).toBe('missing');
      await flush();
      expect(store.get().sources.get('b')?.peaks).toBeNull(); // failed peaks: still plays
    });

    it('a stored record that is gone by decode time counts as missing', async () => {
      const real = createStorage();
      const store = createProjectStore(sampleProject());
      const service = createProjectService({
        store,
        // hasSource still says yes, as if the record was deleted just after the check.
        storage: {
          ...real,
          getSource: async (id) => (id === 'b' ? undefined : real.getSource(id)),
        },
        edit: {} as EditService,
        decode: async () => fakeAudioBuffer({ duration: 1 }),
        computePeaks: async () => ({ sampleRate: 1, blockSize: 1, length: 0, levels: [] }),
      });
      await storeSources(real, 'project-1', ['a', 'b']);
      await service.save();
      await service.open('project-1');
      await vi.waitFor(() => expect(store.get().sources.get('b')?.status).toBe('missing'));
      await vi.waitFor(() => expect(store.get().sources.get('a')?.status).toBe('ready'));
    });

    it('stops loading when another project is opened meanwhile', async () => {
      const { service, store, storage, decoded } = setup(sampleProject());
      await storeSources(storage, 'project-1', ['a', 'b']);
      await service.save();
      await service.open('project-1');
      service.newProject();
      const before = store.get();
      await flush();
      await new Promise((r) => setTimeout(r, 20));
      expect(store.get()).toBe(before);
      expect(decoded.length).toBeLessThanOrEqual(1);
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

    it('reports a volume that was out of range', async () => {
      const { service, storage } = setup();
      const json = JSON.stringify({
        version: 1,
        id: 'p',
        name: 'p',
        sampleRate: 44100,
        tracks: [{ id: 't', name: 'Loud', volume: 2, muted: false, soloed: false, clips: [] }],
        sources: [],
      });
      await storage.putProject({ id: 'p', name: 'p', updatedAt: 1, duration: 0, json });
      expect(await service.open('p')).toEqual({
        ok: true,
        value: undefined,
        warnings: [MSG.volumeClamped('Loud', '1')],
      });
    });
  });

  describe('save', () => {
    it('clears the unsaved state and records the time', async () => {
      const { service, store } = setup(sampleProject());
      store.commit({ kind: 'structure' });
      expect(store.isDirty()).toBe(true);
      await service.save();
      expect(store.isDirty()).toBe(false);
      expect(store.savedAt()).not.toBeNull();
    });

    it('writes the summary shown by the Open dialog', async () => {
      const { service, storage } = setup(sampleProject());
      await service.save();
      const [summary] = await service.list();
      expect(summary).toMatchObject({ id: 'project-1', name: 'My mix', duration: 5 });
      expect(await storage.getProject('project-1')).toBeDefined();
    });

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

    it('other storage errors are not hidden', async () => {
      const real = createStorage();
      const service = createProjectService({
        store: createProjectStore(sampleProject()),
        storage: { ...real, putProject: () => Promise.reject(new Error('disk on fire')) },
        edit: {} as EditService,
        decode: async () => fakeAudioBuffer({ duration: 1 }),
        computePeaks: async () => ({ sampleRate: 1, blockSize: 1, length: 0, levels: [] }),
      });
      await expect(service.save()).rejects.toThrow('disk on fire');
    });

    it('deletes stored audio no clip uses any more, and keeps the rest', async () => {
      const project = sampleProject();
      const { service, storage } = setup(project);
      await storeSources(storage, 'project-1', ['a', 'b']);
      await service.save();
      expect(await storage.sourceIdsForProject('project-1')).toHaveLength(2);

      project.sources.release('b'); // its only clip was removed → leaves the registry
      project.tracks[1].clips = [];
      await service.save();
      expect(await storage.sourceIdsForProject('project-1')).toEqual(['a']);
    });

    it('stays unsaved if the project was edited while it was being written', async () => {
      const { service, store } = setup(sampleProject());
      const saving = service.save();
      store.commit({ kind: 'structure' });
      await saving;
      expect(store.isDirty()).toBe(true);
    });

    it('stays unsaved if another project was opened while it was being written', async () => {
      const { service, store } = setup(sampleProject());
      const saving = service.save();
      store.replace(createEmptyProject('other', createSourceRegistry()));
      await saving;
      expect(store.savedAt()).toBeNull();
    });

    it('background changes (peaks, sources) do not count as edits', async () => {
      const { service, store } = setup(sampleProject());
      const saving = service.save();
      store.commit({ kind: 'peaks', sourceId: 'a' });
      store.commit({ kind: 'sources', sourceId: 'a' });
      await saving;
      expect(store.savedAt()).not.toBeNull();
    });
  });

  describe('init', () => {
    it('starts an empty project and deletes audio of projects that were never saved', async () => {
      const { service, store, storage } = setup(sampleProject());
      await storage.putProject({ id: 'kept', name: 'k', updatedAt: 1, duration: 0, json: '{}' });
      await storeSources(storage, 'kept', ['a']);
      await storeSources(storage, 'never-saved', ['b']);

      await service.init();
      expect(store.get().tracks).toEqual([]);
      expect(store.get().name).toBe('Untitled project');
      expect(await storage.hasSource('a')).toBe(true);
      expect(await storage.hasSource('b')).toBe(false);
      await service.newProject();
    });

    it('keeps the audio of the project that is open', async () => {
      const { service, store, storage } = setup();
      await service.init();
      await storeSources(storage, store.get().id, ['a']);
      await service.init(); // a second init starts a new empty project, so `a` is now an orphan
      expect(await storage.hasSource('a')).toBe(false);
    });

    it('reports a storage that cannot be read instead of failing', async () => {
      const real = createStorage();
      const store = createProjectStore(sampleProject());
      const service = createProjectService({
        store,
        storage: { ...real, listProjects: () => Promise.reject(new Error('no storage')) },
        edit: {} as EditService,
        decode: async () => fakeAudioBuffer({ duration: 1 }),
        computePeaks: async () => ({ sampleRate: 1, blockSize: 1, length: 0, levels: [] }),
      });
      const errors: string[] = [];
      service.onError((m) => errors.push(m));
      await service.init();
      expect(errors).toEqual(['no storage']);
      expect(store.get().tracks).toEqual([]);
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

    it('a full storage is reported to the error listeners, and is retried next time', async () => {
      const putProject = vi.fn(async () => {
        throw new StorageFullError();
      });
      const { service, store } = autosaveSetup(putProject);
      const errors: string[] = [];
      const off = service.onError((m) => errors.push(m));
      await service.init();
      store.commit({ kind: 'mix' });

      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      expect(errors).toEqual([MSG.storageFull, MSG.storageFull]);
      expect(store.isDirty()).toBe(true);

      off();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      expect(errors).toHaveLength(2);
    });

    it('any other save failure is reported with its message', async () => {
      const { service, store } = autosaveSetup(
        vi.fn(async () => {
          throw new Error('disk on fire');
        }),
      );
      const errors: string[] = [];
      service.onError((m) => errors.push(m));
      await service.init();
      store.commit({ kind: 'meta' });
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      expect(errors).toEqual(['disk on fire']);
    });

    it('a second init does not start a second timer', async () => {
      const { service, store, putProject } = autosaveSetup();
      await service.init();
      await service.init();
      store.commit({ kind: 'structure' });
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
      expect(putProject).toHaveBeenCalledTimes(1);
    });
  });

  describe('rename', () => {
    it('sets the name and marks the project unsaved', () => {
      const { service, store } = setup();
      const versions = store.version();
      expect(service.rename('Song 2')).toEqual({ ok: true, value: undefined });
      expect(store.get().name).toBe('Song 2');
      expect(store.isDirty()).toBe(true);
      expect(store.version()).toBe(versions + 1);
    });

    it('rejects empty, blank and over-long names without changing anything', () => {
      const { service, store } = setup();
      expect(service.rename('')).toEqual({ ok: false, error: MSG.nameEmpty });
      expect(service.rename('   ')).toEqual({ ok: false, error: MSG.nameEmpty });
      expect(service.rename('x'.repeat(65))).toEqual({ ok: false, error: MSG.nameTooLong });
      expect(service.rename('x'.repeat(64)).ok).toBe(true);
      expect(store.get().name).toBe('x'.repeat(64));
    });
  });

  describe('new, remove, reset', () => {
    it('newProject starts a different empty project and clears unsaved changes', () => {
      const { service, store } = setup(sampleProject());
      const id = store.get().id;
      store.commit({ kind: 'structure' });
      service.newProject();
      expect(store.get().id).not.toBe(id);
      expect(store.get().tracks).toEqual([]);
      expect(store.isDirty()).toBe(false);
    });

    it('remove deletes the saved project and its audio', async () => {
      const { service, storage } = setup(sampleProject());
      await storeSources(storage, 'project-1', ['a']);
      await service.save();
      service.newProject(); // so the deleted one is not the open one
      expect(await service.remove('project-1')).toEqual({ ok: true, value: undefined });
      expect(await service.list()).toEqual([]);
      expect(await storage.hasSource('a')).toBe(false);
    });

    it('removing the open project leaves it open but unsaved', async () => {
      const { service, store } = setup(sampleProject());
      await service.save();
      expect(store.isDirty()).toBe(false);
      await service.remove('project-1');
      expect(store.get().id).toBe('project-1');
      expect(store.isDirty()).toBe(true);
    });

    it('removing another project does not touch the open one', async () => {
      const { service, store, storage } = setup(sampleProject());
      await storage.putProject({ id: 'other', name: 'o', updatedAt: 1, duration: 0, json: '{}' });
      await service.remove('other');
      expect(store.isDirty()).toBe(false);
    });

    it('list returns the newest first', async () => {
      const { service, storage } = setup();
      await storage.putProject({ id: 'old', name: 'Old', updatedAt: 1, duration: 3, json: '{}' });
      await storage.putProject({ id: 'new', name: 'New', updatedAt: 2, duration: 4, json: '{}' });
      expect(await service.list()).toEqual([
        { id: 'new', name: 'New', updatedAt: 2, duration: 4 },
        { id: 'old', name: 'Old', updatedAt: 1, duration: 3 },
      ]);
    });

    it('reset deletes every track through the edit service, keeping id and name', () => {
      const { service, store, deleted } = setup(sampleProject());
      service.reset();
      expect(deleted).toEqual(['t1', 't2']);
      expect(store.get().tracks).toEqual([]);
      expect(store.get().id).toBe('project-1');
      expect(store.get().name).toBe('My mix');
      expect(store.get().sources.all()).toEqual([]); // every source released
    });

    it('reset on an empty project does nothing', () => {
      const { service, store } = setup();
      service.reset();
      expect(store.isDirty()).toBe(false);
    });
  });
});
