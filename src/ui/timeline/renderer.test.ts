import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPeaks } from '@/algorithms/peaks';
import type { EditService, ProjectStore, TimelineQueries } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { MSG } from '@/app/messages';
import { createProjectStore } from '@/app/store';
import { createTimelineQueries } from '@/app/timelineQueries';
import { PEAK_BLOCK_SIZE } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { SourceRegistry, SourceStatus, TrackId } from '@/model/types';
import { createFakeCanvas, type FakeCanvas } from '@/test/fakeCanvas';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';
import { attachRedraws, rulerStep, TimelineRenderer, type Palette } from '@/ui/timeline/renderer';
import { createViewStore, type ViewStore } from '@/ui/viewStore';

const colors: Palette = {
  bg: 'bg',
  panelBg: 'panel',
  fg: 'fg',
  mutedFg: 'muted',
  border: 'border',
  accent: 'accent',
  selection: 'selection',
  invalid: 'invalid',
  rowSelected: 'row-selected',
  clipBg: 'clip',
  clipHeader: 'clip-header',
  waveform: 'wave',
  fadeShade: 'fade',
};

let registry: SourceRegistry;
let store: ProjectStore;
let edit: EditService;
let queries: TimelineQueries;
let view: ViewStore;
let fake: FakeCanvas;
let renderer: TimelineRenderer;
let A: TrackId;

/** s1: ready with peaks · s2: ready, peaks not built yet · s3: missing. */
function addSource(id: string, status: SourceStatus, withPeaks: boolean): void {
  const buffer = fakeAudioBuffer({ duration: 300, fill: (i) => Math.sin(i / 40) });
  registry.add({
    id,
    fileName: `${id}.wav`,
    status,
    buffer: status === 'ready' ? buffer : null,
    peaks: withPeaks
      ? buildPeaks([buffer.getChannelData(0)], buffer.sampleRate, PEAK_BLOCK_SIZE)
      : null,
    refCount: 0,
  });
}

function place(trackId: TrackId, sourceId: string, start: number, duration: number): string {
  const r = edit.addClip(trackId, sourceId, duration, start);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

beforeEach(() => {
  registry = createSourceRegistry();
  addSource('s1', 'ready', true);
  addSource('s2', 'ready', false);
  addSource('s3', 'missing', false);
  store = createProjectStore(createEmptyProject('Test', registry, 'p'));
  edit = createEditService(store);
  queries = createTimelineQueries(store);
  view = createViewStore(); // 100 px/s, scroll 0
  fake = createFakeCanvas();
  renderer = new TimelineRenderer(fake.ctx, {
    queries,
    project: () => store.get(),
    view: () => view.get(),
    colors,
    onClip: fake.markClip,
  });
  renderer.resize(1000, 400, 2); // 1000 px wide → 10 s visible
  A = edit.addTrack();
});

describe('rulerStep', () => {
  it.each([
    [1000, 0.1],
    [100, 1],
    [40, 5],
    [10, 10],
    [0.01, 600],
  ])('%d px/s → a label every %d s', (pxPerSecond, step) => {
    expect(rulerStep(pxPerSecond)).toBe(step);
  });
});

describe('TimelineRenderer', () => {
  it('scales the canvas by devicePixelRatio', () => {
    expect(fake.calls[0]).toMatchObject({ method: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
  });

  it('draws only the visible clips (viewport culling)', () => {
    const c0 = place(A, 's1', 0, 2);
    const c1 = place(A, 's1', 100, 2);
    const c2 = place(A, 's1', 200, 2);

    renderer.drawAll();
    expect([...fake.drawsPerClip().keys()]).toEqual([c0]);

    fake.reset();
    view.set({ scrollOffset: 99 });
    renderer.drawAll();
    expect([...fake.drawsPerClip().keys()]).toEqual([c1]);
    expect(fake.drawsPerClip().has(c2)).toBe(false);
  });

  it('draws every visible clip of every track', () => {
    const B = edit.addTrack();
    const a = place(A, 's1', 1, 2);
    const b = place(B, 's2', 3, 2);
    renderer.drawAll();
    expect(new Set(fake.drawsPerClip().keys())).toEqual(new Set([a, b]));
  });

  it("drawClipsUsing('s1') touches only clips of s1", () => {
    const B = edit.addTrack();
    const a = place(A, 's1', 0, 2);
    place(A, 's2', 3, 2);
    const c = place(B, 's1', 5, 2);
    place(B, 's3', 0, 2);
    place(A, 's1', 50, 2); // s1, but off screen

    renderer.drawClipsUsing('s1');
    expect(new Set(fake.drawsPerClip().keys())).toEqual(new Set([a, c]));
  });

  it('shows "Loading waveform" while peaks are null and the missing-audio label', () => {
    place(A, 's2', 0, 2);
    place(A, 's3', 3, 2);
    renderer.drawAll();
    expect(fake.texts()).toContain(MSG.loadingWaveform);
    expect(fake.texts()).toContain(MSG.missingAudioLabel('s3.wav'));
  });

  it('draws the waveform when peaks are ready', () => {
    const a = place(A, 's1', 0, 2);
    renderer.drawAll();
    expect(fake.texts()).not.toContain(MSG.loadingWaveform);
    const lines = fake.calls.filter((c) => c.clipId === a && c.method === 'lineTo');
    expect(lines.length).toBeGreaterThanOrEqual(200); // one line per pixel column
  });

  it('labels the clip with its file name and the ruler with times', () => {
    place(A, 's1', 0, 2);
    renderer.drawAll();
    expect(fake.texts()).toContain('s1.wav');
    expect(fake.texts()).toContain('00:01.000');
  });
});

describe('attachRedraws', () => {
  let frames: (() => void)[];
  const drawAll = vi.fn();
  const drawClipsUsing = vi.fn();

  function runFrame(): void {
    const pending = frames;
    frames = [];
    pending.forEach((f) => f());
  }

  function attach() {
    return attachRedraws({
      renderer: { drawAll, drawClipsUsing },
      store,
      view,
      queries,
      requestFrame: (f) => void frames.push(f),
    });
  }

  beforeEach(() => {
    frames = [];
    drawAll.mockClear();
    drawClipsUsing.mockClear();
  });

  it('coalesces changes in one frame into one drawAll', () => {
    attach();
    const a = place(A, 's1', 0, 2);
    edit.toggleMute(A);
    edit.moveClip(a, A, 4);
    view.set({ pxPerSecond: 200 });
    expect(frames).toHaveLength(1);
    runFrame();
    expect(drawAll).toHaveBeenCalledTimes(1);
    expect(drawClipsUsing).not.toHaveBeenCalled();
  });

  it('a peaks change redraws only the clips of that source', () => {
    attach();
    store.commit({ kind: 'peaks', sourceId: 's1' });
    store.commit({ kind: 'peaks', sourceId: 's2' });
    runFrame();
    expect(drawAll).not.toHaveBeenCalled();
    expect(drawClipsUsing.mock.calls).toEqual([['s1'], ['s2']]);
  });

  it('a full redraw in the same frame covers the peaks', () => {
    attach();
    store.commit({ kind: 'peaks', sourceId: 's1' });
    edit.toggleSolo(A);
    runFrame();
    expect(drawAll).toHaveBeenCalledTimes(1);
    expect(drawClipsUsing).not.toHaveBeenCalled();
  });

  it('saving draws nothing', () => {
    attach();
    store.markSaved();
    expect(frames).toHaveLength(0);
  });

  it('clears the selection when the selected clip is gone', () => {
    attach();
    const a = place(A, 's1', 0, 2);
    view.set({ selectedClipId: a, selection: { clipId: a, start: 0.5, end: 1 } });
    runFrame();
    drawAll.mockClear();

    edit.removeClip(a);
    expect(view.get()).toMatchObject({ selectedClipId: null, selection: null });
    runFrame();
    expect(drawAll).toHaveBeenCalledTimes(1);
  });

  it('keeps the selection while the clip exists', () => {
    attach();
    const a = place(A, 's1', 0, 4);
    view.set({ selectedClipId: a });
    edit.setFades(a, 1, 1);
    expect(view.get().selectedClipId).toBe(a);
  });

  it('requestAll schedules a redraw; dispose stops everything', () => {
    const redraws = attach();
    redraws.requestAll();
    runFrame();
    expect(drawAll).toHaveBeenCalledTimes(1);

    edit.toggleMute(A);
    redraws.dispose();
    runFrame(); // the frame requested before dispose draws nothing
    view.set({ scrollOffset: 3 });
    edit.toggleMute(A);
    expect(frames).toHaveLength(0);
    expect(drawAll).toHaveBeenCalledTimes(1);
  });
});
