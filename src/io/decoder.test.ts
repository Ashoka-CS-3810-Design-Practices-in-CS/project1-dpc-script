import { describe, expect, it, vi } from 'vitest';
import { MSG } from '@/app/messages';
import { encodeWav } from '@/algorithms/wav';
import { MAX_DURATION_S, MAX_FILE_BYTES, SAMPLE_RATE } from '@/model/constants';
import { checkFile, decodeFile, wavDurationFromHeader, type ImportMessages } from './decoder';

const msgs: ImportMessages = {
  unreadable: MSG.importUnreadable,
  tooLarge: MSG.importTooLarge,
  tooLong: MSG.importTooLong,
};

/** Just the AudioBuffer fields decodeFile reads, so a "40 minute" buffer costs no memory. */
const lightBuffer = (length: number): AudioBuffer =>
  ({ length, duration: length / SAMPLE_RATE, sampleRate: SAMPLE_RATE }) as AudioBuffer;

const ctxReturning = (buffer: AudioBuffer) => ({
  decodeAudioData: vi.fn().mockResolvedValue(buffer),
});
const ctxFailing = () => ({ decodeAudioData: vi.fn().mockRejectedValue(new Error('bad data')) });

describe('checkFile', () => {
  it('accepts .wav and .mp3 in any letter case', () => {
    expect(checkFile({ name: 'a.wav', size: 10 }, msgs).ok).toBe(true);
    expect(checkFile({ name: 'b.MP3', size: 10 }, msgs).ok).toBe(true);
  });

  it('rejects other file types', () => {
    expect(checkFile({ name: 'a.flac', size: 10 }, msgs)).toEqual({
      ok: false,
      error: MSG.importUnreadable('a.flac'),
    });
  });

  it('accepts exactly 200 MB and rejects one byte more', () => {
    expect(checkFile({ name: 'a.wav', size: MAX_FILE_BYTES }, msgs).ok).toBe(true);
    expect(checkFile({ name: 'a.wav', size: MAX_FILE_BYTES + 1 }, msgs)).toEqual({
      ok: false,
      error: MSG.importTooLarge('a.wav'),
    });
  });
});

describe('wavDurationFromHeader', () => {
  it('reads a mono file', () => {
    const { bytes } = encodeWav([new Float32Array(22050)], 44100);
    expect(wavDurationFromHeader(bytes)).toBeCloseTo(0.5);
  });

  it('reads a stereo file at another sample rate', () => {
    const { bytes } = encodeWav([new Float32Array(48000), new Float32Array(48000)], 48000);
    expect(wavDurationFromHeader(bytes)).toBeCloseTo(1);
  });

  it('skips chunks that come before the data (including an odd-sized one)', () => {
    const { bytes } = encodeWav([new Float32Array(44100)], 44100);
    const original = new Uint8Array(bytes);
    // Squeeze a 3-byte LIST chunk (plus its pad byte) in between "fmt " and "data".
    const extra = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0]);
    const joined = new Uint8Array(original.length + extra.length);
    joined.set(original.subarray(0, 36));
    joined.set(extra, 36);
    joined.set(original.subarray(36), 36 + extra.length);

    expect(wavDurationFromHeader(joined.buffer)).toBeCloseTo(1);
  });

  it('uses the audio really present when the file is cut short', () => {
    const { bytes } = encodeWav([new Float32Array(44100)], 44100);
    expect(wavDurationFromHeader(bytes.slice(0, 44 + 44100))).toBeCloseTo(0.5);
  });

  it('gives null when it is not a WAV or is damaged', () => {
    expect(wavDurationFromHeader(new ArrayBuffer(4))).toBeNull();
    expect(
      wavDurationFromHeader(new TextEncoder().encode('hello there, not audio').buffer),
    ).toBeNull();

    const { bytes } = encodeWav([new Float32Array(10)], 44100);
    expect(wavDurationFromHeader(bytes.slice(0, 36))).toBeNull(); // no data chunk
    expect(wavDurationFromHeader(bytes.slice(0, 30))).toBeNull(); // fmt chunk cut off
    new DataView(bytes).setUint32(28, 0, true); // byte rate of 0
    expect(wavDurationFromHeader(bytes)).toBeNull();
  });
});

describe('decodeFile', () => {
  const wavFile = (seconds: number) => {
    const { bytes } = encodeWav([new Float32Array(Math.round(seconds * 8000))], 8000);
    return new File([bytes], 'tone.wav');
  };

  it('returns the decoded buffer and the original bytes', async () => {
    const buffer = lightBuffer(SAMPLE_RATE);
    const ctx = ctxReturning(buffer);
    const file = wavFile(1);

    const result = await decodeFile(file, ctx, msgs);

    expect(result.ok && result.value.buffer).toBe(buffer);
    expect(result.ok && result.value.bytes.byteLength).toBe(file.size); // not detached
    expect(ctx.decodeAudioData.mock.calls[0][0]).not.toBe(result.ok && result.value.bytes); // a copy
  });

  it('rejects a bad type or size before reading the file', async () => {
    const ctx = ctxReturning(lightBuffer(1));
    const arrayBuffer = vi.fn();
    const huge = { name: 'huge.wav', size: 250 * 1024 * 1024, arrayBuffer } as unknown as File;
    const flac = { name: 'song.flac', size: 10, arrayBuffer } as unknown as File;

    expect(await decodeFile(huge, ctx, msgs)).toEqual({
      ok: false,
      error: MSG.importTooLarge('huge.wav'),
    });
    expect((await decodeFile(flac, ctx, msgs)).ok).toBe(false);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
  });

  it('reports a file that cannot be read from disk', async () => {
    const file = {
      name: 'a.wav',
      size: 10,
      arrayBuffer: () => Promise.reject(new Error('gone')),
    } as unknown as File;

    expect(await decodeFile(file, ctxReturning(lightBuffer(1)), msgs)).toEqual({
      ok: false,
      error: MSG.importUnreadable('a.wav'),
    });
  });

  it('rejects a WAV that is over 30 minutes without decoding it', async () => {
    const ctx = ctxReturning(lightBuffer(1));
    // 30:01 of silent 8 kHz mono: a real header followed by zeros.
    const dataBytes = 8000 * 2 * (MAX_DURATION_S + 1);
    const long = new Uint8Array(44 + dataBytes);
    long.set(new Uint8Array(encodeWav([new Float32Array(1)], 8000).bytes, 0, 44));
    new DataView(long.buffer).setUint32(40, dataBytes, true);

    const result = await decodeFile(new File([long], 'long.wav'), ctx, msgs);

    expect(result).toEqual({ ok: false, error: MSG.importTooLong('long.wav') });
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
  });

  it('rejects data the browser cannot decode', async () => {
    const result = await decodeFile(new File(['just some text'], 'notes.wav'), ctxFailing(), msgs);
    expect(result).toEqual({ ok: false, error: MSG.importUnreadable('notes.wav') });
  });

  it('rejects an empty file and a buffer with no samples', async () => {
    expect((await decodeFile(new File([], 'empty.mp3'), ctxFailing(), msgs)).ok).toBe(false);

    const result = await decodeFile(
      new File(['x'], 'quiet.mp3'),
      ctxReturning(lightBuffer(0)),
      msgs,
    );
    expect(result).toEqual({ ok: false, error: MSG.importUnreadable('quiet.mp3') });
  });

  it('accepts exactly 30:00 and rejects one sample more', async () => {
    const file = new File(['x'], 'long.mp3');
    const limit = MAX_DURATION_S * SAMPLE_RATE;

    expect((await decodeFile(file, ctxReturning(lightBuffer(limit)), msgs)).ok).toBe(true);
    expect(await decodeFile(file, ctxReturning(lightBuffer(limit + 1)), msgs)).toEqual({
      ok: false,
      error: MSG.importTooLong('long.mp3'),
    });
  });

  it('does not check the WAV header of an MP3', async () => {
    // These bytes happen to be a WAV header claiming 40 minutes; an .mp3 name skips that check.
    const { bytes } = encodeWav([new Float32Array(10)], 8000);
    new DataView(bytes).setUint32(40, 8000 * 2 * 2400, true);

    const result = await decodeFile(
      new File([bytes], 'odd.mp3'),
      ctxReturning(lightBuffer(1)),
      msgs,
    );
    expect(result.ok).toBe(true);
  });
});
