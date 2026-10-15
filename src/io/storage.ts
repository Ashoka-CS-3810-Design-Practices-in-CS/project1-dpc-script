import { openDB, type DBSchema } from 'idb';
import { DB_NAME } from '@/model/constants';

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  duration: number;
  json: string;
}

export interface SourceRecord {
  id: string;
  projectId: string;
  fileName: string;
  type: string;
  bytes: ArrayBuffer;
}

export class StorageFullError extends Error {}

export interface StorageAdapter {
  putProject(r: ProjectRecord): Promise<void>;
  getProject(id: string): Promise<ProjectRecord | undefined>;
  listProjects(): Promise<Omit<ProjectRecord, 'json'>[]>; // newest first
  deleteProject(id: string): Promise<void>; // also deletes its sources
  putSource(r: SourceRecord): Promise<void>;
  getSource(id: string): Promise<SourceRecord | undefined>;
  hasSource(id: string): Promise<boolean>;
  deleteSource(id: string): Promise<void>;
  sourceIdsForProject(projectId: string): Promise<string[]>;
  deleteSourcesNotIn(projectIds: string[]): Promise<void>; // orphan cleanup (README §9.5 R7)
}

interface Schema extends DBSchema {
  projects: { key: string; value: ProjectRecord };
  sources: { key: string; value: SourceRecord; indexes: { byProject: string } };
}

/** Runs a write, and turns the browser's "disk full" error into our own. */
async function guardQuota(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') throw new StorageFullError();
    throw e;
  }
}

export function createStorage(): StorageAdapter {
  // Opened on first use, so just creating the adapter never touches IndexedDB.
  let dbPromise: ReturnType<typeof open> | undefined;
  function open() {
    return openDB<Schema>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('projects', { keyPath: 'id' });
        const sources = db.createObjectStore('sources', { keyPath: 'id' });
        sources.createIndex('byProject', 'projectId');
      },
    });
  }
  const getDb = () => (dbPromise ??= open());

  return {
    putProject: (r) =>
      guardQuota(async () => {
        await (await getDb()).put('projects', r);
      }),

    getProject: async (id) => (await getDb()).get('projects', id),

    async listProjects() {
      const all = await (await getDb()).getAll('projects');
      return all
        .map(({ id, name, updatedAt, duration }) => ({ id, name, updatedAt, duration }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async deleteProject(id) {
      const tx = (await getDb()).transaction(['projects', 'sources'], 'readwrite');
      const sources = tx.objectStore('sources');
      const sourceIds = await sources.index('byProject').getAllKeys(id);
      await Promise.all([
        tx.objectStore('projects').delete(id),
        ...sourceIds.map((s) => sources.delete(s)),
      ]);
      await tx.done;
    },

    putSource: (r) =>
      guardQuota(async () => {
        await (await getDb()).put('sources', r);
      }),

    getSource: async (id) => (await getDb()).get('sources', id),

    hasSource: async (id) => (await (await getDb()).getKey('sources', id)) !== undefined,

    deleteSource: async (id) => (await getDb()).delete('sources', id),

    sourceIdsForProject: async (projectId) =>
      (await getDb()).getAllKeysFromIndex('sources', 'byProject', projectId),

    async deleteSourcesNotIn(projectIds) {
      const keep = new Set(projectIds);
      const tx = (await getDb()).transaction('sources', 'readwrite');
      // Key cursor, so we don't load every audio file just to read its projectId.
      let cursor = await tx.store.index('byProject').openKeyCursor();
      while (cursor) {
        if (!keep.has(cursor.key)) await tx.store.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
      await tx.done;
    },
  };
}
