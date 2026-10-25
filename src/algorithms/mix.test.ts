import { describe, expect, it } from 'vitest';
import { resolveGains } from './mix';

const track = (muted: boolean, soloed: boolean, volume = 0.8) => ({ volume, muted, soloed });

describe('A6 mute/solo table', () => {
  // "this" track vs "another" track. Columns: this muted, this soloed, another soloed → this heard?
  const rows: [boolean, boolean, boolean, boolean][] = [
    [false, false, false, true], // nothing special
    [true, false, false, false], // muted
    [false, true, false, true], // soloed alone
    [true, true, false, true], // solo beats mute
    [false, false, true, false], // another is soloed
    [true, false, true, false], // another is soloed, this is muted
    [false, true, true, true], // both soloed
    [true, true, true, true], // both soloed, this also muted
  ];

  it.each(rows)('muted=%s soloed=%s, another soloed=%s → heard=%s', (m, s, otherSolo, heard) => {
    const gains = resolveGains([track(m, s), track(false, otherSolo, 0.5)]);
    expect(gains[0]).toBe(heard ? 0.8 : 0);
  });
});

describe('resolveGains', () => {
  it('returns nothing for no tracks', () => {
    expect(resolveGains([])).toEqual([]);
  });

  it('keeps volumes when everything is soloed', () => {
    expect(resolveGains([track(false, true, 0.3), track(true, true, 0.6)])).toEqual([0.3, 0.6]);
  });

  it('silences everything when everything is muted', () => {
    expect(resolveGains([track(true, false), track(true, false)])).toEqual([0, 0]);
  });
});
