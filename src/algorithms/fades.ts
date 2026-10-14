/** A7: min(1, t/a, (d − t)/b); a term is omitted when its fade length is 0. 0 outside [0, d]. */
export function fadeVolume(t: number, d: number, a: number, b: number): number {
  if (t < 0 || t > d) return 0;
  let volume = 1;
  if (a > 0) volume = Math.min(volume, t / a);
  if (b > 0) volume = Math.min(volume, (d - t) / b);
  return volume;
}

/** One automation event; `time` is seconds after the clip starts playing (i.e. after w). */
export interface GainEvent {
  kind: 'set' | 'ramp';
  value: number;
  time: number;
}

/** A2 Algorithm 9 for a clip of length d, fades a/b, playback starting t0 seconds into the clip. */
export function fadeSchedule(d: number, a: number, b: number, t0: number): GainEvent[] {
  // Start at whatever the volume is at t0, so playing from the middle of a fade still sounds right.
  const events: GainEvent[] = [{ kind: 'set', value: fadeVolume(t0, d, a, b), time: 0 }];

  // Still inside the fade-in: ramp up to full volume.
  if (t0 < a) events.push({ kind: 'ramp', value: 1, time: a - t0 });

  if (b > 0) {
    // Hold full volume until the fade-out begins (skip if we start inside the fade-out).
    if (t0 < d - b) events.push({ kind: 'set', value: 1, time: d - b - t0 });
    events.push({ kind: 'ramp', value: 0, time: d - t0 });
  }

  return events;
}
