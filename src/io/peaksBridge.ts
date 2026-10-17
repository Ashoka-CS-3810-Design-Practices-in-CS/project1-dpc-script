import type { PeakPyramid } from '@/algorithms/types';
import type { PeaksRequest, PeaksResponse } from '@/io/workers/peaks.worker';
import { PEAK_BLOCK_SIZE } from '@/model/constants';

interface Pending {
  resolve: (pyramid: PeakPyramid) => void;
  reject: (reason: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** One module worker, created on first use. A crashed worker fails every open request and is
 *  replaced on the next call. */
function peaksWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./workers/peaks.worker.ts', import.meta.url), { type: 'module' });
  w.addEventListener('message', (event: MessageEvent<PeaksResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if ('pyramid' in response) request.resolve(response.pyramid);
    else request.reject(new Error(response.error));
  });
  w.addEventListener('error', () => {
    for (const request of pending.values()) request.reject(new Error('Peaks worker failed.'));
    pending.clear();
    w.terminate();
    worker = null;
  });
  worker = w;
  return w;
}

/** A2: builds the peak pyramid in a worker. Each channel is copied before it is transferred,
 *  so the caller's AudioBuffer stays intact. */
export function computePeaks(channels: Float32Array[], sampleRate: number): Promise<PeakPyramid> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const copies = channels.map((c) => c.slice());
    const request: PeaksRequest = { id, channels: copies, sampleRate, blockSize: PEAK_BLOCK_SIZE };
    pending.set(id, { resolve, reject });
    try {
      peaksWorker().postMessage(
        request,
        copies.map((c) => c.buffer as ArrayBuffer),
      );
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
