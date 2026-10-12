import { describe, expect, it, vi } from 'vitest';
import { PX_PER_SECOND_DEFAULT, PX_PER_SECOND_MAX, PX_PER_SECOND_MIN } from '@/model/constants';
import { createViewStore } from '@/ui/viewStore';

describe('createViewStore', () => {
  it('has the documented defaults', () => {
    expect(createViewStore().get()).toEqual({
      pxPerSecond: PX_PER_SECOND_DEFAULT,
      scrollOffset: 0,
      snapEnabled: true,
      selectedTrackId: null,
      selectedClipId: null,
      selection: null,
    });
  });

  it('applies and clamps the initial values', () => {
    const view = createViewStore({ pxPerSecond: 5, scrollOffset: -3, snapEnabled: false });
    expect(view.get()).toMatchObject({
      pxPerSecond: PX_PER_SECOND_MIN,
      scrollOffset: 0,
      snapEnabled: false,
    });
  });

  it('clamps zoom to [min, max] and scroll to ≥ 0 on set', () => {
    const view = createViewStore();
    view.set({ pxPerSecond: 1e6, scrollOffset: -1 });
    expect(view.get().pxPerSecond).toBe(PX_PER_SECOND_MAX);
    expect(view.get().scrollOffset).toBe(0);
    view.set({ pxPerSecond: 1, scrollOffset: 12.5 });
    expect(view.get().pxPerSecond).toBe(PX_PER_SECOND_MIN);
    expect(view.get().scrollOffset).toBe(12.5);
  });

  it('keeps fields that the patch does not mention', () => {
    const view = createViewStore();
    view.set({ selectedClipId: 'c1', selection: { clipId: 'c1', start: 1, end: 2 } });
    view.set({ pxPerSecond: 200 });
    expect(view.get()).toMatchObject({
      pxPerSecond: 200,
      selectedClipId: 'c1',
      selection: { clipId: 'c1', start: 1, end: 2 },
    });
  });

  it('creates a new snapshot object on every set', () => {
    const view = createViewStore();
    const before = view.get();
    view.set({});
    expect(view.get()).not.toBe(before);
    expect(view.get()).toEqual(before);
  });

  it('notifies listeners until they unsubscribe', () => {
    const view = createViewStore();
    const listener = vi.fn();
    const unsubscribe = view.subscribe(listener);
    view.set({ snapEnabled: false });
    unsubscribe();
    view.set({ snapEnabled: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
