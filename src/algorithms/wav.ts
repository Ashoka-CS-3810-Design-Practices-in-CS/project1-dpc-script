const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

/** −1.0 → −32768, 1.0 → 32767, |x| > 1 limited. Negative: x·32768, positive: x·32767, rounded. */
export function floatToInt16(x: number): number {
  const limited = Math.max(-1, Math.min(1, x));
  return Math.round(limited < 0 ? limited * 32768 : limited * 32767);
}

export function wavByteLength(frames: number, channels: number): number {
  return HEADER_BYTES + BYTES_PER_SAMPLE * frames * channels;
}

interface WavResult {
  bytes: ArrayBuffer;
  clippedSamples: number;
}

function writeText(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** 16-bit PCM RIFF/WAVE, interleaved. onProgress(fraction) about every 1 %, and with 1 at the end. */
export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  onProgress?: (f: number) => void,
): WavResult {
  const channelCount = channels.length;
  const frames = channels[0].length;
  const dataBytes = BYTES_PER_SAMPLE * frames * channelCount;
  const blockAlign = BYTES_PER_SAMPLE * channelCount;

  const bytes = new ArrayBuffer(wavByteLength(frames, channelCount));
  const view = new DataView(bytes);

  writeText(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(view, 8, 'WAVE');
  writeText(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // 1 = plain PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // bytes per second
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeText(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // Report roughly every 1 % of the frames.
  const progressStep = Math.max(1, Math.floor(frames / 100));
  let clippedSamples = 0;
  let offset = HEADER_BYTES;

  for (let frame = 0; frame < frames; frame++) {
    if (frame % progressStep === 0) onProgress?.(frame / frames);
    for (const channel of channels) {
      const sample = channel[frame];
      if (Math.abs(sample) > 1) clippedSamples++;
      view.setInt16(offset, floatToInt16(sample), true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  onProgress?.(1);
  return { bytes, clippedSamples };
}
