import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** T6 (A3 Table 5): split, mute and play from the keyboard. */

// Timeline layout (src/model/constants.ts): RULER_HEIGHT_PX, the 2 px clip inset and
// CLIP_HEADER_PX. At the default 100 px/s one second is 100 px.
const RULER = 28;
const BODY_Y = 2 + 16 + 30; // inside the waveform of row 0, below the top strip

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/generated/${name}`, import.meta.url));

interface Snapshot {
  clips: { startTime: number; duration: number }[];
  muted: boolean;
  audible: boolean | undefined;
  state: string;
}
interface DpcsLike {
  store: {
    get(): {
      tracks: { id: string; muted: boolean; clips: { startTime: number; duration: number }[] }[];
    };
  };
  queries: { audibility(): Map<string, boolean> };
  transport: { state(): string };
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = (globalThis as unknown as { __dpcs: DpcsLike }).__dpcs;
    const [track] = s.store.get().tracks;
    return {
      clips: track.clips.map((c) => ({ startTime: c.startTime, duration: c.duration })),
      muted: track.muted,
      // false = drawn faded and silent (A6)
      audible: s.queries.audibility().get(track.id),
      state: s.transport.state(),
    };
  });
}

/** Presses Tab (Shift+Tab when `target` comes earlier in the page) until `target` has focus.
 *  Which way to go matters in Firefox, where tabbing past the end leaves the page. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const where = await target.evaluate((el) => {
      const active = el.ownerDocument.activeElement;
      if (active === el) return 'here';
      if (!active || active === el.ownerDocument.body) return 'after';
      // Node.DOCUMENT_POSITION_PRECEDING: the target is before the focused element.
      return active.compareDocumentPosition(el) & 2 ? 'before' : 'after';
    });
    if (where === 'here') return;
    await page.keyboard.press(where === 'before' ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Tab never reached ${target}`);
}

// Playwright's WebKit build for Windows has no Web Audio at all, so nothing can be imported.
// CI (Linux) runs these in WebKit.
test.skip(
  ({ browserName }) => browserName === 'webkit' && process.platform === 'win32',
  'WebKit on Windows has no Web Audio',
);

let errors: Error[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e));
  // Intercept file pickers from the start: waitForEvent turns this on asynchronously, and a
  // key press can open the picker before it is on.
  page.on('filechooser', () => {});
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add a track' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('T6 keyboard split/mute/play', async ({ page }) => {
  // Import a sample onto a new track.
  await page.getByRole('button', { name: 'Add a track' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles(fixture('voice.wav'));
  await expect(page.getByText('Imported voice.wav')).toBeVisible();

  // Seek inside the clip (ruler at 3 s), then select the clip.
  const canvas = page.locator('.timeline-canvas-area canvas').nth(1);
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + RULER / 2);
  await expect(page.getByLabel('Playhead time')).toHaveText('00:03.000');
  await page.mouse.click(box.x + 100, box.y + RULER + BODY_Y);
  await expect(page.getByRole('region', { name: 'Clip details' })).toBeVisible();

  // S splits at the playhead.
  await page.keyboard.press('s');
  expect((await snapshot(page)).clips).toEqual([
    { startTime: 0, duration: 3 },
    { startTime: 3, duration: 3 },
  ]);

  // Tab to the track's M button, Enter mutes it: its clips are drawn faded.
  const mute = page.getByRole('button', { name: 'Mute' });
  await tabTo(page, mute);
  await page.keyboard.press('Enter');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  expect(await snapshot(page)).toMatchObject({ muted: true, audible: false });

  // Space starts playback (without also pressing the focused M button): the track is silent.
  await page.keyboard.press(' ');
  await expect.poll(async () => (await snapshot(page)).state).toBe('playing');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  expect(await snapshot(page)).toMatchObject({ muted: true, audible: false });
});
