import type { Change, ChangeKind, ProjectStore } from '@/app/contracts';
import type { Project } from '@/model/types';

/** Change kinds that mean the user has unsaved work. */
const DIRTY_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>(['structure', 'mix', 'meta']);

/** Single owner of the current Project. `version` goes up on every emitted change
 *  (commit, replace, markSaved), so React can use it as an external-store snapshot. */
export function createProjectStore(initial: Project): ProjectStore {
  let project = initial;
  let version = 0;
  let dirty = false;
  let savedAt: number | null = null;
  const listeners = new Set<(change: Change) => void>();

  function emit(change: Change): void {
    version += 1;
    for (const listener of [...listeners]) listener(change);
  }

  return {
    get: () => project,
    replace(next) {
      project = next;
      dirty = false;
      emit({ kind: 'project' });
    },
    commit(change) {
      if (DIRTY_KINDS.has(change.kind)) dirty = true;
      emit(change);
    },
    version: () => version,
    isDirty: () => dirty,
    savedAt: () => savedAt,
    markSaved() {
      dirty = false;
      savedAt = Date.now();
      emit({ kind: 'saved' });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
