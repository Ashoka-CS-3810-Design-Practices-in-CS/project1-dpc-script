import type { Page } from '@playwright/test';
import { expect, skipWithoutWebAudio, test } from './fixtures/helpers.ts';

// Renders projects of exact test signals with the real mix builder, in the browser's own
// OfflineAudioContext, and checks the output sample by sample (A3 §2.1). The code that runs in
// the page is e2e/fixtures/audio-harness.mjs.

const RATE = 44100;
const TOLERANCE = 1e-4;

interface SourceSpec {
  id: string;
  kind: 'constant' | 'tone' | 'click';
  seconds: number;
  value?: number; // constant: the sample value; tone: the frequency in Hz
  amplitude?: number;
}
interface ClipSpec {
  sourceId: string;
  startTime: number;
  duration: number;
  sourceOffset?: number;
  fadeIn?: number;
  fadeOut?: number;
}
interface RenderSpec {
  seconds: number;
  sources: SourceSpec[];
  tracks: Array<{ volume: number; muted?: boolean; clips: ClipSpec[] }>;
}

interface Rendered {
  rate: number;
  samples: number[];
}
interface RoundTrip {
  rendered: number[];
  decoded: number[];
  decodedRate: number;
  byteLength: number;
  clippedSamples: number;
  projectEnd: number;
}

// The module is loaded by URL in the page, so TypeScript never sees it; the script is a string.
const call = <T>(
  page: Page,
  fn: 'renderProject' | 'exportRoundTrip',
  spec: RenderSpec,
): Promise<T> =>
  page.evaluate<T>(
    `import('/e2e/fixtures/audio-harness.mjs').then((m) => m.${fn}(${JSON.stringify(spec)}))`,
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await skipWithoutWebAudio(page);
});

test('a constant signal through fades is 0.5 · vol(t) · gain', async ({ page }) => {
  // A 3 s clip at 0.5 s, 1 s fade in and 1 s fade out, on a track at gain 0.8.
  const start = 0.5;
  const d = 3;
  const [a, b, gain] = [1, 1, 0.8];
  const { rate, samples } = await call<Rendered>(page, 'renderProject', {
    seconds: 4.5,
    sources: [{ id: 'dc', kind: 'constant', value: 0.5, seconds: 3 }],
    tracks: [
      {
        volume: gain,
        clips: [{ sourceId: 'dc', startTime: start, duration: d, fadeIn: a, fadeOut: b }],
      },
    ],
  });
  expect(rate).toBe(RATE);

  const vol = (t: number) => {
    if (t < 0 || t > d) return 0;
    return Math.min(1, a > 0 ? t / a : 1, b > 0 ? (d - t) / b : 1);
  };
  let worst = 0;
  // Every 100th sample, plus the points where the shape changes.
  const indexes = [...Array.from({ length: Math.floor(samples.length / 100) }, (_, i) => i * 100)];
  for (const t of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.49, 3.5, 4]) indexes.push(Math.round(t * RATE));
  for (const i of indexes) {
    if (i >= samples.length) continue;
    const t = i / RATE - start;
    const expected = 0.5 * vol(t) * gain;
    worst = Math.max(worst, Math.abs(samples[i] - expected));
    expect(samples[i], `sample ${i} (t = ${(i / RATE).toFixed(4)} s)`).toBeCloseTo(expected, 4);
  }
  expect(worst).toBeLessThan(TOLERANCE);
  // Silent before the clip, and full level (0.5 · 0.8) in the middle of it.
  expect(Math.max(...samples.slice(0, Math.round(start * RATE) - 1).map(Math.abs))).toBeLessThan(
    1e-6,
  );
  expect(samples[Math.round(2 * RATE)]).toBeCloseTo(0.4, 4);
});

test('a single click at the clip start lands on the exact sample', async ({ page }) => {
  const { samples } = await call<Rendered>(page, 'renderProject', {
    seconds: 2,
    sources: [{ id: 'click', kind: 'click', seconds: 0.1 }],
    tracks: [{ volume: 1, clips: [{ sourceId: 'click', startTime: 1.0, duration: 0.1 }] }],
  });
  const at = Math.round(1.0 * RATE);
  const loud = samples.map((v, i) => [i, v] as const).filter(([, v]) => Math.abs(v) > 1e-6);
  expect(loud.map(([i]) => i)).toEqual([at]);
  expect(samples[at]).toBeCloseTo(1, 4);
});

test('two tones on two tracks at gain 0.5 add up', async ({ page }) => {
  const amplitude = 0.4;
  const { samples } = await call<Rendered>(page, 'renderProject', {
    seconds: 1,
    sources: [
      { id: 'a', kind: 'tone', value: 440, amplitude, seconds: 1 },
      { id: 'b', kind: 'tone', value: 660, amplitude, seconds: 1 },
    ],
    tracks: [
      { volume: 0.5, clips: [{ sourceId: 'a', startTime: 0, duration: 1 }] },
      { volume: 0.5, clips: [{ sourceId: 'b', startTime: 0, duration: 1 }] },
    ],
  });
  const tone = (freq: number, i: number) =>
    Math.fround(amplitude * Math.sin((2 * Math.PI * freq * i) / RATE));
  expect(samples).toHaveLength(RATE);
  let worst = 0;
  for (let i = 0; i < samples.length; i++) {
    worst = Math.max(worst, Math.abs(samples[i] - (0.5 * tone(440, i) + 0.5 * tone(660, i))));
  }
  expect(worst).toBeLessThan(TOLERANCE);
});

test('a muted track adds nothing to the mix', async ({ page }) => {
  const { samples } = await call<Rendered>(page, 'renderProject', {
    seconds: 1,
    sources: [{ id: 'dc', kind: 'constant', value: 0.5, seconds: 1 }],
    tracks: [
      { volume: 1, clips: [{ sourceId: 'dc', startTime: 0, duration: 1 }] },
      { volume: 1, muted: true, clips: [{ sourceId: 'dc', startTime: 0, duration: 1 }] },
    ],
  });
  expect(samples[RATE / 2]).toBeCloseTo(0.5, 4); // one track's worth, not two
});

test('the exported WAV decodes to the rendered preview, within 16-bit rounding', async ({
  page,
}) => {
  // Three clips over two tracks: tones with fades, two clips apart and one overlapping in time.
  const r = await call<RoundTrip>(page, 'exportRoundTrip', {
    seconds: 3,
    sources: [
      { id: 'low', kind: 'tone', value: 220, amplitude: 0.6, seconds: 2 },
      { id: 'high', kind: 'tone', value: 1320, amplitude: 0.3, seconds: 2 },
    ],
    tracks: [
      {
        volume: 0.7,
        clips: [
          { sourceId: 'low', startTime: 0, duration: 1.2, fadeIn: 0.3, fadeOut: 0.4 },
          { sourceId: 'low', startTime: 1.5, sourceOffset: 0.5, duration: 1.5, fadeOut: 1 },
        ],
      },
      { volume: 0.5, clips: [{ sourceId: 'high', startTime: 0.5, duration: 2, fadeIn: 0.5 }] },
    ],
  });

  expect(r.decodedRate).toBe(RATE);
  expect(r.rendered).toHaveLength(3 * RATE);
  expect(r.decoded).toHaveLength(r.rendered.length);
  expect(r.byteLength).toBe(44 + 2 * r.rendered.length);
  expect(r.clippedSamples).toBe(0);
  expect(r.projectEnd).toBe(3);

  let worst = 0;
  let loudest = 0;
  for (let i = 0; i < r.rendered.length; i++) {
    worst = Math.max(worst, Math.abs(r.decoded[i] - r.rendered[i]));
    loudest = Math.max(loudest, Math.abs(r.rendered[i]));
  }
  expect(loudest).toBeGreaterThan(0.2); // the comparison is not between two silences
  // Rounding to 16 bits costs at most half a step (0.5 / 32767). Our encoder scales positive
  // samples by 32767, but browsers differ in what they divide by when decoding: some by 32767,
  // WebKit by 32768, which adds up to x / 32768 more. So the bound that holds for every decoder
  // is 1.5 / 32768 (about 4.6e-5, still far below anything audible).
  expect(worst).toBeLessThanOrEqual(1.5 / 32768);
});
