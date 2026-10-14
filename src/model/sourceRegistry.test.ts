import { describe, expect, it } from 'vitest';
import { createSourceRegistry } from './sourceRegistry';
import type { AudioSource } from './types';

const source = (id: string, refCount = 0): AudioSource => ({
  id,
  fileName: `${id}.wav`,
  status: 'ready',
  buffer: null,
  peaks: null,
  refCount,
});

describe('source registry', () => {
  it('adds and gets a source', () => {
    const registry = createSourceRegistry();
    const a = source('a', 2);
    registry.add(a);

    expect(registry.get('a')).toBe(a);
    expect(registry.get('b')).toBeUndefined();
    expect(registry.all()).toEqual([a]);
  });

  it('counts references with retain and release', () => {
    const registry = createSourceRegistry();
    registry.add(source('a', 1));

    registry.retain('a');
    expect(registry.get('a')?.refCount).toBe(2);
    registry.release('a');
    expect(registry.get('a')?.refCount).toBe(1);
  });

  it('removes a source when its count reaches 0', () => {
    const registry = createSourceRegistry();
    registry.add(source('a', 1));

    registry.release('a');
    expect(registry.get('a')).toBeUndefined();
    expect(registry.all()).toEqual([]);
  });

  it('updates status, buffer and peaks', () => {
    const registry = createSourceRegistry();
    registry.add(source('a'));

    registry.update('a', { status: 'missing' });
    expect(registry.get('a')?.status).toBe('missing');
    expect(registry.get('a')?.fileName).toBe('a.wav'); // untouched fields stay
  });

  it('throws for an unknown id', () => {
    const registry = createSourceRegistry();

    expect(() => registry.retain('x')).toThrow('Unknown source: x');
    expect(() => registry.release('x')).toThrow('Unknown source: x');
    expect(() => registry.update('x', { status: 'ready' })).toThrow('Unknown source: x');
  });
});
