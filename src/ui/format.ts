const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 3.5 → "00:03.500" (mm:ss.mmm). */
export function formatTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** 192 → "3:12". */
export function formatDuration(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/** Linear gain as decibels: 0.501 → "−6.0 dB", 0 → "−∞ dB". Uses the real minus sign (U+2212). */
export function formatDb(gain: number): string {
  if (gain <= 0) return '−∞ dB';
  const db = (20 * Math.log10(gain)).toFixed(1);
  const sign = db.startsWith('-') && db !== '-0.0' ? '−' : '';
  return `${sign}${db.replace('-', '')} dB`;
}

/** Bytes as megabytes with one decimal: 33974272 → "32.4". */
export function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Epoch milliseconds as local "HH:MM". */
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
