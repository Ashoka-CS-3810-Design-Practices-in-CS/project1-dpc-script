import { SAMPLE_RATE } from '@/model/constants';

/** The one place that touches browser-only audio classes (A3 R1). */
export function createDecodeContext(): {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
} {
  // An offline context resamples to the project rate and needs no user gesture.
  return new OfflineAudioContext(1, 1, SAMPLE_RATE);
}

/** The context playback runs on. Created on the first Play, which is a user gesture. */
export function createLiveContext(): AudioContext {
  return new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
}

/** The context an export is rendered on. */
export function createOfflineContext(
  channels: number,
  length: number,
  sampleRate: number,
): OfflineAudioContext {
  return new OfflineAudioContext(channels, length, sampleRate);
}
