import type { ProjectService, ProjectStore } from '@/app/contracts';
import { createEmptyProject } from '@/model/projectOps';
import { fail } from '@/model/result';
import { createSourceRegistry } from '@/model/sourceRegistry';

/** Stub (AB-06): can only start an empty project. Real implementation: AB-10. */
export function createProjectService(deps: { store: ProjectStore }): ProjectService {
  return {
    init: async () => {
      deps.store.replace(createEmptyProject('Untitled project', createSourceRegistry()));
    },
    newProject: () => {},
    rename: () => fail('Not available yet.'),
    save: async () => fail('Not available yet.'),
    list: async () => [],
    open: async () => fail('Not available yet.'),
    remove: async () => fail('Not available yet.'),
    reset: () => {},
    onError: () => () => {},
  };
}
