import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportEvent } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { createProjectStore } from '@/app/store';
import { createTransportService } from '@/app/transportService';
import type { PlaybackEngine } from '@/engine/playbackEngine';
import { SAMPLE_RATE } from '@/model/constants';
import { createEmptyProject } from '@/model/projectOps';
import { createSourceRegistry } from '@/model/sourceRegistry';

/** An engine with a clock the test moves by hand. */
function fakeEngine() {
  const calls: string[] = [];
  const errorListeners: Array<(m: string) => void> = [];
  let clock = 100;
  let rejectNext: Error | null = null;
  let held = false;
  const waiting: Array<() => void> = [];
  const engine: PlaybackEngine = {
    prepare: () => {},
    start: async (_project, p) => {
      calls.push(`start ${p}`);
      if (rejectNext) {
        const error = rejectNext;
        rejectNext = null;
        throw error;
      }
      if (held) await new Promise<void>((resolve) => waiting.push(resolve));
      return clock + 0.05;
    },
    stopAll: () => void calls.push('stopAll'),
    updateGains: () => void calls.push('updateGains'),
    now: () => clock,
    onError: (listener) => {
      errorListeners.push(listener);
      return () => {};
    },
  };
  return {
    engine,
    calls,
    advance: (s: number) => (clock += s),
    failNextStart: () => (rejectNext = new Error('no output')),
    holdStart: () => (held = true),
    releaseStart: () => {
      held = false;
      waiting.splice(0).forEach((resolve) => resolve());
    },
    raiseError: () => errorListeners.forEach((l) => l('gone')),
  };
}

/** A store with one 10 s clip (the project ends at 10 s), unless `empty`. */
function setup(empty = false) {
  const project = createEmptyProject('p', createSourceRegistry());
  if (!empty) {
    project.tracks.push({
      id: 't',
      name: 'T',
      volume: 1,
      muted: false,
      soloed: false,
      clips: [
        {
          id: 'c',
          sourceId: 's',
          startTime: 0,
          sourceOffset: 0,
          duration: 10,
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
    });
  }
  const store = createProjectStore(project);
  const fake = fakeEngine();
  const transport = createTransportService({ store, engine: fake.engine });
  const events: TransportEvent[] = [];
  transport.subscribe((e) => events.push(e));
  return { store, transport, events, ...fake };
}

describe('transport service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Stopped + Play → Playing, builds from the playhead', async () => {
    const { transport, calls, events, advance } = setup();
    transport.seek(2);
    expect(await transport.play()).toEqual({ ok: true, value: undefined });
    expect(transport.state()).toBe('playing');
    expect(calls).toContain('start 2');
    expect(events.at(-1)).toEqual({ state: 'playing' });

    advance(0.05); // reaches tc, the moment position 2 sounds
    expect(transport.position()).toBeCloseTo(2);
    advance(1.5);
    expect(transport.position()).toBeCloseTo(3.5);
  });

  it('Pause holds the position and stops the players; Play resumes from it', async () => {
    const { transport, calls, advance } = setup();
    await transport.play();
    advance(0.05 + 3);
    transport.pause();
    expect(transport.state()).toBe('paused');
    expect(transport.position()).toBeCloseTo(3);
    expect(calls.at(-1)).toBe('stopAll');

    advance(5); // time passing while paused changes nothing
    expect(transport.position()).toBeCloseTo(3);

    await transport.play();
    expect(transport.state()).toBe('playing');
    expect(calls.at(-1)).toMatch(/^start 3/);
  });

  it('clamps seeks to [0, project end]', () => {
    const { transport } = setup();
    transport.seek(-0.001);
    expect(transport.position()).toBe(0);
    transport.seek(10 + 1 / SAMPLE_RATE);
    expect(transport.position()).toBe(10);
  });

  it('seeking to the end while playing stops at the end', async () => {
    const { transport } = setup();
    await transport.play();
    transport.seek(99);
    expect(transport.state()).toBe('stopped');
    expect(transport.position()).toBe(10);
  });

  describe('edits during playback', () => {
    it('a mix change ramps the gains without rebuilding', async () => {
      const { transport, store, calls } = setup();
      await transport.play();
      calls.length = 0;
      store.commit({ kind: 'mix' });
      expect(calls).toEqual(['updateGains']);
    });

    it('a structure or sources change rebuilds from the current position', async () => {
      const { transport, store, calls, advance } = setup();
      await transport.play();
      advance(0.05 + 2);
      calls.length = 0;
      store.commit({ kind: 'structure' });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual(['stopAll', 'start 2']);

      advance(0.05 + 1);
      calls.length = 0;
      store.commit({ kind: 'sources', sourceId: 's' });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual(['stopAll', 'start 3']);
    });
  });

  describe('errors', () => {
    it('an engine error while playing → Stopped, position kept, event carries the message', async () => {
      const { transport, events, raiseError, advance } = setup();
      await transport.play();
      advance(0.05 + 4);
      raiseError();
      expect(transport.state()).toBe('stopped');
      expect(transport.position()).toBeCloseTo(4);
      expect(events.at(-1)).toEqual({ state: 'stopped', error: MSG.playbackNoOutput });
    });
  });
});
