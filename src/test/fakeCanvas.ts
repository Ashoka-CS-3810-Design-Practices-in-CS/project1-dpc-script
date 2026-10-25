import type { Ctx2D } from '@/ui/timeline/renderer';

export interface FakeCall {
  method: string;
  args: unknown[];
  clipId: string | null; // the clip being drawn when the call was made
}

export interface FakeCanvas {
  ctx: Ctx2D;
  calls: FakeCall[];
  /** Pass as the renderer's `onClip` hook so calls are attributed to clips. */
  markClip: (clipId: string | null) => void;
  /** Number of drawing calls (fillRect, strokeRect, stroke, fill, fillText) made per clip id. */
  drawsPerClip(): Map<string, number>;
  /** Every text drawn with fillText. */
  texts(): string[];
  reset(): void;
}

const METHODS = [
  'save',
  'restore',
  'setTransform',
  'clearRect',
  'fillRect',
  'strokeRect',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'rect',
  'roundRect',
  'clip',
  'fill',
  'stroke',
  'fillText',
  'setLineDash',
] as const;
const DRAWS = new Set(['fillRect', 'strokeRect', 'stroke', 'fill', 'fillText']);

/** A recording Canvas 2D context for renderer tests in node (no canvas there). */
export function createFakeCanvas(): FakeCanvas {
  const calls: FakeCall[] = [];
  let current: string | null = null;
  const ctx: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    globalAlpha: 1,
  };
  for (const method of METHODS) {
    ctx[method] = (...args: unknown[]) => void calls.push({ method, args, clipId: current });
  }

  return {
    ctx: ctx as unknown as Ctx2D,
    calls,
    markClip: (clipId) => {
      current = clipId;
    },
    drawsPerClip() {
      const counts = new Map<string, number>();
      for (const c of calls) {
        if (c.clipId !== null && DRAWS.has(c.method)) {
          counts.set(c.clipId, (counts.get(c.clipId) ?? 0) + 1);
        }
      }
      return counts;
    },
    texts: () => calls.filter((c) => c.method === 'fillText').map((c) => String(c.args[0])),
    reset() {
      calls.length = 0;
      current = null;
    },
  };
}
