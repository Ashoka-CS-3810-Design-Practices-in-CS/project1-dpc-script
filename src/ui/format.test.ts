import { describe, expect, it } from 'vitest';
import { formatClock, formatDb, formatDuration, formatMB, formatTime } from './format';

describe('formatTime', () => {
  it('shows minutes, seconds and milliseconds', () => {
    expect(formatTime(0)).toBe('00:00.000');
    expect(formatTime(3.5)).toBe('00:03.500');
    expect(formatTime(75.25)).toBe('01:15.250');
    expect(formatTime(1800)).toBe('30:00.000');
  });

  it('rounds to the nearest millisecond, carrying into the seconds', () => {
    expect(formatTime(0.0004)).toBe('00:00.000');
    expect(formatTime(59.9996)).toBe('01:00.000');
  });

  it('treats negative times as 0', () => {
    expect(formatTime(-2)).toBe('00:00.000');
  });
});

describe('formatDuration', () => {
  it('shows minutes and two-digit seconds', () => {
    expect(formatDuration(192)).toBe('3:12');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(1800)).toBe('30:00');
  });

  it('rounds to the nearest second', () => {
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(-1)).toBe('0:00');
  });
});

describe('formatDb', () => {
  it('uses a real minus sign for gains below 1', () => {
    expect(formatDb(0.501)).toBe('−6.0 dB');
    expect(formatDb(0.1)).toBe('−20.0 dB');
  });

  it('shows silence as minus infinity', () => {
    expect(formatDb(0)).toBe('−∞ dB');
  });

  it('shows full volume as 0.0 dB, not −0.0', () => {
    expect(formatDb(1)).toBe('0.0 dB');
    expect(formatDb(0.9999)).toBe('0.0 dB');
  });

  it('shows gains above 1 without a sign', () => {
    expect(formatDb(2)).toBe('6.0 dB');
  });
});

describe('formatMB', () => {
  it('shows megabytes to one decimal', () => {
    expect(formatMB(33974272)).toBe('32.4');
    expect(formatMB(0)).toBe('0.0');
    expect(formatMB(1024 * 1024)).toBe('1.0');
  });
});

describe('formatClock', () => {
  it('shows local hours and minutes with leading zeros', () => {
    expect(formatClock(new Date(2026, 9, 15, 21, 48).getTime())).toBe('21:48');
    expect(formatClock(new Date(2026, 9, 15, 7, 5).getTime())).toBe('07:05');
  });
});
