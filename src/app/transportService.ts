import type { TransportService } from '@/app/contracts';
import { fail } from '@/model/result';

/** Stub (AB-06): never plays. Real implementation: AB-08. */
export function createTransportService(): TransportService {
  const play = async () => fail('Playback is not available yet.');
  return {
    play,
    togglePlay: play,
    pause: () => {},
    stop: () => {},
    seek: () => {},
    position: () => 0,
    state: () => 'stopped',
    subscribe: () => () => {},
  };
}
