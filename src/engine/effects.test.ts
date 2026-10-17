import { describe, expect, it } from 'vitest';
import type { Clip } from '@/model/types';
import { createRecordingContext } from '@/test/fakeAudio';
import { createDefaultEffects, EffectRegistry, fadeEffect, type ClipEffect } from './effects';

const clip: Clip = {
  id: 'c',
  sourceId: 's',
  startTime: 0,
  sourceOffset: 0,
  duration: 10,
  fadeIn: 2,
  fadeOut: 4,
};

describe('EffectRegistry', () => {
  it('lists effects in the order they were registered', () => {
    const registry = new EffectRegistry();
    const a: ClipEffect = { id: 'a', apply: (_ctx, input) => input };
    const b: ClipEffect = { id: 'b', apply: (_ctx, input) => input };
    registry.register(a);
    registry.register(b);

    expect(registry.list()).toEqual([a, b]);
  });

  it('starts empty', () => {
    expect(new EffectRegistry().list()).toEqual([]);
  });
});

describe('createDefaultEffects', () => {
  it('has the fade effect and nothing else', () => {
    expect(
      createDefaultEffects()
        .list()
        .map((e) => e.id),
    ).toEqual(['fade']);
  });
});

describe('fadeEffect', () => {
  it('puts the fade events at the clip start (w) plus their own time', () => {
    const ctx = createRecordingContext();
    const input = ctx.createBufferSource(); // src#1
    ctx.log.length = 0;

    const output = fadeEffect.apply(ctx, input, clip, 0, 20);

    expect(ctx.log).toEqual([
      'connect src#1 -> gain#2',
      'gain#2.set 0 @20',
      'gain#2.ramp 1 @22',
      'gain#2.set 1 @26',
      'gain#2.ramp 0 @30',
    ]);
    expect(output).toBeDefined();
  });

  it('starts from the right volume when playback begins part-way through a fade', () => {
    const ctx = createRecordingContext();
    const input = ctx.createBufferSource();
    ctx.log.length = 0;

    fadeEffect.apply(ctx, input, clip, 1, 5); // 1 s into the 2 s fade-in

    expect(ctx.log.slice(1)).toEqual([
      'gain#2.set 0.5 @5',
      'gain#2.ramp 1 @6',
      'gain#2.set 1 @10',
      'gain#2.ramp 0 @14',
    ]);
  });
});
