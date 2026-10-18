import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditService } from '@/app/editService';
import { createProjectService } from '@/app/projectService';
import { createProjectStore } from '@/app/store';
import { createStorage } from '@/io/storage';
import { createEmptyProject } from '@/model/projectOps';
import { toJson } from '@/model/serializer';
import { createSourceRegistry } from '@/model/sourceRegistry';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';

const storage = createStorage();

const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** The whole app stack minus the browser: real store, EditService, storage and ProjectService. */
function setup() {
  const store = createProjectStore(createEmptyProject('Song', createSourceRegistry(), 'proj-1'));
  const edit = createEditService(store);
  const projects = createProjectService({
    store,
    storage,
    edit,
    decode: async () => fakeAudioBuffer({ duration: 8 }),
    computePeaks: async () => ({ sampleRate: 44100, blockSize: 256, length: 0, levels: [] }),
  });
  return { store, edit, projects };
}

/** What import does: store the original file, register the source, put a clip on a track. */
async function importSource(
  { store, edit }: ReturnType<typeof setup>,
  id: string,
  trackId: string,
  at: number,
  seconds: number,
) {
  await storage.putSource({
    id,
    projectId: store.get().id,
    fileName: `${id}.wav`,
    type: 'audio/wav',
    bytes: new Uint8Array([1]).buffer,
  });
  store.get().sources.add({
    id,
    fileName: `${id}.wav`,
    status: 'ready',
    buffer: fakeAudioBuffer({ duration: seconds }),
    peaks: null,
    refCount: 0,
  });
  return must(edit.addClip(trackId, id, seconds, at));
}

describe('save, then open', () => {
  afterEach(async () => {
    for (const p of await storage.listProjects()) await storage.deleteProject(p.id);
  });

  it('every track, clip, fade, trim and mix setting comes back, and reference counts are rebuilt', async () => {
    const app = setup();
    const { store, edit, projects } = app;
    const drums = edit.addTrack();
    const bass = edit.addTrack();
    const keys = edit.addTrack();
    must(edit.renameTrack(drums, 'Drums'));
    must(edit.renameTrack(bass, 'Bass'));
    must(edit.renameTrack(keys, 'Keys'));

    // One source split into two clips (so it is shared: refCount 2), the second moved and faded.
    const loop = await importSource(app, 'loop', drums, 0, 8);
    const [firstHalf, secondHalf] = must(edit.split(loop, 3));
    must(edit.moveClip(secondHalf, drums, 5));
    must(edit.setFades(firstHalf, 0.5, 1));
    must(edit.trimEdge(secondHalf, 'end', 9.5));
    // Two more sources: one trimmed to a selection, one left alone.
    const line = await importSource(app, 'line', bass, 1, 6);
    must(edit.trimToSelection(line, 2, 5));
    await importSource(app, 'pad', keys, 0, 4);

    edit.setVolume(drums, 0.8);
    edit.setVolume(bass, 0.2);
    edit.toggleMute(bass);
    edit.toggleSolo(keys);
    must(projects.rename('Song v2'));

    const before = toJson(store.get());
    const counts = store
      .get()
      .sources.all()
      .map((s) => [s.id, s.refCount] as const)
      .sort();
    expect(counts).toEqual([
      ['line', 1],
      ['loop', 2],
      ['pad', 1],
    ]);

    expect(await projects.save()).toEqual({ ok: true, value: undefined });
    expect(store.isDirty()).toBe(false);

    projects.newProject();
    expect(store.get().tracks).toEqual([]);

    const [summary] = await projects.list();
    expect(summary).toMatchObject({ id: 'proj-1', name: 'Song v2', duration: 9.5 });
    expect(await projects.open(summary.id)).toEqual({ ok: true, value: undefined });

    const after = store.get();
    expect(toJson(after)).toEqual(before);
    expect(
      after.sources
        .all()
        .map((s) => [s.id, s.refCount] as const)
        .sort(),
    ).toEqual(counts);

    // The sources then load in the background and become playable.
    await vi.waitFor(() =>
      expect(after.sources.all().every((s) => s.status === 'ready' && s.buffer !== null)).toBe(
        true,
      ),
    );
    expect(store.isDirty()).toBe(false);
  });

  it('saving again after removing a clip deletes the stored audio nobody uses', async () => {
    const app = setup();
    const track = app.edit.addTrack();
    await importSource(app, 'keep', track, 0, 2);
    const drop = await importSource(app, 'drop', track, 5, 2);
    await app.projects.save();
    expect((await storage.sourceIdsForProject('proj-1')).sort()).toEqual(['drop', 'keep']);

    app.edit.removeClip(drop);
    await app.projects.save();
    expect(await storage.sourceIdsForProject('proj-1')).toEqual(['keep']);
  });
});
