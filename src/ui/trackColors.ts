/** Each track gets its own colour for its clips (--track-1 … in styles.css, per theme), so tracks
 *  are easy to tell apart. The canvas can't use CSS variables, so the clip colours are worked out
 *  here from the palette it was given. */
interface TrackPalette {
  tracks: string[];
  bg: string;
  fg: string;
}

interface TrackColors {
  clipBg: string;
  clipHeader: string;
  /** Text on the clip's header strip: dark on a light colour, white on a dark one. */
  headerText: string;
  waveform: string;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` weighted `t`, `b` weighted 1 − t. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const c = (x: number, y: number) => Math.round(x * t + y * (1 - t));
  return `rgb(${c(ar, br)} ${c(ag, bg)} ${c(ab, bb)})`;
}

function isLight(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export function trackColors(trackIndex: number, p: TrackPalette): TrackColors {
  const base = p.tracks[trackIndex % p.tracks.length];
  return {
    clipBg: mix(base, p.bg, 0.22),
    clipHeader: base,
    headerText: isLight(base) ? '#1b1f2b' : '#ffffff',
    waveform: mix(base, p.fg, 0.72),
  };
}
