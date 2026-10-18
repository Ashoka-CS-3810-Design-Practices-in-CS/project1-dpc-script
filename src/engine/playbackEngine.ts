import { resolveGains } from '@/algorithms/mix';
import type { AudioContextLike } from '@/engine/audioTypes';
import type { EffectRegistry } from '@/engine/effects';
import { buildMix, type MixGraph } from '@/engine/graphBuilder';
import { GAIN_RAMP_S, SCHEDULE_MARGIN_S } from '@/model/constants';
import type { Project } from '@/model/types';

/** The live context: AudioContextLike plus the bits needed to wake it and watch its state. */
export interface LiveContext extends AudioContextLike {
  resume(): Promise<void>;
  state: string;
  onstatechange: (() => void) | null;
}

export interface PlaybackEngine {
  /** Resumes the context, builds the mix from `p` and returns `tc`, the context time of `p`. */
  start(project: Project, p: number): Promise<number>;
  /** Stops and disconnects every player and gain. */
  stopAll(): void;
  /** A6 live: ramps the track gains to match mute/solo/volume without rebuilding. */
  updateGains(project: Project): void;
  /** The context clock. */
  now(): number;
  /** Called when the output goes away while playing. The text is for logs, not for the user. */
  onError(listener: (message: string) => void): () => void;
}

export function createPlaybackEngine(
  createContext: () => LiveContext,
  effects: EffectRegistry,
): PlaybackEngine {
  let ctx: LiveContext | null = null;
  let graph: MixGraph | null = null;
  const listeners = new Set<(message: string) => void>();
  // Starts run one after another, so a slow resume can't finish after a later start.
  let queue: Promise<unknown> = Promise.resolve();

  function report(message: string): void {
    for (const listener of [...listeners]) listener(message);
  }

  // Made on the first start, because browsers only allow audio after a user gesture.
  function context(): LiveContext {
    if (ctx) return ctx;
    const created = createContext();
    created.onstatechange = () => {
      const state = created.state;
      // We never suspend or close the context ourselves, so any of these means the output is gone.
      if (state === 'interrupted' || state === 'closed' || (state === 'suspended' && graph)) {
        report(`audio context ${state}`);
      }
    };
    ctx = created;
    return created;
  }

  function stopAll(): void {
    if (!graph) return;
    for (const player of graph.players) {
      player.onended = null;
      try {
        player.stop();
      } catch {
        // Already stopped.
      }
      player.disconnect();
    }
    for (const gain of graph.trackGains.values()) gain.disconnect();
    graph.master.disconnect();
    graph = null;
  }

  async function startNow(project: Project, p: number): Promise<number> {
    const live = context();
    await live.resume();
    stopAll();
    const tc = live.currentTime + SCHEDULE_MARGIN_S;
    graph = buildMix(live, project, p, tc, effects);
    return tc;
  }

  return {
    start(project, p) {
      const run = queue.then(() => startNow(project, p));
      queue = run.catch(() => {});
      return run;
    },

    stopAll,

    updateGains(project) {
      if (!graph || !ctx) return;
      const now = ctx.currentTime;
      const gains = resolveGains(project.tracks);
      project.tracks.forEach((track, i) => {
        const node = graph?.trackGains.get(track.id);
        if (!node) return;
        // Pin the current value first, so the ramp starts where the sound is now.
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.linearRampToValueAtTime(gains[i], now + GAIN_RAMP_S);
      });
    },

    now: () => ctx?.currentTime ?? 0,

    onError(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
