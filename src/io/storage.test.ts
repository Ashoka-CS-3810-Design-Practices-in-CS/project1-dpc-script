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

  it('turns a quota error into StorageFullError', async () => {
    const quota = new DOMException('disk full', 'QuotaExceededError');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quota;
    });

    await expect(storage.putSource(source('big', 'p1'))).rejects.toBeInstanceOf(StorageFullError);
    await expect(storage.putProject(project('p1', 1))).rejects.toBeInstanceOf(StorageFullError);
  });
});
