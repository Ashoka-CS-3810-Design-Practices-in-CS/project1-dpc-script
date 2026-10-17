import type { PeakPyramid } from '@/algorithms/types';
import type { EditService, ProjectService, ProjectStore, ProjectSummary } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { StorageFullError, type StorageAdapter } from '@/io/storage';
import { AUTOSAVE_MS } from '@/model/constants';
import { createEmptyProject, projectEnd, validateName } from '@/model/projectOps';
import { fail, ok, type Result } from '@/model/result';
import { parseProject, toJson, type ProjectJson } from '@/model/serializer';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { Project, SourceId } from '@/model/types';

export interface ProjectDeps {
  store: ProjectStore;
  storage: StorageAdapter;
  edit: EditService;
  /** Decodes a stored original file. */
  decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  computePeaks: (channels: Float32Array[], sampleRate: number) => Promise<PeakPyramid>;
}

const PARSE_MESSAGES = { damaged: MSG.projectDamaged, volumeClamped: MSG.volumeClamped };

/** DS7: save, open, list, delete, reset and autosave. */
export function createProjectService(deps: ProjectDeps): ProjectService {
  const { store, storage, edit, decode, computePeaks } = deps;
  const errorListeners = new Set<(message: string) => void>();
  let autosave: ReturnType<typeof setInterval> | undefined;

  const reportError = (message: string) => {
    for (const listener of [...errorListeners]) listener(message);
  };
  const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const startEmpty = () =>
    store.replace(createEmptyProject('Untitled project', createSourceRegistry()));

  async function save(): Promise<Result> {
    const project = store.get();
    // Edits that arrive while we write mean the saved copy is already out of date.
    let changedMeanwhile = false;
    const unsubscribe = store.subscribe(({ kind }) => {
      if (kind === 'structure' || kind === 'mix' || kind === 'meta' || kind === 'project') {
        changedMeanwhile = true;
      }
    });
    try {
      await storage.putProject({
        id: project.id,
        name: project.name,
        updatedAt: Date.now(),
        duration: projectEnd(project),
        json: JSON.stringify(toJson(project)),
      });
      // Audio no clip uses any more can go now that the saved project no longer mentions it (R7).
      for (const id of await storage.sourceIdsForProject(project.id)) {
        if (!project.sources.get(id)) await storage.deleteSource(id);
      }
    } catch (e) {
      if (e instanceof StorageFullError) return fail(MSG.storageFull);
      throw e;
    } finally {
      unsubscribe();
    }
    if (!changedMeanwhile) store.markSaved();
    return ok(undefined);
  }

  /** Decodes the sources still loading, earliest clip first, so what you see first is heard first. */
  async function loadSources(project: Project, ids: SourceId[]): Promise<void> {
    for (const id of ids) {
      if (store.get() !== project) return; // another project was opened meanwhile
      try {
        const record = await storage.getSource(id);
        if (!record) throw new Error('missing');
        const buffer = await decode(record.bytes);
        if (store.get() !== project) return;
        project.sources.update(id, { status: 'ready', buffer });
        store.commit({ kind: 'sources', sourceId: id });

        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
          buffer.getChannelData(i),
        );
        // Not awaited: the next file can decode while this waveform is computed.
        computePeaks(channels, buffer.sampleRate)
          .then((peaks) => {
            if (store.get() !== project || !project.sources.get(id)) return;
            project.sources.update(id, { peaks });
            store.commit({ kind: 'peaks', sourceId: id });
          })
          .catch(() => {
            // No waveform, but the audio still plays.
          });
      } catch {
        if (store.get() !== project) return;
        project.sources.update(id, { status: 'missing' });
        store.commit({ kind: 'sources', sourceId: id });
      }
    }
  }

  /** The project as data → a Project whose sources are all still 'loading'. */
  function buildProject(data: ProjectJson): Project {
    const sources = createSourceRegistry();
    for (const s of data.sources) {
      const refCount = data.tracks.reduce(
        (n, t) => n + t.clips.filter((c) => c.sourceId === s.id).length,
        0,
      );
      sources.add({
        id: s.id,
        fileName: s.fileName,
        status: 'loading',
        buffer: null,
        peaks: null,
        refCount,
      });
    }
    return {
      version: data.version,
      id: data.id,
      name: data.name,
      sampleRate: data.sampleRate,
      tracks: data.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) })),
      sources,
    };
  }

  return {
    async init() {
      startEmpty();
      clearInterval(autosave);
      autosave = setInterval(() => {
        if (!store.isDirty()) return;
        save().then(
          (r) => {
            if (!r.ok) reportError(r.error);
          },
          (e) => reportError(messageOf(e)),
        );
      }, AUTOSAVE_MS);

      // Audio of projects that were never saved (or deleted) is no use to anyone (R7).
      try {
        const saved = await storage.listProjects();
        await storage.deleteSourcesNotIn([...saved.map((p) => p.id), store.get().id]);
      } catch (e) {
        reportError(messageOf(e));
      }
    },

    newProject: startEmpty,

    rename(name) {
      const problem = validateName(name);
      if (problem) return fail(problem === 'empty' ? MSG.nameEmpty : MSG.nameTooLong);
      store.get().name = name;
      store.commit({ kind: 'meta' });
      return ok(undefined);
    },

    save,

    async list(): Promise<ProjectSummary[]> {
      return storage.listProjects();
    },

    async open(id) {
      const record = await storage.getProject(id);
      const parsed = record ? parseProject(record.json, PARSE_MESSAGES) : fail(MSG.projectDamaged);
      // The project that is open stays open.
      if (!parsed.ok) return fail(parsed.error);

      const project = buildProject(parsed.value);
      let missing = 0;
      for (const source of project.sources.all()) {
        if (await storage.hasSource(source.id)) continue;
        project.sources.update(source.id, { status: 'missing' });
        missing += 1;
      }
      store.replace(project);

      const warnings = [...(parsed.warnings ?? [])];
      if (missing > 0) warnings.push(MSG.missingAudioWarning(missing));

      // Earliest clip first.
      const firstStart = new Map<SourceId, number>();
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          firstStart.set(
            clip.sourceId,
            Math.min(firstStart.get(clip.sourceId) ?? Infinity, clip.startTime),
          );
        }
      }
      const loading = project.sources
        .all()
        .filter((s) => s.status === 'loading')
        .sort(
          (a, b) =>
            (firstStart.get(a.id) ?? Number.MAX_VALUE) - (firstStart.get(b.id) ?? Number.MAX_VALUE),
        )
        .map((s) => s.id);
      void loadSources(project, loading);

      return ok(undefined, warnings.length > 0 ? warnings : undefined);
    },

    async remove(id) {
      await storage.deleteProject(id);
      // Deleting the open project leaves it open but unsaved; the next save writes it again.
      if (store.get().id === id) store.commit({ kind: 'meta' });
      return ok(undefined);
    },

    reset() {
      for (const track of [...store.get().tracks]) edit.deleteTrack(track.id);
    },

    onError(listener) {
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
      };
    },
  };
}
