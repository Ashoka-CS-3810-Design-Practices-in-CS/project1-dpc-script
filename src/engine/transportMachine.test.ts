import { describe, expect, it } from 'vitest';
import {
  transition,
  type Effect,
  type Machine,
  type TEvent,
  type TState,
} from './transportMachine';

// Stored position is 5 s; the live position while playing is 7 s.
const P = 5;
const LIVE = 7;
const at = (state: TState): Machine => ({ state, position: P });
const go = (state: TState, e: TEvent) => transition(at(state), e, LIVE);

function expectChange(
  state: TState,
  e: TEvent,
  next: TState,
  position: number,
  effects: Effect[],
): void {
  expect(go(state, e)).toEqual({ next: { state: next, position }, effects });
}

describe('DS6 transport table', () => {
  describe('stopped', () => {
    it('play → playing from the stored position', () =>
      expectChange('stopped', { type: 'play' }, 'playing', P, ['build']));
    it('pause is ignored', () => expect(go('stopped', { type: 'pause' })).toBeNull());
    it('stop is ignored', () => expect(go('stopped', { type: 'stop' })).toBeNull());
    it('seek moves the playhead', () =>
      expectChange('stopped', { type: 'seek', to: 2 }, 'stopped', 2, []));
    it('error → stopped with a message', () =>
      expectChange('stopped', { type: 'error', message: 'x' }, 'stopped', P, [
        'stopPlayers',
        'showError',
      ]));
    it('ended is ignored', () => expect(go('stopped', { type: 'ended', end: 9 })).toBeNull());
  });

  describe('playing', () => {
    it('play is ignored', () => expect(go('playing', { type: 'play' })).toBeNull());
    it('pause → paused at the live position', () =>
      expectChange('playing', { type: 'pause' }, 'paused', LIVE, ['stopPlayers']));
    it('stop → stopped at 0', () =>
      expectChange('playing', { type: 'stop' }, 'stopped', 0, ['stopPlayers']));
    it('seek restarts playback from the new spot', () =>
      expectChange('playing', { type: 'seek', to: 2 }, 'playing', 2, ['stopPlayers', 'build']));
    it('error → stopped where it got to', () =>
      expectChange('playing', { type: 'error', message: 'x' }, 'stopped', LIVE, [
        'stopPlayers',
        'showError',
      ]));
    it('ended → stopped at the project end', () =>
      expectChange('playing', { type: 'ended', end: 9 }, 'stopped', 9, ['stopPlayers']));
  });

  describe('paused', () => {
    it('play → playing from the stored position', () =>
      expectChange('paused', { type: 'play' }, 'playing', P, ['build']));
    it('pause is ignored', () => expect(go('paused', { type: 'pause' })).toBeNull());
    it('stop → stopped at 0', () =>
      expectChange('paused', { type: 'stop' }, 'stopped', 0, ['stopPlayers']));
    it('seek moves the playhead but stays paused', () =>
      expectChange('paused', { type: 'seek', to: 2 }, 'paused', 2, []));
    it('error → stopped with a message', () =>
      expectChange('paused', { type: 'error', message: 'x' }, 'stopped', P, [
        'stopPlayers',
        'showError',
      ]));
    it('ended is ignored', () => expect(go('paused', { type: 'ended', end: 9 })).toBeNull());
  });
});
