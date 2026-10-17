import { encodeWav } from '@/algorithms/wav';

/** What the page sends: one Float32Array per channel (transferred, not copied). */
export interface EncodeRequest {
  channels: Float32Array[];
  sampleRate: number;
}

/** What the worker sends back. */
export type EncodeMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; bytes: ArrayBuffer; clippedSamples: number }
  | { type: 'error'; name: string; message: string };

// The worker scope, typed by hand: this project compiles with the DOM library, not the worker one.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<EncodeRequest>) => void) | null;
  postMessage(message: EncodeMessage, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  try {
    const { channels, sampleRate } = e.data;
    const { bytes, clippedSamples } = encodeWav(channels, sampleRate, (fraction) =>
      scope.postMessage({ type: 'progress', fraction }),
    );
    scope.postMessage({ type: 'done', bytes, clippedSamples }, [bytes]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    scope.postMessage({ type: 'error', name: err.name, message: err.message });
  }
};
