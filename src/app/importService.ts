import type { EditService, ImportedClip, ImportService, ProjectStore } from '@/app/contracts';
import { MSG } from '@/app/messages';
import type { PeakPyramid } from '@/algorithms/types';
import { StorageFullError, type StorageAdapter } from '@/io/storage';
import { newId } from '@/model/ids';
import { fail, ok, type Result } from '@/model/result';
import type { TrackId } from '@/model/types';

export interface ImportDeps {
  store: ProjectStore;
  edit: EditService;
  storage: StorageAdapter;
  decode: (file: File) => Promise<Result<{ buffer: AudioBuffer; bytes: ArrayBuffer }>>;
  computePeaks: (channels: Float32Array[], sampleRate: number) => Promise<PeakPyramid>;
  pickFile: () => Promise<File | null>;
}

/** A1: turns a file into a source and a clip. Nothing in the project changes unless every step works. */
export function createImportService(deps: ImportDeps): ImportService {
  const { store, edit, storage, decode, computePeaks, pickFile } = deps;

  const hasTrack = (trackId: TrackId | null): trackId is TrackId =>
    trackId !== null && store.get().tracks.some((t) => t.id === trackId);

  async function importFile(
    file: File,
    trackId: TrackId | null,
    at: number,
  ): Promise<Result<ImportedClip>> {
    if (!hasTrack(trackId)) return fail(MSG.importNoTrack);

    const decoded = await decode(file);
    if (!decoded.ok) return decoded;
    const { buffer, bytes } = decoded.value;

    const project = store.get();
    const sourceId = newId();
    try {
      await storage.putSource({
        id: sourceId,
        projectId: project.id,
        fileName: file.name,
        type: file.type,
        bytes,
      });
    } catch (e) {
      if (e instanceof StorageFullError) return fail(MSG.storageFull);
      throw e;
    }

    project.sources.add({
      id: sourceId,
      fileName: file.name,
      status: 'ready',
      buffer,
      peaks: null,
      refCount: 0,
    });

    const added = edit.addClip(trackId, sourceId, buffer.duration, at);
    if (!added.ok) {
      // Undo: a source nobody uses shouldn't stay in storage or memory.
      await storage.deleteSource(sourceId);
      project.sources.release(sourceId); // count 0 → removed
      return added;
    }

    // Peaks take a while, so the clip appears first and the waveform fills in later.
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i),
    );
    computePeaks(channels, buffer.sampleRate)
      .then((peaks) => {
        if (!project.sources.get(sourceId)) return; // the clip was removed in the meantime
        project.sources.update(sourceId, { peaks });
        store.commit({ kind: 'peaks', sourceId });
      })
      .catch(() => {
        // No waveform, but the audio still plays, so there's nothing to tell the user.
      });

    return ok({ clipId: added.value, fileName: file.name, duration: buffer.duration });
  }

  return {
    importFile,
    async pickAndImport(trackId, at) {
      // Check the track first so the error shows without opening the picker.
      if (!hasTrack(trackId)) return fail(MSG.importNoTrack);
      const file = await pickFile();
      return file === null ? null : importFile(file, trackId, at);
    },
  };
}
