import { SAMPLE_RATE } from '@/model/constants';

/** The one place that touches browser-only audio classes (A3 R1). */
export function createDecodeContext(): {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
} {
  // An offline context resamples to the project rate and needs no user gesture.
  return new OfflineAudioContext(1, 1, SAMPLE_RATE);
}
