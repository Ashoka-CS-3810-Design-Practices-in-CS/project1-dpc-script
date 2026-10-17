import type { Services } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { createExportService } from '@/app/exportService';
import { createImportService } from '@/app/importService';
import { MSG } from '@/app/messages';
import { createProjectService } from '@/app/projectService';
import { createProjectStore } from '@/app/store';
import { createTimelineQueries } from '@/app/timelineQueries';
import { createTransportService } from '@/app/transportService';
import { createDefaultEffects } from '@/engine/effects';
import { renderMix, type OfflineContextLike } from '@/engine/offlineRenderer';
import { createPlaybackEngine, type LiveContext } from '@/engine/playbackEngine';
import { createDecodeContext, createLiveContext, createOfflineContext } from '@/io/browserAudio';
import { decodeFile } from '@/io/decoder';
import { encodeInWorker } from '@/io/encodeBridge';
import { downloadBlob, pickAudioFile } from '@/io/fileIO';
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

  // Playback and export build their audio graph with the same effects (and the same mix builder).
  const effects = createDefaultEffects();
  // The browser's audio classes have the shape the engine uses, but TypeScript can't see it.
  const engine = createPlaybackEngine(() => createLiveContext() as unknown as LiveContext, effects);

  const services: Services = {
    store,
    edit,
    queries: createTimelineQueries(store),
    transport: createTransportService({ store, engine }),
    importer: createImportService({
      store,
      edit,
      storage,
      decode: (file) => decodeFile(file, createDecodeContext(), IMPORT_MESSAGES),
      computePeaks,
      pickFile: pickAudioFile,
    }),
    exporter: createExportService({
      store,
      render: (project, sampleRate, channels) =>
        renderMix(
          project,
          sampleRate,
          channels,
          effects,
          (ch, length, rate) =>
            createOfflineContext(ch, length, rate) as unknown as OfflineContextLike,
        ),
      encode: encodeInWorker,
      download: downloadBlob,
    }),
    projects: createProjectService({
      store,
      storage,
      edit,
      // decodeAudioData takes ownership of its input, so decode a copy.
      decode: (bytes) => createDecodeContext().decodeAudioData(bytes.slice(0)),
      computePeaks,
    }),
  };

  // Lets the Playwright tests look at the project (dev builds only).
  if (import.meta.env.DEV) (window as unknown as { __dpcs: Services }).__dpcs = services;

  return services;
}
