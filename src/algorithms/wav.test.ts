import { describe, expect, it } from 'vitest';
import { encodeWav, floatToInt16, wavByteLength } from './wav';

describe('floatToInt16', () => {
  it('maps the extremes and zero', () => {
    expect(floatToInt16(-1)).toBe(-32768);
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(0)).toBe(0);
  });

  it('limits values outside -1..1', () => {
    expect(floatToInt16(1.5)).toBe(32767);
    expect(floatToInt16(-1.5)).toBe(-32768);
  });

  it('rounds in between', () => {
    expect(floatToInt16(0.5)).toBe(16384); // 16383.5 rounds up
    expect(floatToInt16(-0.5)).toBe(-16384);
  });
});

describe('wavByteLength', () => {
  it('is a 44-byte header plus 2 bytes per sample', () => {
    expect(wavByteLength(0, 1)).toBe(44);
    expect(wavByteLength(100, 2)).toBe(444);
  });
});

describe('encodeWav', () => {
  const text = (view: DataView, offset: number) =>
    String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));

  it('writes a correct header', () => {
    const { bytes } = encodeWav([new Float32Array(10), new Float32Array(10)], 44100);
    const view = new DataView(bytes);

    expect(text(view, 0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 40); // everything after the first 8 bytes
    expect(text(view, 8)).toBe('WAVE');
    expect(text(view, 12)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4); // byte rate
    expect(view.getUint16(32, true)).toBe(4); // block align
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(view, 36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(40);
  });

  it('has the expected byte length', () => {
    const { bytes } = encodeWav([new Float32Array(7)], 48000);
    expect(bytes.byteLength).toBe(44 + 2 * 7 * 1);
  });

  it('interleaves stereo samples left, right, left, right', () => {
    const left = Float32Array.of(1, -1);
    const right = Float32Array.of(0, 0.5);
    const view = new DataView(encodeWav([left, right], 44100).bytes);

    expect([44, 46, 48, 50].map((o) => view.getInt16(o, true))).toEqual([32767, 0, -32768, 16384]);
  });

  it('counts clipped samples and still writes them at full scale', () => {
    const { bytes, clippedSamples } = encodeWav([Float32Array.of(0.5, 2, -3, 1, -1)], 44100);
    const view = new DataView(bytes);

    expect(clippedSamples).toBe(2); // exactly 1 / -1 is not clipping
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });

  it('reports progress and ends on 1', () => {
    const calls: number[] = [];
    encodeWav([new Float32Array(1000)], 44100, (f) => calls.push(f));

    expect(calls.length).toBeGreaterThan(50);
    expect(calls.length).toBeLessThan(150);
    expect(calls[0]).toBe(0);
    expect(calls[calls.length - 1]).toBe(1);
    expect(calls).toEqual([...calls].sort((x, y) => x - y));
  });

  it('copes with empty audio', () => {
    const calls: number[] = [];
    const { bytes } = encodeWav([new Float32Array(0)], 44100, (f) => calls.push(f));

    expect(bytes.byteLength).toBe(44);
    expect(calls).toEqual([1]);
  });
});
