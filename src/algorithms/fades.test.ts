import { describe, expect, it } from 'vitest';
import { fadeSchedule, fadeVolume, type GainEvent } from './fades';

describe('fadeVolume', () => {
  // 10 s clip, 2 s fade-in, 4 s fade-out
  const vol = (t: number) => fadeVolume(t, 10, 2, 4);

  it('fades in from silence to full volume', () => {
    expect(vol(0)).toBe(0);
    expect(vol(1)).toBeCloseTo(0.5);
    expect(vol(2)).toBe(1);
  });

  it('stays at full volume between the fades', () => {
    expect(vol(4)).toBe(1);
    expect(vol(6)).toBe(1);
  });

  it('fades out from full volume to silence', () => {
    expect(vol(8)).toBeCloseTo(0.5);
    expect(vol(10)).toBe(0);
  });

  it('ignores the fade-in when a = 0', () => {
    expect(fadeVolume(0, 10, 0, 4)).toBe(1);
    expect(fadeVolume(8, 10, 0, 4)).toBeCloseTo(0.5);
  });

  it('ignores the fade-out when b = 0', () => {
    expect(fadeVolume(1, 10, 2, 0)).toBeCloseTo(0.5);
    expect(fadeVolume(10, 10, 2, 0)).toBe(1);
  });

  it('is 1 everywhere inside the clip when there are no fades', () => {
    expect(fadeVolume(0, 10, 0, 0)).toBe(1);
    expect(fadeVolume(5, 10, 0, 0)).toBe(1);
    expect(fadeVolume(10, 10, 0, 0)).toBe(1);
  });

  it('handles fades that fill the whole clip (a + b = d)', () => {
    expect(fadeVolume(2, 10, 4, 6)).toBeCloseTo(0.5);
    expect(fadeVolume(4, 10, 4, 6)).toBe(1);
    expect(fadeVolume(7, 10, 4, 6)).toBeCloseTo(0.5);
  });

  it('is 0 outside the clip', () => {
    expect(vol(-1)).toBe(0);
    expect(vol(11)).toBe(0);
    expect(fadeVolume(-1, 10, 0, 0)).toBe(0);
  });
});

describe('fadeSchedule', () => {
  // Work out the gain at time x by walking the events like Web Audio would.
  function gainAt(events: GainEvent[], x: number): number {
    let prev = events[0];
    for (const event of events.slice(1)) {
      if (event.kind === 'set') {
        if (x < event.time) return prev.value;
      } else if (x <= event.time) {
        if (event.time === prev.time) return event.value;
        const progress = (x - prev.time) / (event.time - prev.time);
        return prev.value + progress * (event.value - prev.value);
      }
      prev = event;
    }
    return prev.value;
  }

  function expectMatchesFadeVolume(d: number, a: number, b: number, t0: number): void {
    const events = fadeSchedule(d, a, b, t0);
    const length = d - t0;
    for (let i = 0; i <= 10; i++) {
      const time = (length * i) / 10;
      expect(gainAt(events, time)).toBeCloseTo(fadeVolume(t0 + time, d, a, b));
    }
  }

  it('starts from the beginning of the clip', () => {
    expect(fadeSchedule(10, 2, 4, 0)).toEqual([
      { kind: 'set', value: 0, time: 0 },
      { kind: 'ramp', value: 1, time: 2 },
      { kind: 'set', value: 1, time: 6 },
      { kind: 'ramp', value: 0, time: 10 },
    ]);
    expectMatchesFadeVolume(10, 2, 4, 0);
  });

  it('starts inside the fade-in', () => {
    expect(fadeSchedule(10, 2, 4, 1)).toEqual([
      { kind: 'set', value: 0.5, time: 0 },
      { kind: 'ramp', value: 1, time: 1 },
      { kind: 'set', value: 1, time: 5 },
      { kind: 'ramp', value: 0, time: 9 },
    ]);
    expectMatchesFadeVolume(10, 2, 4, 1);
  });

  it('starts in the flat part', () => {
    expect(fadeSchedule(10, 2, 4, 3)).toEqual([
      { kind: 'set', value: 1, time: 0 },
      { kind: 'set', value: 1, time: 3 },
      { kind: 'ramp', value: 0, time: 7 },
    ]);
    expectMatchesFadeVolume(10, 2, 4, 3);
  });

  it('starts inside the fade-out', () => {
    expect(fadeSchedule(10, 2, 4, 8)).toEqual([
      { kind: 'set', value: 0.5, time: 0 },
      { kind: 'ramp', value: 0, time: 2 },
    ]);
    expectMatchesFadeVolume(10, 2, 4, 8);
  });

  it('has no fade-out events when b = 0', () => {
    expect(fadeSchedule(10, 2, 0, 0)).toEqual([
      { kind: 'set', value: 0, time: 0 },
      { kind: 'ramp', value: 1, time: 2 },
    ]);
    expectMatchesFadeVolume(10, 2, 0, 0);
  });

  it('has no fade-in events when a = 0', () => {
    expect(fadeSchedule(10, 0, 4, 0)).toEqual([
      { kind: 'set', value: 1, time: 0 },
      { kind: 'set', value: 1, time: 6 },
      { kind: 'ramp', value: 0, time: 10 },
    ]);
    expectMatchesFadeVolume(10, 0, 4, 0);
  });

  it('is just a constant gain with no fades', () => {
    expect(fadeSchedule(10, 0, 0, 0)).toEqual([{ kind: 'set', value: 1, time: 0 }]);
  });
});
