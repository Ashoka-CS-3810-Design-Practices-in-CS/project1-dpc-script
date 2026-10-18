// Runs inside the page (the Vite dev server serves it and the /src modules it imports). It builds
// a project from plain data, renders it with the real mix builder and returns the samples, so
// audio-output.spec.ts can compare them with numbers worked out by hand.
import { encodeWav } from '/src/algorithms/wav.ts';
import { createDefaultEffects } from '/src/engine/effects.ts';
import { buildMix } from '/src/engine/graphBuilder.ts';
import { SAMPLE_RATE } from '/src/model/constants.ts';
import { createEmptyProject, projectEnd } from '/src/model/projectOps.ts';
import { createSourceRegistry } from '/src/model/sourceRegistry.ts';

/** One channel of test audio. Float32 like the browser's own buffers. */
function makeSamples(source) {
  const length = Math.round(source.seconds * SAMPLE_RATE);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (source.kind === 'constant') data[i] = source.value;
    else if (source.kind === 'tone') {
      data[i] = source.amplitude * Math.sin((2 * Math.PI * source.value * i) / SAMPLE_RATE);
    } else if (source.kind === 'click') data[i] = i === 0 ? 1 : 0;
  }
  return data;
}

/** spec = { seconds, sources: [{ id, kind, seconds, value, amplitude }],
 *           tracks: [{ volume, clips: [{ sourceId, startTime, duration, sourceOffset, fadeIn, fadeOut }] }] } */
function buildProject(spec, ctx) {
  const sources = createSourceRegistry();
  for (const s of spec.sources) {
    const samples = makeSamples(s);
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    sources.add({
      id: s.id,
      fileName: `${s.id}.wav`,
      status: 'ready',
      buffer,
      peaks: null,
      refCount: spec.tracks.flatMap((t) => t.clips).filter((c) => c.sourceId === s.id).length,
    });
  }
  const project = createEmptyProject('audio test', sources);
  spec.tracks.forEach((t, i) => {
    project.tracks.push({
      id: `t${i}`,
      name: `Track ${i + 1}`,
      volume: t.volume,
      muted: t.muted ?? false,
      soloed: false,
      clips: t.clips.map((c, j) => ({
        id: `t${i}c${j}`,
        sourceOffset: 0,
        fadeIn: 0,
        fadeOut: 0,
        ...c,
      })),
    });
  });
  return project;
}

/** Renders the project through buildMix exactly as the export does (from 0, tc = 0). */
async function render(spec) {
  const length = Math.ceil(spec.seconds * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const project = buildProject(spec, ctx);
  buildMix(ctx, project, 0, 0, createDefaultEffects());
  return { buffer: await ctx.startRendering(), project };
}

/** The first channel of a render, as a plain array (Playwright can only send plain data). */
export async function renderProject(spec) {
  const { buffer } = await render(spec);
  return { rate: buffer.sampleRate, samples: Array.from(buffer.getChannelData(0)) };
}

/** Render, encode as 16-bit WAV, decode the WAV bytes again with the browser's decoder. */
export async function exportRoundTrip(spec) {
  const { buffer, project } = await render(spec);
  const rendered = buffer.getChannelData(0);
  const { bytes, clippedSamples } = encodeWav([rendered], buffer.sampleRate);
  const decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes.slice(0));
  return {
    rendered: Array.from(rendered),
    decoded: Array.from(decoded.getChannelData(0)),
    decodedRate: decoded.sampleRate,
    byteLength: bytes.byteLength,
    clippedSamples,
    projectEnd: projectEnd(project),
  };
}
