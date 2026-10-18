import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Services, TransportService } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { MSG } from '@/app/messages';
import { createProjectStore } from '@/app/store';
import { createTimelineQueries } from '@/app/timelineQueries';
import { NUDGE_S, NUDGE_SHIFT_S, PX_PER_SECOND_DEFAULT, ZOOM_STEP } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { done, fail } from '@/model/result';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { TrackId } from '@/model/types';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';
import { notify } from '@/ui/feedback';
import { keyToAction, runShortcut, type KeyLike, type ShortcutAction } from '@/ui/shortcuts';
import { createViewStore, type ViewStore } from '@/ui/viewStore';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});
const free = { inField: false };

describe('keyToAction (A3 §4.2)', () => {
  it.each<[string, KeyLike, ShortcutAction]>([
    ['Space', key(' '), { type: 'togglePlay' }],
    ['Home', key('Home'), { type: 'stop' }],
    ['S', key('s'), { type: 'split' }],
    ['Shift+S', key('S', { shiftKey: true }), { type: 'split' }],
    ['Delete', key('Delete'), { type: 'deleteSelection' }],
    ['T', key('t'), { type: 'trim' }],
    ['M', key('m'), { type: 'mute' }],
    ['O', key('o'), { type: 'solo' }],
    ['←', key('ArrowLeft'), { type: 'nudge', by: -NUDGE_S }],
    ['→', key('ArrowRight'), { type: 'nudge', by: NUDGE_S }],
    ['Shift+←', key('ArrowLeft', { shiftKey: true }), { type: 'nudge', by: -NUDGE_SHIFT_S }],
    ['Shift+→', key('ArrowRight', { shiftKey: true }), { type: 'nudge', by: NUDGE_SHIFT_S }],
    ['Ctrl+S', key('s', { ctrlKey: true }), { type: 'save' }],
    ['Cmd+S', key('s', { metaKey: true }), { type: 'save' }],
    ['+', key('+', { shiftKey: true }), { type: 'zoom', factor: ZOOM_STEP }],
    ['=', key('='), { type: 'zoom', factor: ZOOM_STEP }],
    ['−', key('-'), { type: 'zoom', factor: 1 / ZOOM_STEP }],
  ])('%s', (_, e, action) => {
    expect(keyToAction(e, free)).toEqual(action);
  });

  it('every key is ignored while focus is in a field or the ruler slider', () => {
    for (const k of [' ', 'Home', 's', 'Delete', 't', 'm', 'o', 'ArrowLeft', '+', '-']) {
      expect(keyToAction(key(k), { inField: true })).toBeNull();
    }
    expect(keyToAction(key('s', { ctrlKey: true }), { inField: true })).toBeNull();
  });

  it('other keys and other modifier combinations are not shortcuts', () => {
    expect(keyToAction(key('x'), free)).toBeNull();
    expect(keyToAction(key('Enter'), free)).toBeNull();
    expect(keyToAction(key('t', { ctrlKey: true }), free)).toBeNull(); // the browser's Ctrl+T
    expect(keyToAction(key('s', { ctrlKey: true, shiftKey: true }), free)).toBeNull();
    expect(keyToAction(key('s', { altKey: true }), free)).toBeNull();
    expect(keyToAction(key('m', { metaKey: true }), free)).toBeNull();
  });
});

describe('runShortcut', () => {
  let services: Services;
  let view: ViewStore;
  let playhead: number;
  let A: TrackId;
  let clip: string;
  const errors = vi.spyOn(notify, 'error').mockImplementation(() => {});

  const run = (action: ShortcutAction) => runShortcut(action, services, view);
  const clips = () => services.store.get().tracks[0].clips.map((c) => [c.startTime, c.duration]);

  beforeEach(() => {
    errors.mockClear();
    const registry = createSourceRegistry();
    registry.add({
      id: 's1',
      fileName: 's1.wav',
      status: 'ready',
      buffer: fakeAudioBuffer({ duration: 30 }),
      peaks: null,
      refCount: 0,
    });
    const store = createProjectStore(createEmptyProject('Test', registry, 'p'));
    const edit = createEditService(store);
    playhead = 0;
    const transport = {
      position: () => playhead,
      togglePlay: vi.fn(async () => done()),
      stop: vi.fn(),
    } as unknown as TransportService;
    services = {
      store,
      edit,
      queries: createTimelineQueries(store),
      transport,
      projects: { save: vi.fn(async () => fail(MSG.storageFull)) },
    } as unknown as Services;
    view = createViewStore();
    A = edit.addTrack();
    const r = edit.addClip(A, 's1', 4, 2); // [2, 6)
    clip = r.ok ? r.value : '';
  });

  it('Space toggles playback and Home stops', async () => {
    await run({ type: 'togglePlay' });
    await run({ type: 'stop' });
    expect(services.transport.togglePlay).toHaveBeenCalledOnce();
    expect(services.transport.stop).toHaveBeenCalledOnce();
  });

  it('S splits the selected clip at the playhead', async () => {
    view.set({ selectedClipId: clip });
    playhead = 3;
    await run({ type: 'split' });
    expect(clips()).toEqual([
      [2, 1],
      [3, 3],
    ]);
  });

  it('S without a selected clip splits the clip under the playhead on the selected track', async () => {
    view.set({ selectedTrackId: A });
    playhead = 5;
    await run({ type: 'split' });
    expect(clips()).toEqual([
      [2, 3],
      [5, 1],
    ]);
  });

  it('S with nothing to split says why', async () => {
    await run({ type: 'split' });
    expect(errors).toHaveBeenLastCalledWith(MSG.editNoClip);
    view.set({ selectedClipId: clip });
    playhead = 10;
    await run({ type: 'split' });
    expect(errors).toHaveBeenLastCalledWith(MSG.editPlayheadOutside);
    expect(clips()).toEqual([[2, 4]]);
  });

  it('Delete and T act on the selection, and do nothing without one', async () => {
    await run({ type: 'deleteSelection' });
    await run({ type: 'trim' });
    expect(clips()).toEqual([[2, 4]]);
    view.set({ selection: { clipId: clip, start: 3, end: 4 } });
    await run({ type: 'deleteSelection' });
    expect(clips()).toEqual([
      [2, 1],
      [4, 2],
    ]);
    view.set({ selection: { clipId: clip, start: 2.5, end: 3 } });
    await run({ type: 'trim' });
    expect(clips()).toEqual([
      [2.5, 0.5],
      [4, 2],
    ]);
  });

  it('M and O toggle the selected track', async () => {
    await run({ type: 'mute' }); // no track selected: nothing
    expect(services.store.get().tracks[0].muted).toBe(false);
    view.set({ selectedTrackId: A });
    await run({ type: 'mute' });
    await run({ type: 'solo' });
    expect(services.store.get().tracks[0]).toMatchObject({ muted: true, soloed: true });
  });

  it('arrows nudge the selected clip; a failed nudge shows its message', async () => {
    view.set({ selectedClipId: clip });
    await run({ type: 'nudge', by: NUDGE_SHIFT_S });
    expect(clips()).toEqual([[3, 4]]);
    services.edit.addClip(A, 's1', 1, 7); // [7, 8)
    await run({ type: 'nudge', by: NUDGE_SHIFT_S }); // [4, 8) would overlap
    expect(errors).toHaveBeenLastCalledWith(MSG.editOverlap);
    expect(clips()[0]).toEqual([3, 4]);
  });

  it('Ctrl+S saves and shows a failure', async () => {
    await run({ type: 'save' });
    expect(services.projects.save).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenLastCalledWith(MSG.storageFull);
  });

  it('+ and − zoom by ZOOM_STEP', async () => {
    await run({ type: 'zoom', factor: ZOOM_STEP });
    expect(view.get().pxPerSecond).toBeCloseTo(PX_PER_SECOND_DEFAULT * ZOOM_STEP, 9);
    await run({ type: 'zoom', factor: 1 / ZOOM_STEP });
    expect(view.get().pxPerSecond).toBeCloseTo(PX_PER_SECOND_DEFAULT, 9);
  });
});
