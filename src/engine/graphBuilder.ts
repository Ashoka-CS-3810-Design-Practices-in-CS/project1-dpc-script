import { resolveGains } from '@/algorithms/mix';
import type { AudioContextLike, BufferSourceLike, GainLike, NodeLike } from '@/engine/audioTypes';
import type { EffectRegistry } from '@/engine/effects';
import type { Project, TrackId } from '@/model/types';

export interface MixGraph {
  master: GainLike;
  trackGains: Map<TrackId, GainLike>;
  players: BufferSourceLike[];
}

/**
 * A2 Algorithm 10: builds the audio graph for playing `project` from position `p`.
 * `tc` is the context time that position `p` should sound at. Playback and export both
 * call this, which is why the export matches what you heard.
 *
 *   player → effects → track gain → master gain → destination
 */
export function buildMix(
  ctx: AudioContextLike,
  project: Project,
  p: number,
  tc: number,
  effects: EffectRegistry,
): MixGraph {
  // Master stays at 1: the output is never louder than the source audio.
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  const gains = resolveGains(project.tracks);
  const trackGains = new Map<TrackId, GainLike>();
  const players: BufferSourceLike[] = [];

  project.tracks.forEach((track, i) => {
    // A silent track still gets its clips scheduled, just at gain 0.
    const trackGain = ctx.createGain();
    trackGain.gain.value = gains[i];
    trackGain.connect(master);
    trackGains.set(track.id, trackGain);

    for (const clip of track.clips) {
      if (clip.startTime + clip.duration <= p) continue; // already over

      const source = project.sources.get(clip.sourceId);
      if (source?.status !== 'ready' || !source.buffer) continue; // still loading, or missing

      const w = tc + Math.max(0, clip.startTime - p); // when it starts sounding
      const t0 = Math.max(0, p - clip.startTime); // how far into the clip we begin

      const player = ctx.createBufferSource();
      player.buffer = source.buffer;
      let node: NodeLike = player;
      for (const effect of effects.list()) node = effect.apply(ctx, node, clip, t0, w);
      node.connect(trackGain);

      player.start(w, clip.sourceOffset + t0, clip.duration - t0);
      players.push(player);
    }
  });

  return { master, trackGains, players };
}
