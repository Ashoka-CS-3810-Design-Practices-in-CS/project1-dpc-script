import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPeaks } from '@/algorithms/peaks';
import type { EditService, ProjectStore } from '@/app/contracts';
import { createEditService } from '@/app/editService';
import { createProjectStore } from '@/app/store';
import { createTimelineQueries } from '@/app/timelineQueries';
import { PEAK_BLOCK_SIZE } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';
import type { SourceRegistry, TrackId } from '@/model/types';
import { createFakeCanvas, type FakeCanvas } from '@/test/fakeCanvas';
import { fakeAudioBuffer } from '@/test/fakeAudioBuffer';
import { attachRedraws, TimelineRenderer, type Palette } from '@/ui/timeline/renderer';
import { createViewStore } from '@/ui/viewStore';

/** A3 §2.3: real store, EditService and renderer (fake canvas, fake animation frames). Every
 *  edit redraws the timeline exactly once; arriving peaks redraw only the clips using them. */

const colors = Object.fromEntries(
  [
    'bg',
    'panelBg',
    'fg',
    'mutedFg',
    'border',
    'accent',
    'selection',
    'invalid',
    'rowSelected',
    'clipBg',
    'clipHeader',
    'waveform',
    'fadeShade',
  ].map((k) => [k, k]),
) as unknown as Palette;

let registry: SourceRegistry;
let store: ProjectStore;
let edit: EditService;
let fake: FakeCanvas;
let renderer: TimelineRenderer;
let frames: (() => void)[];
let A: TrackId;
let B: TrackId;
let c1: string;
let c2: string;
let c3: string;

function runFrames(): void {
  while (frames.length > 0) frames.shift()!();
}

function place(trackId: TrackId, sourceId: string, start: number, duration: number): string {
  const r = edit.addClip(trackId, sourceId, duration, start);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

beforeEach(() => {
  registry = createSourceRegistry();
  for (const id of ['s1', 's2']) {
    registry.add({
      id,
      fileName: `${id}.wav`,
      status: 'ready',
      buffer: fakeAudioBuffer({ duration: 30, fill: (i) => Math.sin(i / 30) }),
      peaks: null,
      refCount: 0,
    });
  }
  store = createProjectStore(createEmptyProject('Test', registry, 'p'));
  edit = createEditService(store);
  const queries = createTimelineQueries(store);
  const view = createViewStore();
  fake = createFakeCanvas();
  renderer = new TimelineRenderer(fake.ctx, {
    queries,
    project: () => store.get(),
    view: () => view.get(),
    colors,
    onClip: fake.markClip,
  });
  renderer.resize(1000, 400, 1);
  frames = [];
  attachRedraws({ renderer, store, view, queries, requestFrame: (f) => void frames.push(f) });

  A = edit.addTrack();
  B = edit.addTrack();
  c1 = place(A, 's1', 0, 4);
  c2 = place(A, 's2', 5, 4);
  c3 = place(B, 's1', 1, 2);
  expect(edit.setFades(c2, 0.5, 0.5).ok).toBe(true);
  runFrames(); // the set-up edits draw once
});

describe('one redraw per edit (A3 §2.3)', () => {
  it.each<[string, () => boolean]>([
    ['move', () => edit.moveClip(c2, A, 6).ok],
    ['move to another track', () => edit.moveClip(c2, B, 4).ok],
    ['split', () => edit.split(c1, 2).ok],
    ['trim to selection', () => edit.trimToSelection(c1, 1, 3).ok],
    ['trim an edge', () => edit.trimEdge(c3, 'end', 2.5).ok],
    ['delete a region', () => edit.deleteRegion(c1, 1, 2).ok],
    ['fade', () => edit.setFades(c1, 0.5, 1).ok],
    [
      'mute',
      () => {
        edit.toggleMute(B);
        return true;
      },
    ],
    [
      'volume',
      () => {
        edit.setVolume(A, 0.3);
        return true;
      },
    ],
  ])('%s → exactly one drawAll', (_, run) => {
    const drawAll = vi.spyOn(renderer, 'drawAll');
    const drawClipsUsing = vi.spyOn(renderer, 'drawClipsUsing');
    expect(run()).toBe(true);
    runFrames();
    expect(drawAll).toHaveBeenCalledTimes(1);
    expect(drawClipsUsing).not.toHaveBeenCalled();
  });

  it('a failed edit draws nothing', () => {
    const drawAll = vi.spyOn(renderer, 'drawAll');
    expect(edit.moveClip(c2, A, 2).ok).toBe(false); // overlaps c1
    runFrames();
    expect(drawAll).not.toHaveBeenCalled();
  });
});

describe('peaks redraw only their clips', () => {
  it('a peaks commit for s1 redraws only the clips using s1', () => {
    const drawAll = vi.spyOn(renderer, 'drawAll');
    const buffer = registry.get('s1')!.buffer!;
    registry.update('s1', {
      peaks: buildPeaks([buffer.getChannelData(0)], buffer.sampleRate, PEAK_BLOCK_SIZE),
    });
    store.commit({ kind: 'peaks', sourceId: 's1' });
    fake.reset();
    runFrames();

    expect(drawAll).not.toHaveBeenCalled();
    expect(new Set(fake.drawsPerClip().keys())).toEqual(new Set([c1, c3]));
  });
});
