import type { AudioSource, SourceId, SourceRegistry } from '@/model/types';

/** DS3: every decoded source lives here, and is dropped once no clip uses it. */
export function createSourceRegistry(): SourceRegistry {
  const sources = new Map<SourceId, AudioSource>();

  // Asking for an id we never added is a bug in the caller, so fail loudly.
  function must(id: SourceId): AudioSource {
    const source = sources.get(id);
    if (!source) throw new Error(`Unknown source: ${id}`);
    return source;
  }

  return {
    get: (id) => sources.get(id),
    add: (source) => void sources.set(source.id, source),
    retain: (id) => {
      must(id).refCount += 1;
    },
    release: (id) => {
      const source = must(id);
      source.refCount -= 1;
      if (source.refCount <= 0) sources.delete(id); // frees the decoded audio
    },
    update: (id, patch) => void Object.assign(must(id), patch),
    all: () => [...sources.values()],
  };
}
