import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** UC1 (A3 §2.7): assemble a two-track composition, with the mouse and keyboard-only. */

// Timeline layout (src/model/constants.ts): RULER_HEIGHT_PX, TRACK_HEIGHT_PX, the 2 px clip
// inset and CLIP_HEADER_PX. At the default 100 px/s one second is 100 px.
const RULER = 28;
const ROW = 96;
const HEADER_STRIP_Y = 2 + 8; // middle of the clip's top strip, below the row top

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/generated/${name}`, import.meta.url));

interface ClipState {
  startTime: number;
  duration: number;
}
interface Snapshot {
  tracks: { name: string; clips: ClipState[] }[];
  state: string;
}
interface DpcsLike {
  store: { get(): { tracks: { name: string; clips: ClipState[] }[] } };
  transport: { state(): string };
}

/** Project and transport state from the dev-build hook (README §12). */
function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = (globalThis as unknown as { __dpcs: DpcsLike }).__dpcs;
    return {
      tracks: s.store.get().tracks.map((t) => ({
        name: t.name,
        clips: t.clips.map((c) => ({ startTime: c.startTime, duration: c.duration })),
      })),
      state: s.transport.state(),
    };
  });
}

async function importWithPicker(page: Page, open: () => Promise<void>, name: string) {
  const chooser = page.waitForEvent('filechooser');
  await open();
  await (await chooser).setFiles(fixture(name));
  await expect(page.getByText(`Imported ${name}`)).toBeVisible();
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

test('UC1 assemble a two-track composition', async ({ page }) => {
  await page.getByRole('button', { name: 'New', exact: true }).click();

  // Two tracks, renamed Narration and Music.
  await page.getByRole('button', { name: 'Add a track' }).click();
  await page.getByRole('button', { name: '+ Add track' }).click();
  await page.getByLabel('Track name', { exact: true }).fill('Music'); // opened for typing
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Track name: Track 1. Rename' }).click();
  await page.getByLabel('Track name', { exact: true }).fill('Narration');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Track Narration' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Track Music' })).toBeVisible();

  // Select a track (its header) and import onto it.
  const importButton = () => page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('group', { name: 'Track Narration' }).click({ position: { x: 4, y: 4 } });
  await importWithPicker(page, importButton, 'voice.wav');
  await page.getByRole('group', { name: 'Track Music' }).click({ position: { x: 4, y: 4 } });
  await importWithPicker(page, importButton, 'music.wav');

  let s = await snapshot(page);
  expect(s.tracks.map((t) => t.name)).toEqual(['Narration', 'Music']);
  expect(s.tracks[0].clips).toEqual([{ startTime: 0, duration: 6 }]);
  expect(s.tracks[1].clips).toEqual([{ startTime: 0, duration: 8 }]);

  // Drag the Narration clip's top strip 300 px (3 s) to the right.
  const canvas = page.locator('.timeline-canvas-area canvas').nth(1);
  const box = (await canvas.boundingBox())!;
  const y = box.y + RULER + 0 * ROW + HEADER_STRIP_Y;
  await page.mouse.move(box.x + 100, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, y, { steps: 5 });
  await page.mouse.move(box.x + 400, y, { steps: 5 });
  await page.mouse.up();

  s = await snapshot(page);
  expect(s.tracks[0].clips[0].startTime).toBeCloseTo(3, 3);
  expect(s.tracks[1].clips[0].startTime).toBe(0);

  // Play: the time display advances.
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('playing');
  await expect(page.getByLabel('Playhead time')).not.toHaveText('00:00.000');
});

test('UC1 keyboard only', async ({ page }) => {
  await tabTo(page, page.getByRole('button', { name: 'New', exact: true }));
  await page.keyboard.press('Enter');

  // Track 1 is added and selected; voice.wav goes onto it.
  await tabTo(page, page.getByRole('button', { name: 'Add a track' }));
  await page.keyboard.press('Enter');
  const importButton = page.getByRole('button', { name: 'Import', exact: true });
  await tabTo(page, importButton);
  await importWithPicker(page, () => page.keyboard.press('Enter'), 'voice.wav');

  // Track 2 is added, selected and opened for typing; music.wav goes onto it.
  await tabTo(page, page.getByRole('button', { name: '+ Add track' }));
  await page.keyboard.press('Enter');
  await page.keyboard.type('Music');
  await page.keyboard.press('Enter');
  await tabTo(page, importButton);
  await importWithPicker(page, () => page.keyboard.press('Enter'), 'music.wav');

  // Rename Track 1 (Enter opens the name with its text selected).
  await tabTo(page, page.getByRole('button', { name: 'Track name: Track 1. Rename' }));
  await page.keyboard.press('Enter');
  await page.keyboard.type('Narration');
  await page.keyboard.press('Enter');

  // Select the Narration clip from the clip list and nudge it 3 × 1 s later.
  await tabTo(page, page.getByRole('button', { name: /^Clip voice\.wav on Narration/ }));
  await page.keyboard.press('Enter');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');

  const s = await snapshot(page);
  expect(s.tracks.map((t) => t.name)).toEqual(['Narration', 'Music']);
  expect(s.tracks[0].clips[0].startTime).toBeCloseTo(3, 3);
  expect(s.tracks[1].clips[0].startTime).toBe(0);

  // Space plays.
  await page.keyboard.press(' ');
  await expect.poll(async () => (await snapshot(page)).state).toBe('playing');
  await expect(page.getByLabel('Playhead time')).not.toHaveText('00:00.000');
});
