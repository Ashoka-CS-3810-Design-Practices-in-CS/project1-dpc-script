/** Structural types for the pure algorithm layer. The model's Clip/Track satisfy them. */
export interface ClipLike {
  startTime: number; // seconds on the timeline
  sourceOffset: number; // seconds into the audio file
  duration: number; // seconds; end = startTime + duration
  fadeIn: number; // seconds, 0 = none
  fadeOut: number; // seconds, 0 = none
}

export interface TrackMixLike {
  volume: number; // 0..1
  muted: boolean;
  soloed: boolean;
}

/** DS4. Level k block size = blockSize * 2^k. Each level is [min0, max0, min1, max1, …]. */
export interface PeakPyramid {
  sampleRate: number;
  blockSize: number; // samples per block at level 0 (PEAK_BLOCK_SIZE)
  length: number; // number of samples summarised (per channel)
  levels: Float32Array[];
}

/** Edit outcome codes; the app layer maps them to messages. */
export type EditErrorCode =
  'too-short' | 'outside-clip' | 'fade-invalid' | 'fade-too-long' | 'out-of-range';
export interface EditError {
  error: EditErrorCode;
}
