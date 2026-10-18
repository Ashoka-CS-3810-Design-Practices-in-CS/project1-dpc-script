import { resolveGains } from '@/algorithms/mix';
import type { ExportedFile, ExportService, ExportSettings, ProjectStore } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { projectEnd } from '@/model/projectOps';
import { fail, ok, type Result } from '@/model/result';
import type { Project } from '@/model/types';

export interface ExportDeps {
  store: ProjectStore;
  render(project: Project, sampleRate: number, channels: number): Promise<AudioBuffer>;
  encode(
    channels: Float32Array[],
    sampleRate: number,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<{ bytes: ArrayBuffer; clippedSamples: number }>;
  download(blob: Blob, fileName: string): void;
}

// Characters a file name may not contain.
const BAD_NAME = /[/\\:*?"<>|]/;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const isOutOfMemory = (e: unknown) => e instanceof RangeError || /memory/i.test(String(e));

/** A9: checks the settings, renders, encodes, and hands the file to the browser. */
export function createExportService({
  store,
  render,
  encode,
  download,
}: ExportDeps): ExportService {
  function check(settings: ExportSettings): Result {
    const name = settings.fileName.trim();
    if (name === '' || BAD_NAME.test(name)) return fail(MSG.exportBadName);

    const project = store.get();
    const gains = resolveGains(project.tracks);
    // Tracks with something to hear: a clip whose audio is loaded.
    const withAudio = project.tracks
      .map((track, i) => ({ gain: gains[i], clips: track.clips }))
      .filter(({ clips }) =>
        clips.some((c) => project.sources.get(c.sourceId)?.status === 'ready'),
      );
    if (withAudio.length === 0) return fail(MSG.nothingToExport);
    if (withAudio.every(({ gain }) => gain === 0)) return fail(MSG.everythingMuted);
    return ok(undefined);
  }

  return {
    check,

    // 4 bytes per rendered sample plus 2 per encoded one.
    estimateBytes: (s) => 6 * Math.ceil(projectEnd(store.get()) * s.sampleRate) * s.channels,

    async export(settings, onProgress, signal): Promise<Result<ExportedFile>> {
      const checked = check(settings);
      if (!checked.ok) return checked;

      try {
        onProgress({ phase: 'render', fraction: NaN });
        const buffer = await render(store.get(), settings.sampleRate, settings.channels);
        if (signal.aborted) return fail(MSG.exportCancelled);

        // Copies, because the encoder takes ownership of what it is given.
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
          buffer.getChannelData(i).slice(),
        );
        const { bytes, clippedSamples } = await encode(
          channels,
          settings.sampleRate,
          (fraction) => onProgress({ phase: 'encode', fraction }),
          signal,
        );
        if (signal.aborted) return fail(MSG.exportCancelled);

        const name = settings.fileName.trim();
        const fileName = name.toLowerCase().endsWith('.wav') ? name : `${name}.wav`;
        download(new Blob([bytes], { type: 'audio/wav' }), fileName);
        return ok(
          { fileName, duration: buffer.duration, bytes: bytes.byteLength },
          clippedSamples > 0 ? [MSG.exportClipped] : undefined,
        );
      } catch (e) {
        if (isAbort(e) || signal.aborted) return fail(MSG.exportCancelled);
        if (isOutOfMemory(e)) return fail(MSG.exportNoMemory);
        return fail(MSG.exportFailed(e instanceof Error ? e.message : String(e)));
      }
    },
  };
}
