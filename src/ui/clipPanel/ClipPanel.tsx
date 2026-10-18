import { useState, type JSX } from 'react';
import { MSG } from '@/app/messages';
import type { Result } from '@/model/result';
import type { Seconds } from '@/model/types';
import { notify } from '@/ui/feedback';
import { useProject, useServices, useView, useViewStore } from '@/ui/servicesContext';
import { report, splitAtPlayhead } from '@/ui/shortcuts';
import './clipPanel.css';

/** Values are shown and typed in seconds with 3 decimals. */
const show = (s: Seconds) => s.toFixed(3);

/** A3 §4.2: exact values and edit buttons for the selected clip; hidden when none is
 *  selected. Every detail is plain text so screen readers read it. */
export function ClipPanel(): JSX.Element | null {
  const services = useServices();
  const { edit, queries } = services;
  const viewStore = useViewStore();
  const { selectedClipId, selection } = useView();
  const project = useProject();

  const loc = selectedClipId === null ? null : queries.findClip(selectedClipId);
  if (!loc) return null;
  const { clip, track } = loc;
  const end = clip.startTime + clip.duration;
  const fileName = project.sources.get(clip.sourceId)?.fileName ?? '';
  const region = selection?.clipId === clip.id ? selection : null;

  // Typed selection bounds are clamped to the clip; the other bound defaults to the clip edge.
  function setRegion(start: Seconds, stop: Seconds): void {
    const a = Math.min(Math.max(start, clip.startTime), end);
    const b = Math.min(Math.max(stop, clip.startTime), end);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    viewStore.set({ selection: hi > lo ? { clipId: clip.id, start: lo, end: hi } : null });
  }

  return (
    <section className="clip-panel" aria-label="Clip details">
      <p className="clip-panel-name">
        <span className="muted">Clip</span> {fileName}
      </p>
      <div className="clip-panel-fields">
        <NumberField
          key={`start-${clip.id}-${clip.startTime}`}
          label="Start"
          value={clip.startTime}
          onCommit={(v) => edit.moveClip(clip.id, track.id, v)}
        />
        <NumberField
          key={`length-${clip.id}-${clip.duration}`}
          label="Length"
          value={clip.duration}
          onCommit={(v) => edit.trimEdge(clip.id, 'end', clip.startTime + v)}
        />
        <label className="clip-field">
          Track
          <select
            value={track.id}
            onChange={(e) => report(edit.moveClip(clip.id, e.target.value, clip.startTime))}
          >
            {project.tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          key={`in-${clip.id}-${clip.fadeIn}`}
          label="Fade-in"
          value={clip.fadeIn}
          onCommit={(v) => edit.setFades(clip.id, v, clip.fadeOut)}
        />
        <NumberField
          key={`out-${clip.id}-${clip.fadeOut}`}
          label="Fade-out"
          value={clip.fadeOut}
          onCommit={(v) => edit.setFades(clip.id, clip.fadeIn, v)}
        />
        <NumberField
          key={`sel-start-${clip.id}-${region?.start}`}
          label="Selection start"
          value={region?.start ?? null}
          onCommit={(v) => setRegion(v, region?.end ?? end)}
        />
        <NumberField
          key={`sel-end-${clip.id}-${region?.end}`}
          label="Selection end"
          value={region?.end ?? null}
          onCommit={(v) => setRegion(region?.start ?? clip.startTime, v)}
        />
        <p className="clip-field">
          Selection length
          <span>{region ? `${show(region.end - region.start)} s` : 'none'}</span>
        </p>
      </div>
      <div className="clip-panel-buttons">
        <button
          type="button"
          disabled={!region}
          onClick={() => region && report(edit.trimToSelection(clip.id, region.start, region.end))}
        >
          Trim
        </button>
        <button type="button" onClick={() => splitAtPlayhead(services, viewStore)}>
          Split
        </button>
        <button
          type="button"
          disabled={!region}
          onClick={() => region && report(edit.deleteRegion(clip.id, region.start, region.end))}
        >
          Delete selection
        </button>
        <button
          type="button"
          onClick={() => {
            edit.removeClip(clip.id);
            viewStore.set({ selectedClipId: null, selection: null });
          }}
        >
          Remove clip
        </button>
      </div>
    </section>
  );
}

interface NumberFieldProps {
  label: string;
  value: Seconds | null; // null = empty
  /** Called with a number ≥ 0; a failed Result is shown and the field resets. */
  onCommit: (value: Seconds) => Result<unknown> | void;
}

/** A seconds field that commits on Enter or blur. Anything but a number ≥ 0 shows
 *  MSG.numberInvalid and puts the old value back. The parent keys it by its value, so a new
 *  value starts a fresh field. */
function NumberField({ label, value, onCommit }: NumberFieldProps): JSX.Element {
  const initial = value === null ? '' : show(value);
  const [draft, setDraft] = useState(initial);

  function commit(): void {
    if (draft.trim() === initial) return; // unchanged
    const n = Number(draft.trim());
    if (draft.trim() === '' || !Number.isFinite(n) || n < 0) {
      notify.error(MSG.numberInvalid);
      setDraft(initial);
      return;
    }
    const r = onCommit(n);
    if (r && !r.ok) {
      notify.error(r.error);
      setDraft(initial);
    } else if (r) {
      r.warnings?.forEach(notify.warning);
    }
  }

  return (
    <label className="clip-field">
      {label}
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        onBlur={commit}
      />
    </label>
  );
}
