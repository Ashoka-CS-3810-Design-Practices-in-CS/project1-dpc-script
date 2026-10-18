import type {
  ProjectStore,
  TransportEvent,
  TransportService,
  TransportState,
} from '@/app/contracts';
import { MSG } from '@/app/messages';
import type { PlaybackEngine } from '@/engine/playbackEngine';
import { transition, type Machine, type TEvent } from '@/engine/transportMachine';
import { projectEnd } from '@/model/projectOps';
import { fail, ok, type Result } from '@/model/result';

/** How often playback checks whether it has reached the end of the project. */
const END_CHECK_MS = 50;

export interface TransportDeps {
  store: ProjectStore;
  engine: PlaybackEngine;
}

/** DS6 + A8: the transport state machine, driving the playback engine. */
export function createTransportService({ store, engine }: TransportDeps): TransportService {
  let m: Machine = { state: 'stopped', position: 0 };
  // Context time at which m.position sounded. Infinity while a build is pending, so the
  // playhead waits at m.position until the audio is really scheduled.
  let tc = 0;
  // Bumped whenever the players are stopped or rebuilt, so a slow build can tell it is out of date.
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<(e: TransportEvent) => void>();

  const end = () => projectEnd(store.get());

  function position(): number {
    if (m.state !== 'playing') return m.position;
    return Math.min(end(), m.position + Math.max(0, engine.now() - tc));
  }

  function emit(error?: string): void {
    const event: TransportEvent =
      error === undefined ? { state: m.state } : { state: m.state, error };
    for (const listener of [...listeners]) listener(event);
  }

  // The end check only runs while playing.
  function syncTimer(): void {
    if (m.state === 'playing' && timer === undefined) {
      timer = setInterval(() => {
        if (position() >= end()) apply({ type: 'ended', end: end() });
      }, END_CHECK_MS);
    } else if (m.state !== 'playing' && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  /** Runs one event through the state machine. Returns its effects, or null if it is ignored. */
  function apply(event: TEvent, showError = true): string[] | null {
    const before = m.state;
    const result = transition(m, event, position());
    if (!result) return null;
    m = result.next;
    if (result.effects.includes('stopPlayers')) {
      generation += 1;
      engine.stopAll();
    }
    syncTimer();
    const message = showError && event.type === 'error' ? event.message : undefined;
    if (m.state !== before || message !== undefined) emit(message);
    return result.effects;
  }

  /** Schedules the mix from m.position. false if the engine could not start. */
  async function build(showError: boolean): Promise<boolean> {
    const mine = ++generation;
    tc = Infinity;
    try {
      const scheduledAt = await engine.start(store.get(), m.position);
      if (mine !== generation) {
        // Stopped or paused while the engine was starting: don't leave its sound running.
        if (m.state !== 'playing') engine.stopAll();
        return true;
      }
      tc = scheduledAt;
      return true;
    } catch {
      if (mine !== generation) return true;
      apply({ type: 'error', message: MSG.playbackNoOutput }, showError);
      return false;
    }
  }

  function seekTo(t: number): void {
    const total = end();
    const to = Math.min(total, Math.max(0, t));
    // Seeking to the very end while playing has nothing left to play.
    const event: TEvent =
      m.state === 'playing' && to >= total ? { type: 'ended', end: total } : { type: 'seek', to };
    if (apply(event)?.includes('build')) void build(true);
  }

  function pause(): void {
    apply({ type: 'pause' });
  }

  async function play(): Promise<Result> {
    const total = end();
    if (total === 0) return fail(MSG.nothingToPlay);
    // Play after the end starts over instead of finishing instantly.
    if (m.state !== 'playing' && m.position >= total) m = { ...m, position: 0 };
    if (!apply({ type: 'play' })) return ok(undefined);
    // A failed play is reported through the returned Result, so the event carries no error.
    if (!(await build(false))) return fail(MSG.playbackNoOutput);
    performance.mark('dpcs:play-scheduled');
    return ok(undefined);
  }

  // README §9.1: what an edit does to a running playback.
  store.subscribe((change) => {
    if (change.kind === 'project') {
      // A different project: stop, and put the playhead back at 0 even if already stopped.
      if (!apply({ type: 'stop' })) m = { ...m, position: 0 };
    } else if (m.state !== 'playing') return;
    else if (change.kind === 'mix') engine.updateGains(store.get());
    else if (change.kind === 'structure' || change.kind === 'sources') seekTo(position());
  });

  engine.onError(() => {
    apply({ type: 'error', message: MSG.playbackNoOutput });
  });

  return {
    play,
    pause,
    togglePlay: () => {
      if (m.state !== 'playing') return play();
      pause();
      return Promise.resolve(ok(undefined));
    },
    stop: () => {
      apply({ type: 'stop' });
    },
    seek: seekTo,
    position,
    state: (): TransportState => m.state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
