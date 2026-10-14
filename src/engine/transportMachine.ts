export type TState = 'stopped' | 'playing' | 'paused';
export type TEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; to: number }
  | { type: 'error'; message: string }
  | { type: 'ended'; end: number };
export interface Machine {
  state: TState;
  position: number;
}
export type Effect = 'build' | 'stopPlayers' | 'showError';

interface Result {
  next: Machine;
  effects: Effect[];
}

const stopped = (position: number): Machine => ({ state: 'stopped', position });

/** Returns null when the event is ignored (README §9.1). `current` = live position when playing. */
export function transition(m: Machine, e: TEvent, current: number): Result | null {
  switch (e.type) {
    case 'play':
      if (m.state === 'playing') return null;
      return { next: { state: 'playing', position: m.position }, effects: ['build'] };

    case 'pause':
      if (m.state !== 'playing') return null;
      return { next: { state: 'paused', position: current }, effects: ['stopPlayers'] };

    case 'stop':
      if (m.state === 'stopped') return null;
      return { next: stopped(0), effects: ['stopPlayers'] };

    case 'seek':
      // Only a playing machine has anything to restart; the others just move the playhead.
      if (m.state === 'playing') {
        return {
          next: { state: 'playing', position: e.to },
          effects: ['stopPlayers', 'build'],
        };
      }
      return { next: { ...m, position: e.to }, effects: [] };

    case 'error':
      // Playing keeps the spot it reached; otherwise the position stays as it was.
      return {
        next: stopped(m.state === 'playing' ? current : m.position),
        effects: ['stopPlayers', 'showError'],
      };

    case 'ended':
      if (m.state !== 'playing') return null;
      return { next: stopped(e.end), effects: ['stopPlayers'] };
  }
}
