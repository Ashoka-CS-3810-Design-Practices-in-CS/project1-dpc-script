import { useEffect } from 'react';
import type { Services } from '@/app/contracts';
import { MSG } from '@/app/messages';
import { NUDGE_S, NUDGE_SHIFT_S, ZOOM_STEP } from '@/model/constants';
import type { Result } from '@/model/result';
import { notify } from '@/ui/feedback';
import { useServices, useViewStore } from '@/ui/servicesContext';
import type { ViewStore } from '@/ui/viewStore';

/** A3 §4.2: every keyboard shortcut, all defined in this file. */

export type ShortcutAction =
  | { type: 'togglePlay' }
  | { type: 'stop' }
  | { type: 'split' }
  | { type: 'deleteSelection' }
  | { type: 'trim' }
  | { type: 'mute' }
  | { type: 'solo' }
  | { type: 'nudge'; by: number }
  | { type: 'save' }
  | { type: 'zoom'; factor: number };

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface KeyContext {
  /** Focus is in a text field, select, textarea or the ruler slider: shortcuts are off. */
  inField: boolean;
}

/** The action for a key press, or null if the key is not a shortcut here. */
export function keyToAction(e: KeyLike, context: KeyContext): ShortcutAction | null {
  if (context.inField) return null;
  const command = e.ctrlKey || e.metaKey;
  if (command) {
    return !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's' ? { type: 'save' } : null;
  }
  if (e.altKey) return null; // leave Alt combinations to the browser
  switch (e.key) {
    case ' ':
      return { type: 'togglePlay' };
    case 'Home':
      return { type: 'stop' };
    case 'Delete':
      return { type: 'deleteSelection' };
    case 'ArrowLeft':
      return { type: 'nudge', by: -(e.shiftKey ? NUDGE_SHIFT_S : NUDGE_S) };
    case 'ArrowRight':
      return { type: 'nudge', by: e.shiftKey ? NUDGE_SHIFT_S : NUDGE_S };
    case '+':
    case '=':
      return { type: 'zoom', factor: ZOOM_STEP };
    case '-':
      return { type: 'zoom', factor: 1 / ZOOM_STEP };
  }
  switch (e.key.toLowerCase()) {
    case 's':
      return { type: 'split' };
    case 't':
      return { type: 'trim' };
    case 'm':
      return { type: 'mute' };
    case 'o':
      return { type: 'solo' };
  }
  return null;
}

/** True for elements where keys type text or move a control, so shortcuts must not fire. */
export function isFieldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, select, textarea, [contenteditable="true"]')) return true;
  return target.getAttribute('role') === 'slider';
}

/** The UI's Result convention (README §8.6): errors and warnings become toasts. */
export function report(r: Result<unknown>): void {
  if (!r.ok) notify.error(r.error);
  else r.warnings?.forEach(notify.warning);
}

/** Split at the playhead: the selected clip, else the clip under the playhead on the selected
 *  track (A3 §4.2). Shared by the S key and the clip panel's Split button. */
export function splitAtPlayhead(services: Services, view: ViewStore): void {
  const { queries, transport, edit } = services;
  const t = transport.position();
  const { selectedClipId, selectedTrackId } = view.get();
  const clip =
    selectedClipId !== null
      ? (queries.findClip(selectedClipId)?.clip ?? null)
      : selectedTrackId !== null
        ? queries.clipAt(selectedTrackId, t)
        : null;
  if (!clip) {
    notify.error(MSG.editNoClip);
    return;
  }
  if (t <= clip.startTime || t >= clip.startTime + clip.duration) {
    notify.error(MSG.editPlayheadOutside);
    return;
  }
  report(edit.split(clip.id, t));
}

/** Runs one shortcut. */
export async function runShortcut(
  action: ShortcutAction,
  services: Services,
  view: ViewStore,
): Promise<void> {
  const { transport, edit, projects, queries } = services;
  const { selectedClipId, selectedTrackId, selection, pxPerSecond } = view.get();
  switch (action.type) {
    case 'togglePlay':
      report(await transport.togglePlay());
      return;
    case 'stop':
      transport.stop();
      return;
    case 'split':
      splitAtPlayhead(services, view);
      return;
    case 'deleteSelection':
      if (selection) report(edit.deleteRegion(selection.clipId, selection.start, selection.end));
      return;
    case 'trim':
      if (selection) report(edit.trimToSelection(selection.clipId, selection.start, selection.end));
      return;
    case 'mute':
      if (selectedTrackId !== null) edit.toggleMute(selectedTrackId);
      return;
    case 'solo':
      if (selectedTrackId !== null) edit.toggleSolo(selectedTrackId);
      return;
    case 'nudge': {
      const loc = selectedClipId === null ? null : queries.findClip(selectedClipId);
      if (loc) report(edit.moveClip(loc.clip.id, loc.track.id, loc.clip.startTime + action.by));
      return;
    }
    case 'save':
      report(await projects.save());
      return;
    case 'zoom':
      view.set({ pxPerSecond: pxPerSecond * action.factor }); // the view store clamps it
      return;
  }
}

/** One keydown listener on window for every shortcut. */
export function useShortcuts(): void {
  const services = useServices();
  const view = useViewStore();

  useEffect(() => {
    let spaceHandled = false;

    function onKeyDown(e: KeyboardEvent): void {
      const action = keyToAction(e, { inField: isFieldTarget(e.target) });
      if (!action) return;
      // Keep Space from also clicking a focused button, arrows from scrolling, Ctrl+S from
      // saving the page.
      e.preventDefault();
      if (e.key === ' ') spaceHandled = true;
      void runShortcut(action, services, view);
    }

    // Buttons click on Space's keyup, so that is cancelled too.
    function onKeyUp(e: KeyboardEvent): void {
      if (e.key === ' ' && spaceHandled) {
        spaceHandled = false;
        e.preventDefault();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [services, view]);
}
