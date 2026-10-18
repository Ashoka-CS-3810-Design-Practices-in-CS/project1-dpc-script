import { useEffect, useRef, useState, type JSX } from 'react';
import type { ExportProgress, ExportSettings } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { EXPORT_SAMPLE_RATES } from '@/model/constants';
import { notify } from '@/ui/feedback';
import { formatDuration, formatMB } from '@/ui/format';
import { useProject, useServices } from '@/ui/servicesContext';

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

/** FR9: choose a file name, sample rate and channels, then export to a WAV download. */
export function ExportDialog({ open, onClose }: ExportDialogProps): JSX.Element | null {
  // The form only exists while open, so every opening starts fresh with the project name.
  return open ? <ExportForm onClose={onClose} /> : null;
}

function ExportForm({ onClose }: { onClose: () => void }): JSX.Element {
  const { exporter } = useServices();
  const project = useProject();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [fileName, setFileName] = useState(project.name);
  const [sampleRate, setSampleRate] = useState<ExportSettings['sampleRate']>(
    EXPORT_SAMPLE_RATES[0],
  );
  const [channels, setChannels] = useState<ExportSettings['channels']>(2);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const exporting = progress !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const settings: ExportSettings = { fileName, sampleRate, channels };

  function cancel(): void {
    if (abortRef.current) abortRef.current.abort();
    else onClose();
  }

  async function run(): Promise<void> {
    const checked = exporter.check(settings);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    setProgress({ phase: 'render', fraction: NaN });
    const abort = new AbortController();
    abortRef.current = abort;

    const result = await exporter.export(settings, setProgress, abort.signal);

    abortRef.current = null;
    setProgress(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    result.warnings?.forEach(notify.warning);
    const { fileName: file, duration, bytes } = result.value;
    notify.success(MSG.exported(file, formatDuration(duration), formatMB(bytes)));
    onClose();
  }

  const percent =
    progress && !Number.isNaN(progress.fraction) ? Math.round(progress.fraction * 100) : null;

  return (
    <dialog
      ref={dialogRef}
      className="export-dialog"
      aria-labelledby="export-title"
      onCancel={(e) => {
        // Esc: stop the export if one is running, otherwise close.
        e.preventDefault();
        cancel();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!exporting) void run();
        }}
      >
        <h2 id="export-title">Export WAV</h2>

        <label className="field">
          File name
          <input
            type="text"
            value={fileName}
            disabled={exporting}
            aria-invalid={error === MSG.exportBadName}
            onChange={(e) => setFileName(e.target.value)}
          />
        </label>

        <label className="field">
          Sample rate
          <select
            value={sampleRate}
            disabled={exporting}
            onChange={(e) => setSampleRate(Number(e.target.value) as ExportSettings['sampleRate'])}
          >
            {EXPORT_SAMPLE_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate / 1000} kHz
              </option>
            ))}
          </select>
        </label>

        <fieldset className="field" disabled={exporting}>
          <legend>Channels</legend>
          <label>
            <input
              type="radio"
              name="channels"
              checked={channels === 1}
              onChange={() => setChannels(1)}
            />
            Mono
          </label>
          <label>
            <input
              type="radio"
              name="channels"
              checked={channels === 2}
              onChange={() => setChannels(2)}
            />
            Stereo
          </label>
        </fieldset>

        <p className="muted">
          Needs about {formatMB(exporter.estimateBytes(settings))} MB of memory.
        </p>

        {exporting && (
          <p>
            {/* No value = indeterminate: rendering has no measurable progress. */}
            <progress aria-label="Export progress" max={100} value={percent ?? undefined} />{' '}
            {percent === null ? 'Rendering…' : `Encoding ${percent}%`}
          </p>
        )}

        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-buttons">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={exporting}>
            Export
          </button>
        </div>
      </form>
    </dialog>
  );
}
