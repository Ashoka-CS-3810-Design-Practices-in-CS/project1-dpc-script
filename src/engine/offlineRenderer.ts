import type { AudioContextLike } from '@/engine/audioTypes';
import type { EffectRegistry } from '@/engine/effects';
import { buildMix } from '@/engine/graphBuilder';
import { projectEnd } from '@/model/projectOps';
import type { Project } from '@/model/types';

/** An OfflineAudioContext, as far as the renderer is concerned. */
export interface OfflineContextLike extends AudioContextLike {
  startRendering(): Promise<AudioBuffer>;
}

/** A9: mixes the whole project to one buffer, through the same mix builder playback uses. */
export function renderMix(
  project: Project,
  sampleRate: number,
  channels: number,
  effects: EffectRegistry,
  createOffline: (channels: number, length: number, sampleRate: number) => OfflineContextLike,
): Promise<AudioBuffer> {
  const length = Math.ceil(projectEnd(project) * sampleRate);
  const ctx = createOffline(channels, length, sampleRate);
  buildMix(ctx, project, 0, 0, effects);
  return ctx.startRendering();
}
