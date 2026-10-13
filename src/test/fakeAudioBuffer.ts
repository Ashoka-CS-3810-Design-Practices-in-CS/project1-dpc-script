import { SAMPLE_RATE } from '@/model/constants';

export interface FakeAudioBufferOptions {
  duration: number; // seconds
  sampleRate?: number;
  channels?: number;
  /** Sample value at `index` of `channel`; silence when omitted. */
  fill?: (index: number, channel: number) => number;
}

/** An object with the AudioBuffer fields we use, for node tests (no Web Audio there). */
export function fakeAudioBuffer({
  duration,
  sampleRate = SAMPLE_RATE,
  channels = 1,
  fill,
}: FakeAudioBufferOptions): AudioBuffer {
  const length = Math.round(duration * sampleRate);
  const data = Array.from({ length: channels }, (_, channel) => {
    const samples = new Float32Array(length);
    if (fill) for (let i = 0; i < length; i++) samples[i] = fill(i, channel);
    return samples;
  });
  return {
    duration: length / sampleRate,
    length,
    sampleRate,
    numberOfChannels: channels,
    getChannelData(channel: number): Float32Array {
      const samples = data[channel];
      if (!samples) throw new RangeError(`No channel ${channel} (buffer has ${channels}).`);
      return samples;
    },
  } as unknown as AudioBuffer;
}
