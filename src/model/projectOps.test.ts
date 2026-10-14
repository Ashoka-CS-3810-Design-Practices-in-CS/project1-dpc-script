import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, PROJECT_VERSION, SAMPLE_RATE } from '@/model/constants';
import {
  createEmptyProject,
  findClip,
  findTrack,
  nextTrackName,
  projectEnd,
  validateName,
} from '@/model/projectOps';
import type { Clip, Project, SourceRegistry, Track } from '@/model/types';

const sources = {} as SourceRegistry;

function clip(id: string, startTime: number, duration: number): Clip {
  return { id, sourceId: 's', startTime, duration, sourceOffset: 0, fadeIn: 0, fadeOut: 0 };
}

function track(id: string, clips: Clip[] = [], name = id): Track {
  return { id, name, volume: 1, muted: false, soloed: false, clips };
}

function project(...tracks: Track[]): Project {
  return { ...createEmptyProject('P', sources, 'p'), tracks };
}

describe('createEmptyProject', () => {
  it('builds a version-1 project with no tracks', () => {
    expect(createEmptyProject('Demo', sources, 'id-1')).toEqual({
      version: PROJECT_VERSION,
      id: 'id-1',
      name: 'Demo',
      sampleRate: SAMPLE_RATE,
      tracks: [],
      sources,
    });
  });

  it('generates a new id when none is given', () => {
    const a = createEmptyProject('A', sources);
    const b = createEmptyProject('B', sources);
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
  });
});

describe('projectEnd', () => {
  it('is 0 with no clips', () => {
    expect(projectEnd(project())).toBe(0);
    expect(projectEnd(project(track('t1')))).toBe(0);
  });

  it('is the latest clip end over all tracks', () => {
    const p = project(
      track('t1', [clip('a', 0, 4), clip('b', 5, 4.5)]),
      track('t2'),
      track('t3', [clip('c', 2, 3)]),
    );
    expect(projectEnd(p)).toBe(9.5);
  });
});

describe('findTrack / findClip', () => {
  const p = project(
    track('t1', [clip('a', 0, 1)]),
    track('t2', [clip('b', 0, 1), clip('c', 2, 1)]),
  );

  it('finds a track with its index', () => {
    expect(findTrack(p, 't2')).toEqual({ track: p.tracks[1], index: 1 });
    expect(findTrack(p, 'nope')).toBeNull();
  });

  it('finds a clip with its track and indexes', () => {
    expect(findClip(p, 'c')).toEqual({
      track: p.tracks[1],
      trackIndex: 1,
      clip: p.tracks[1].clips[1],
      clipIndex: 1,
    });
    expect(findClip(p, 'nope')).toBeNull();
  });
});

describe('validateName', () => {
  it('accepts 1 to MAX_NAME_LENGTH characters', () => {
    expect(validateName('D')).toBeNull();
    expect(validateName(' Drums ')).toBeNull();
    expect(validateName('x'.repeat(MAX_NAME_LENGTH))).toBeNull();
  });

  it('rejects empty and all-space names', () => {
    expect(validateName('')).toBe('empty');
    expect(validateName('   ')).toBe('empty');
  });

  it('rejects names longer than MAX_NAME_LENGTH', () => {
    expect(validateName('x'.repeat(MAX_NAME_LENGTH + 1))).toBe('too-long');
  });
});

describe('nextTrackName', () => {
  it('is "Track 1" for an empty project', () => {
    expect(nextTrackName(project())).toBe('Track 1');
  });

  it('uses the smallest unused number', () => {
    const p = project(track('a', [], 'Track 1'), track('b', [], 'Track 3'), track('c', [], 'Vox'));
    expect(nextTrackName(p)).toBe('Track 2');
  });
});
