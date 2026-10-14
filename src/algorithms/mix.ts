import type { TrackMixLike } from '@/algorithms/types';

/** If anything is soloed only soloed tracks are heard (solo beats mute), otherwise unmuted ones. */
export function isAudible(track: TrackMixLike, anySoloed: boolean): boolean {
  return anySoloed ? track.soloed : !track.muted;
}

/** One gain per track: its volume if heard, 0 if not (its clips still stay scheduled). */
export function resolveGains(tracks: readonly TrackMixLike[]): number[] {
  const anySoloed = tracks.some((t) => t.soloed);
  return tracks.map((t) => (isAudible(t, anySoloed) ? t.volume : 0));
}
