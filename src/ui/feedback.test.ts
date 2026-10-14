import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS } from '@/model/constants';
import {
  confirmDialog,
  dismissToast,
  notify,
  resolveConfirm,
  subscribeConfirm,
  subscribeToasts,
  type ConfirmRequest,
  type Toast,
} from './feedback';

const req = (title: string): ConfirmRequest => ({ title, message: 'sure?', confirmLabel: 'Yes' });

describe('toasts', () => {
  let latest: Toast[] = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    unsubscribe = subscribeToasts((t) => (latest = t));
  });

  afterEach(() => {
    latest.forEach((t) => dismissToast(t.id));
    unsubscribe();
    vi.useRealTimers();
  });

  it('shows a toast and hides success/warning after TOAST_MS', () => {
    notify.success('saved');
    notify.warning('careful');
    expect(latest.map((t) => [t.kind, t.message])).toEqual([
      ['success', 'saved'],
      ['warning', 'careful'],
    ]);

    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(latest).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(latest).toHaveLength(0);
  });

  it('keeps errors until they are dismissed', () => {
    notify.error('broke');
    vi.advanceTimersByTime(TOAST_MS * 10);
    expect(latest).toHaveLength(1);

    dismissToast(latest[0].id);
    expect(latest).toHaveLength(0);
  });

  it('tells a new subscriber about toasts already showing', () => {
    notify.error('already here');
    const seen = vi.fn();
    subscribeToasts(seen)();
    expect(seen).toHaveBeenCalledWith(latest);
  });

  it('stops calling a listener once it unsubscribes', () => {
    const seen = vi.fn();
    const off = subscribeToasts(seen);
    off();
    seen.mockClear();
    notify.error('nobody listening');
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('confirmDialog', () => {
  it('resolves true or false from the answer', async () => {
    const yes = confirmDialog(req('first'));
    resolveConfirm(true);
    await expect(yes).resolves.toBe(true);

    const no = confirmDialog(req('second'));
    resolveConfirm(false);
    await expect(no).resolves.toBe(false);
  });

  it('shows one request at a time and queues the rest', async () => {
    const shown: (string | undefined)[] = [];
    const off = subscribeConfirm((r) => shown.push(r?.title));

    const a = confirmDialog(req('A'));
    const b = confirmDialog(req('B'));
    expect(shown).toEqual([undefined, 'A']); // B waits; the dialog still shows A

    resolveConfirm(true);
    await expect(a).resolves.toBe(true);
    expect(shown).toEqual([undefined, 'A', 'B']);

    resolveConfirm(false);
    await expect(b).resolves.toBe(false);
    expect(shown).toEqual([undefined, 'A', 'B', undefined]);

    off();
  });

  it('ignores an answer when nothing is asked', () => {
    expect(() => resolveConfirm(true)).not.toThrow();
  });

  it('stops calling a listener once it unsubscribes', () => {
    const seen = vi.fn();
    subscribeConfirm(seen)();
    seen.mockClear();
    void confirmDialog(req('unheard'));
    expect(seen).not.toHaveBeenCalled();
    resolveConfirm(false);
  });
});
