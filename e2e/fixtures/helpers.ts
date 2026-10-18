import { fileURLToPath } from 'node:url';
import { expect, test as base, type Locator, type Page } from '@playwright/test';

/** `test` that fails when the page throws an uncaught error (A3 §2.1). */
export const test = base.extend({
  // (The callback that hands the page to the test is called `provide`, not Playwright's usual
  // `use`, which the React hooks lint rule mistakes for a hook.)
  page: async ({ page }, provide) => {
    const errors: Error[] = [];
    page.on('pageerror', (e) => errors.push(e));
    await provide(page);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  },
});

export { expect };

/** Skips the current test in a browser build without Web Audio. Playwright's WebKit for Windows
 *  is one: it has no AudioContext at all, so nothing can be decoded, played or rendered there. */
export async function skipWithoutWebAudio(page: Page): Promise<void> {
  const has = await page.evaluate('typeof OfflineAudioContext !== "undefined"');
  test.skip(!has, 'This browser build has no Web Audio');
}

/** Path of a file made by `npm run fixtures`. */
export const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`./generated/${name}`, import.meta.url));

// ---------------------------------------------------------------------------------------------
// Two ways to drive the same scenario: with the mouse, or with the keyboard alone.
// ---------------------------------------------------------------------------------------------

export type Mode = 'mouse' | 'keyboard';

export interface Driver {
  readonly mode: Mode;
  /** Activates a button (click, or Tab to it and press Enter). */
  press(target: Locator): Promise<void>;
  /** Replaces the text of a field and commits it with Enter. */
  enter(target: Locator, text: string): Promise<void>;
  /** Sets a range input to `value`; `step` is what one arrow key moves it. */
  setSlider(target: Locator, value: number, step: number): Promise<void>;
}

/** Where focus is, as the element's position in the document (BODY is early on). */
const focusPosition = (page: Page): Promise<number> =>
  page.evaluate('Array.from(document.querySelectorAll("*")).indexOf(document.activeElement)');

/** Presses Tab until `target` has focus. Like a person, so every control must be reachable.
 *  Chromium wraps from the last control back to the first; Firefox stays put on the last one, so
 *  when focus stops moving this turns round and uses Shift+Tab. */
export async function tabTo(page: Page, target: Locator, maxPresses = 150): Promise<void> {
  await expect(target).toBeAttached();
  let key = 'Tab';
  let previous = -2;
  for (let i = 0; i <= maxPresses; i++) {
    if (await target.evaluate((el) => el === el.ownerDocument.activeElement)) return;
    const here = await focusPosition(page);
    if (here === previous) {
      if (key === 'Shift+Tab') break; // stuck at the start as well: it cannot be reached
      key = 'Shift+Tab';
    }
    previous = here;
    await page.keyboard.press(key);
  }
  throw new Error(`Keyboard focus never reached ${String(target)}`);
}

export function createDriver(page: Page, mode: Mode): Driver {
  if (mode === 'mouse') {
    return {
      mode,
      press: (target) => target.click(),
      async enter(target, text) {
        await target.fill(text);
        await target.press('Enter');
      },
      setSlider: (target, value) => target.fill(String(value)),
    };
  }
  return {
    mode,
    async press(target) {
      await tabTo(page, target);
      await page.keyboard.press('Enter');
    },
    async enter(target, text) {
      await tabTo(page, target);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
    },
    async setSlider(target, value, step) {
      await tabTo(page, target);
      await page.keyboard.press('Home'); // 0
      for (let i = 0; i < Math.round(value / step); i++) await page.keyboard.press('ArrowRight');
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the app's state (window.__dpcs exists in dev builds).
// ---------------------------------------------------------------------------------------------

export interface ClipState {
  startTime: number;
  sourceOffset: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  file: string;
}
export interface TrackState {
  name: string;
  volume: number;
  muted: boolean;
  soloed: boolean;
  clips: ClipState[];
}
export interface AppState {
  name: string;
  tracks: TrackState[];
  audible: Record<string, boolean>;
  end: number;
  allSourcesReady: boolean;
}

/** The project as plain data, in track order, with the audibility the timeline queries report. */
export const readState = (page: Page): Promise<AppState> =>
  page.evaluate(`(() => {
    const s = window.__dpcs;
    const p = s.store.get();
    const audibility = s.queries.audibility();
    return {
      name: p.name,
      tracks: p.tracks.map((t) => ({
        name: t.name, volume: t.volume, muted: t.muted, soloed: t.soloed,
        clips: t.clips.map((c) => ({
          startTime: c.startTime, sourceOffset: c.sourceOffset, duration: c.duration,
          fadeIn: c.fadeIn, fadeOut: c.fadeOut, file: p.sources.get(c.sourceId)?.fileName ?? '',
        })),
      })),
      audible: Object.fromEntries(p.tracks.map((t) => [t.name, audibility.get(t.id)])),
      end: s.queries.projectEnd(),
      allSourcesReady: p.sources.all().every((x) => x.status === 'ready'),
    };
  })()`);

export const transportPosition = (page: Page): Promise<number> =>
  page.evaluate('window.__dpcs.transport.position()');
export const transportState = (page: Page): Promise<string> =>
  page.evaluate('window.__dpcs.transport.state()');

// ---------------------------------------------------------------------------------------------
// Things both use cases do.
// ---------------------------------------------------------------------------------------------

export const header = (page: Page, trackName: string): Locator =>
  page.getByRole('group', { name: `Track ${trackName}`, exact: true });

/** Adds a track and names it. The first track of an empty project uses the "Add a track" button. */
export async function addTrack(page: Page, d: Driver, name: string): Promise<void> {
  const empty = page.getByRole('button', { name: 'Add a track' });
  await d.press(
    (await empty.count()) > 0 ? empty : page.getByRole('button', { name: '+ Add track' }),
  );

  const input = page.getByRole('textbox', { name: 'Track name' });
  if ((await input.count()) === 0) {
    // Only the "+ Add track" button opens the name for typing. This is the newest, still
    // default-named track (every other one has been renamed).
    await d.press(page.getByRole('button', { name: /^Track name: Track \d+\. Rename$/ }));
  }
  await d.enter(input, name);
  await expect(header(page, name)).toBeVisible();
}

const clipTotal = (page: Page): Promise<number> =>
  page.evaluate('window.__dpcs.store.get().tracks.reduce((n, t) => n + t.clips.length, 0)');

/** Imports a fixture file onto the selected track at the playhead, through the Import button. */
export async function importAudio(page: Page, d: Driver, file: string): Promise<void> {
  const before = await clipTotal(page);
  const chooser = page.waitForEvent('filechooser');
  await d.press(page.getByRole('button', { name: 'Import', exact: true }));
  await (await chooser).setFiles(fixturePath(file));
  await expect.poll(() => clipTotal(page)).toBe(before + 1);
}

// Timeline geometry (README §7); the tests never zoom or scroll.
const PX_PER_SECOND = 100;
const RULER_PX = 28;
const TRACK_PX = 96;
const CLIP_INSET_PX = 2;
const CLIP_HEADER_MIDDLE_PX = 8;

const timelineCanvases = (page: Page): Locator => page.locator('.timeline-canvas-area canvas');

/** Where the middle of a clip's header strip is, in page coordinates, one second in. */
async function clipHeaderPoint(
  page: Page,
  trackIndex: number,
  startTime: number,
): Promise<{ x: number; y: number }> {
  const box = await timelineCanvases(page).last().boundingBox();
  if (!box) throw new Error('The timeline canvas is not visible');
  return {
    x: box.x + (startTime + 1) * PX_PER_SECOND,
    y: box.y + RULER_PX + trackIndex * TRACK_PX + CLIP_INSET_PX + CLIP_HEADER_MIDDLE_PX,
  };
}

/** Selects the clip of `file` on `trackName`: click its top strip, or Tab to its hidden button. */
export async function selectClip(
  page: Page,
  d: Driver,
  trackName: string,
  file: string,
): Promise<void> {
  if (d.mode === 'keyboard') {
    await d.press(page.getByRole('button', { name: new RegExp(`^Clip ${file} on ${trackName},`) }));
  } else {
    const { tracks } = await readState(page);
    const trackIndex = tracks.findIndex((t) => t.name === trackName);
    const clip = tracks[trackIndex].clips.find((c) => c.file === file);
    if (!clip) throw new Error(`No clip ${file} on ${trackName}`);
    const { x, y } = await clipHeaderPoint(page, trackIndex, clip.startTime);
    await page.mouse.click(x, y);
  }
  await expect(page.getByRole('region', { name: 'Clip details' })).toContainText(file);
}

/** One of the clip panel's number fields, committed with Enter. */
export async function setClipField(
  page: Page,
  d: Driver,
  label: string,
  seconds: number,
): Promise<void> {
  const field = page
    .getByRole('region', { name: 'Clip details' })
    .getByLabel(label, { exact: true });
  await d.enter(field, String(seconds));
}

/** The base timeline canvas's pixel at the middle of a clip's header strip, as "r,g,b,a". */
export async function clipHeaderPixel(
  page: Page,
  trackIndex: number,
  startTime: number,
): Promise<string> {
  const x = Math.round((startTime + 1) * PX_PER_SECOND);
  const y = RULER_PX + trackIndex * TRACK_PX + CLIP_INSET_PX + CLIP_HEADER_MIDDLE_PX;
  return page.evaluate(`(() => {
    const canvas = document.querySelector('.timeline-canvas-area canvas');
    const scale = canvas.width / canvas.clientWidth;
    return canvas.getContext('2d').getImageData(${x} * scale, ${y} * scale, 1, 1).data.join(',');
  })()`);
}
