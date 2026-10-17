import type { Services } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { createExportService } from '@/app/exportService';
import { createImportService } from '@/app/importService';
import { MSG } from '@/app/messages';
import { createProjectService } from '@/app/projectService';
import { createProjectStore } from '@/app/store';
import { createTimelineQueries } from '@/app/timelineQueries';
import { createTransportService } from '@/app/transportService';
import { createDecodeContext } from '@/io/browserAudio';
import { decodeFile } from '@/io/decoder';
import { pickAudioFile } from '@/io/fileIO';
import { computePeaks } from '@/io/peaksBridge';
import { createStorage } from '@/io/storage';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';

const IMPORT_MESSAGES = {
  unreadable: MSG.importUnreadable,
  tooLarge: MSG.importTooLarge,
  tooLong: MSG.importTooLong,
};

/** The composition root: builds every service and wires them together. */
export function createServices(): Services {
  const registry = createSourceRegistry();
  const storage = createStorage();
  const store = createProjectStore(createEmptyProject('Untitled project', registry));
  const edit = createEditService(store);

  const services: Services = {
    store,
    edit,
    queries: createTimelineQueries(store),
    transport: createTransportService(),
    importer: createImportService({
      store,
      edit,
      storage,
      decode: (file) => decodeFile(file, createDecodeContext(), IMPORT_MESSAGES),
      computePeaks,
      pickFile: pickAudioFile,
    }),
    exporter: createExportService(),
    projects: createProjectService({ store }),
  };

  // Lets the Playwright tests look at the project (dev builds only).
  if (import.meta.env.DEV) (window as unknown as { __dpcs: Services }).__dpcs = services;

  return services;
}
