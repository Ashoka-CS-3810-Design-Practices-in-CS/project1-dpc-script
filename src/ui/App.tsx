import { useEffect, type JSX } from 'react';
import { MSG } from '@/app/messages';
import { MIN_LAYOUT_WIDTH_PX } from '@/model/constants';
import { ClipPanel } from '@/ui/clipPanel/ClipPanel';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { notify } from '@/ui/feedback';
import { ProjectBar } from '@/ui/ProjectBar';
import { useShortcuts } from '@/ui/shortcuts';
import { StatusLine } from '@/ui/StatusLine';
import { Timeline } from '@/ui/timeline/Timeline';
import { Toasts } from '@/ui/Toasts';
import { TransportBar } from '@/ui/TransportBar';

/** The single window (A3 §4.1), top to bottom. */
export function App(): JSX.Element {
  useShortcuts();

  // Whatever we did not expect still reaches the user instead of failing silently.
  useEffect(() => {
    const show = (reason: unknown) =>
      notify.error(MSG.unexpectedError(reason instanceof Error ? reason.message : String(reason)));
    const onRejection = (e: PromiseRejectionEvent) => show(e.reason);
    const onError = (e: ErrorEvent) => {
      if (e.message.startsWith('ResizeObserver loop')) return; // harmless browser noise
      show(e.error ?? e.message);
    };
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  return (
    <div className="app" style={{ minWidth: MIN_LAYOUT_WIDTH_PX }}>
      <ProjectBar />
      <TransportBar />
      <div className="timeline-area">
        <Timeline />
      </div>
      <ClipPanel />
      <StatusLine />
      <Toasts />
      <ConfirmDialog />
    </div>
  );
}
