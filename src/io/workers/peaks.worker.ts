import { buildPeaks } from '@/algorithms/peaks';
import type { PeakPyramid } from '@/algorithms/types';

/** A2: builds the peak pyramid off the main thread. The bridge passes the block size in the
 *  message, since workers may only import algorithms (README §5.2). */

export interface PeaksRequest {
  id: number;
  channels: Float32Array[]; // transferred
  sampleRate: number;
  blockSize: number; // PEAK_BLOCK_SIZE
}

export type PeaksResponse = { id: number; pyramid: PeakPyramid } | { id: number; error: string };

self.addEventListener('message', (event: MessageEvent<PeaksRequest>) => {
  const { id, channels, sampleRate, blockSize } = event.data;
  try {
    const pyramid = buildPeaks(channels, sampleRate, blockSize);
    const response: PeaksResponse = { id, pyramid };
    self.postMessage(response, { transfer: pyramid.levels.map((l) => l.buffer as ArrayBuffer) });
  } catch (e) {
    const response: PeaksResponse = { id, error: String(e) };
    self.postMessage(response);
  }
});
