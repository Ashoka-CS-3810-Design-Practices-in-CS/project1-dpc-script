import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStorage,
  StorageFullError,
  type ProjectRecord,
  type SourceRecord,
  type StorageAdapter,
} from './storage';

const project = (id: string, updatedAt: number): ProjectRecord => ({
  id,
  name: `Project ${id}`,
  updatedAt,
  duration: 10,
  json: `{"id":"${id}"}`,
});

const source = (id: string, projectId: string): SourceRecord => ({
  id,
  projectId,
  fileName: `${id}.wav`,
  type: 'audio/wav',
  bytes: new Uint8Array([1, 2, 3]).buffer,
});

// Each test deletes everything it made, so tests don't leak into each other.
async function clear(storage: StorageAdapter): Promise<void> {
  for (const p of await storage.listProjects()) await storage.deleteProject(p.id);
  await storage.deleteSourcesNotIn([]);
}

describe('storage', () => {
  const storage = createStorage();
  afterEach(async () => {
    vi.restoreAllMocks();
    await clear(storage);
  });

  it('saves and loads a project', async () => {
    await storage.putProject(project('p1', 1));
    expect(await storage.getProject('p1')).toEqual(project('p1', 1));
    expect(await storage.getProject('nope')).toBeUndefined();
  });

  it('lists projects newest first, without the json', async () => {
    await storage.putProject(project('old', 1));
    await storage.putProject(project('new', 3));
    await storage.putProject(project('mid', 2));

    const list = await storage.listProjects();
    expect(list.map((p) => p.id)).toEqual(['new', 'mid', 'old']);
    expect(list[0]).toEqual({ id: 'new', name: 'Project new', updatedAt: 3, duration: 10 });
  });

  it('saves, finds and deletes a source', async () => {
    await storage.putSource(source('s1', 'p1'));

    expect(await storage.hasSource('s1')).toBe(true);
    expect(await storage.hasSource('s2')).toBe(false);
    expect((await storage.getSource('s1'))?.fileName).toBe('s1.wav');
    expect(new Uint8Array((await storage.getSource('s1'))!.bytes)).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    await storage.deleteSource('s1');
    expect(await storage.hasSource('s1')).toBe(false);
  });

  it('lists the source ids of one project', async () => {
    await storage.putSource(source('a', 'p1'));
    await storage.putSource(source('b', 'p1'));
    await storage.putSource(source('c', 'p2'));

    expect((await storage.sourceIdsForProject('p1')).sort()).toEqual(['a', 'b']);
    expect(await storage.sourceIdsForProject('none')).toEqual([]);
  });

  it('deleting a project also deletes its sources', async () => {
    await storage.putProject(project('p1', 1));
    await storage.putProject(project('p2', 1));
    await storage.putSource(source('a', 'p1'));
    await storage.putSource(source('b', 'p2'));

    await storage.deleteProject('p1');

    expect(await storage.getProject('p1')).toBeUndefined();
    expect(await storage.hasSource('a')).toBe(false);
    expect(await storage.getProject('p2')).toBeDefined();
    expect(await storage.hasSource('b')).toBe(true);
  });

  it('deleteSourcesNotIn keeps only the sources of the listed projects', async () => {
    await storage.putSource(source('keep', 'p1'));
    await storage.putSource(source('drop1', 'p2'));
    await storage.putSource(source('drop2', 'p3'));

    await storage.deleteSourcesNotIn(['p1']);

    expect(await storage.hasSource('keep')).toBe(true);
    expect(await storage.hasSource('drop1')).toBe(false);
    expect(await storage.hasSource('drop2')).toBe(false);
  });

  it('turns a quota error into StorageFullError', async () => {
    const quota = new DOMException('disk full', 'QuotaExceededError');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quota;
    });

    await expect(storage.putSource(source('big', 'p1'))).rejects.toBeInstanceOf(StorageFullError);
    await expect(storage.putProject(project('p1', 1))).rejects.toBeInstanceOf(StorageFullError);
  });

  it('passes other write errors through unchanged', async () => {
    const other = new Error('something else');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw other;
    });

    await expect(storage.putProject(project('p1', 1))).rejects.toBe(other);
  });
});
