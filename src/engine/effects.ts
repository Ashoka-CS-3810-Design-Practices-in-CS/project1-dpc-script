import { fadeSchedule } from '@/algorithms/fades';
import type { AudioContextLike, NodeLike } from '@/engine/audioTypes';
import type { Clip } from '@/model/types';

/** One step in a clip's signal chain (A3 Q6). Takes the node before it, returns its own. */
export interface ClipEffect {
  id: string;
  /** `t0`: seconds into the clip where playback starts. `w`: context time the clip starts sounding. */
  apply(ctx: AudioContextLike, input: NodeLike, clip: Clip, t0: number, w: number): NodeLike;
}

/** The effects every clip goes through, in the order they were registered. */
export class EffectRegistry {
  private effects: ClipEffect[] = [];

  register(effect: ClipEffect): void {
    this.effects.push(effect);
  }

  list(): readonly ClipEffect[] {
    return this.effects;
  }
}

/** Fade in and out: a gain node whose automation follows fadeSchedule. */
export const fadeEffect: ClipEffect = {
  id: 'fade',
  apply(ctx, input, clip, t0, w) {
    const gain = ctx.createGain();
    input.connect(gain);
    for (const event of fadeSchedule(clip.duration, clip.fadeIn, clip.fadeOut, t0)) {
      if (event.kind === 'set') gain.gain.setValueAtTime(event.value, w + event.time);
      else gain.gain.linearRampToValueAtTime(event.value, w + event.time);
    }
    return gain;
  },
};

/** Fades are the only effect we ship (limitation LM3). */
export function createDefaultEffects(): EffectRegistry {
  const registry = new EffectRegistry();
  registry.register(fadeEffect);
  return registry;
}
