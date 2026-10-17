import type { EncodeMessage, EncodeRequest } from '@/io/workers/encode.worker';

export interface EncodeResult {
  bytes: ArrayBuffer;
  clippedSamples: number;
}

/** Encodes in a worker so the page stays responsive. Aborting kills the worker and rejects with
 *  an AbortError. A RangeError in the worker (out of memory) comes back as a RangeError. */
export function encodeInWorker(
  channels: Float32Array[],
  sampleRate: number,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<EncodeResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const worker = new Worker(new URL('./workers/encode.worker.ts', import.meta.url), {
      type: 'module',
    });
    const onAbort = () => {
      worker.terminate();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    worker.onmessage = (e: MessageEvent<EncodeMessage>) => {
      const message = e.data;
      if (message.type === 'progress') {
        onProgress(message.fraction);
        return;
      }
      finish();
      if (message.type === 'done') {
        resolve({ bytes: message.bytes, clippedSamples: message.clippedSamples });
      } else {
        reject(
          message.name === 'RangeError'
            ? new RangeError(message.message)
            : new Error(message.message),
        );
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'The encoder stopped unexpectedly'));
    };

    const request: EncodeRequest = { channels, sampleRate };
    worker.postMessage(
      request,
      channels.map((c) => c.buffer),
    );
  });
}
