import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Change, ChangeKind } from '@/app/contracts';
import { createProjectStore } from '@/app/store';
import { SAMPLE_RATE } from '@/model/constants';
import type { Project, SourceRegistry } from '@/model/types';

function project(name = 'Test'): Project {
  return {
    version: 1,
    id: `id-${name}`,
    name,
    sampleRate: SAMPLE_RATE,
    tracks: [],
    sources: {} as SourceRegistry,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createProjectStore', () => {
  it('starts clean at version 0 with the initial project', () => {
    const initial = project();
    const store = createProjectStore(initial);
    expect(store.get()).toBe(initial);
    expect(store.version()).toBe(0);
    expect(store.isDirty()).toBe(false);
    expect(store.savedAt()).toBeNull();
  });

  it.each<[ChangeKind, boolean]>([
    ['structure', true],
    ['mix', true],
    ['meta', true],
    ['sources', false],
    ['peaks', false],
    ['project', false],
    ['saved', false],
  ])('commit %s sets dirty = %s', (kind, dirty) => {
    const store = createProjectStore(project());
    store.commit({ kind });
    expect(store.isDirty()).toBe(dirty);
  });

  it('bumps the version on every commit and passes the change to listeners', () => {
    const store = createProjectStore(project());
    const seen: Change[] = [];
    store.subscribe((c) => seen.push(c));
    store.commit({ kind: 'structure' });
    store.commit({ kind: 'peaks', sourceId: 's1' });
    expect(store.version()).toBe(2);
    expect(seen).toEqual([{ kind: 'structure' }, { kind: 'peaks', sourceId: 's1' }]);
  });

  it('replace swaps the project, clears dirty and emits project', () => {
    const store = createProjectStore(project('A'));
    const seen: Change[] = [];
    store.subscribe((c) => seen.push(c));
    store.commit({ kind: 'mix' });
    const next = project('B');
    store.replace(next);
    expect(store.get()).toBe(next);
    expect(store.isDirty()).toBe(false);
    expect(store.version()).toBe(2);
    expect(seen.at(-1)).toEqual({ kind: 'project' });
  });

  it('markSaved clears dirty, records the time and emits saved', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const store = createProjectStore(project());
    const seen: Change[] = [];
    store.subscribe((c) => seen.push(c));
    store.commit({ kind: 'meta' });
    store.markSaved();
    expect(store.isDirty()).toBe(false);
    expect(store.savedAt()).toBe(1_700_000_000_000);
    expect(seen.at(-1)).toEqual({ kind: 'saved' });
  });

  it('stops notifying a listener after unsubscribe', () => {
    const store = createProjectStore(project());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.commit({ kind: 'structure' });
    unsubscribe();
    store.commit({ kind: 'structure' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('lets a listener unsubscribe itself without skipping the others', () => {
    const store = createProjectStore(project());
    const second = vi.fn();
    const unsubscribe = store.subscribe(() => unsubscribe());
    store.subscribe(second);
    store.commit({ kind: 'mix' });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
