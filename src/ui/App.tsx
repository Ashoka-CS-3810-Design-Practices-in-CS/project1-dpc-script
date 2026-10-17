import type { JSX } from 'react';
import { MIN_LAYOUT_WIDTH_PX } from '@/model/constants';
import { ClipPanel } from '@/ui/clipPanel/ClipPanel';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { ProjectBar } from '@/ui/ProjectBar';
import { useShortcuts } from '@/ui/shortcuts';
import { StatusLine } from '@/ui/StatusLine';
import { Timeline } from '@/ui/timeline/Timeline';
import { Toasts } from '@/ui/Toasts';
import { TransportBar } from '@/ui/TransportBar';

/** The single window (A3 §4.1), top to bottom. */
export function App(): JSX.Element {
  useShortcuts();

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
