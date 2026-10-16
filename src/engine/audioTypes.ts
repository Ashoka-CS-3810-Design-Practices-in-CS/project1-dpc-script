/** The small slice of Web Audio the engine uses, so tests can pass a fake (A3 §2.1). */
export interface ParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  cancelScheduledValues(t: number): unknown;
}

export interface NodeLike {
  connect(dest: NodeLike): unknown;
  disconnect(): void;
}

export interface GainLike extends NodeLike {
  gain: ParamLike;
}

export interface BufferSourceLike extends NodeLike {
  buffer: AudioBuffer | null;
  start(when: number, offset: number, duration: number): void;
  stop(): void;
  onended: (() => void) | null;
}

export interface AudioContextLike {
  currentTime: number;
  destination: NodeLike;
  createGain(): GainLike;
  createBufferSource(): BufferSourceLike;
}
