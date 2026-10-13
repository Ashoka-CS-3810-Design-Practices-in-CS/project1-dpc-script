import { describe, expect, it } from 'vitest';
import { done, fail, ok, type Result } from '@/model/result';

describe('Result helpers', () => {
  it('ok carries the value and omits warnings when none are given', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    expect('warnings' in ok(42)).toBe(false);
  });

  it('ok keeps the warnings it is given', () => {
    expect(ok('x', ['careful'])).toEqual({ ok: true, value: 'x', warnings: ['careful'] });
  });

  it('done is ok with an undefined value', () => {
    expect(done()).toEqual({ ok: true, value: undefined });
    expect(done(['w'])).toEqual({ ok: true, value: undefined, warnings: ['w'] });
  });

  it('fail carries the message and fits any Result type', () => {
    const r: Result<number> = fail('Select a clip first.');
    expect(r).toEqual({ ok: false, error: 'Select a clip first.' });
  });
});
