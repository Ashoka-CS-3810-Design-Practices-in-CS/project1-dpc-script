import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** UC2: remove a mistake. Deleting a region leaves two clips with a gap and never touches
 *  the audio (A5 is non-destructive). With the mouse and keyboard-only. */

// Timeline layout (src/model/constants.ts): RULER_HEIGHT_PX, the 2 px clip inset and
// CLIP_HEADER_PX. At the default 100 px/s one second is 100 px.
const RULER = 28;
const BODY_Y = 2 + 16 + 30; // inside the waveform of row 0, below the top strip
const DB_NAME = 'dpcs-editor'; // DB_NAME
const VOICE_SAMPLES = 6 * 44100; // voice.wav: 6 s at SAMPLE_RATE

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/generated/${name}`, import.meta.url));

interface ClipState {
  sourceId: string;
  startTime: number;
  sourceOffset: number;
  duration: number;
}
interface DpcsLike {
  store: {
    get(): {
      tracks: { clips: ClipState[] }[];
      sources: { get(id: string): { buffer: { length: number } | null } | undefined };
    };
  };
  transport: { state(): string };
}

async function clips(page: Page): Promise<ClipState[]> {
  return page.evaluate(() => {
    const s = (globalThis as unknown as { __dpcs: DpcsLike }).__dpcs;
    return s.store.get().tracks[0].clips.map((c) => ({
      sourceId: c.sourceId,
      startTime: c.startTime,
      sourceOffset: c.sourceOffset,
      duration: c.duration,
    }));
  });
}

/** Decoded samples in memory and bytes in IndexedDB of a source. */
async function audio(page: Page, sourceId: string): Promise<{ samples: number; bytes: number }> {
  return page.evaluate(
    ({ id, dbName }) => {
      const s = (globalThis as unknown as { __dpcs: DpcsLike }).__dpcs;
      const samples = s.store.get().sources.get(id)?.buffer?.length ?? -1;
      interface Req<T> {
        result: T;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      }
      interface Db {
        transaction(store: string): {
          objectStore(store: string): { get(key: string): Req<{ bytes: ArrayBuffer } | undefined> };
        };
      }
      const idb = (globalThis as unknown as { indexedDB: { open(name: string): Req<Db> } })
        .indexedDB;
      return new Promise((resolve, reject) => {
        const open = idb.open(dbName);
        open.onerror = () => reject(new Error('IndexedDB did not open'));
        open.onsuccess = () => {
          const get = open.result.transaction('sources').objectStore('sources').get(id);
          get.onerror = () => reject(new Error('source not readable'));
          get.onsuccess = () => resolve({ samples, bytes: get.result?.bytes.byteLength ?? -1 });
        };
      });
    },
    { id: sourceId, dbName: DB_NAME },
  );
}

const playing = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __dpcs: DpcsLike }).__dpcs.transport.state());

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

/** A new project with one track holding voice.wav at 0. */
async function setUp(page: Page, keyboard: boolean): Promise<ClipState> {
  const add = page.getByRole('button', { name: 'Add a track' });
  const importButton = page.getByRole('button', { name: 'Import', exact: true });
  const chooser = page.waitForEvent('filechooser');
  if (keyboard) {
    await tabTo(page, add);
    await page.keyboard.press('Enter');
    await tabTo(page, importButton);
    await page.keyboard.press('Enter');
  } else {
    await add.click();
    await importButton.click();
  }
  await (await chooser).setFiles(fixture('voice.wav'));
  await expect(page.getByText('Imported voice.wav')).toBeVisible();
  const [clip] = await clips(page);
  expect(clip).toMatchObject({ startTime: 0, sourceOffset: 0, duration: 6 });
  return clip;
}

/** The region [1.5, 3.5] is gone: two clips with a gap, the audio untouched, and it plays. */
async function expectRegionRemoved(page: Page, sourceId: string, before: object): Promise<void> {
  const after = await clips(page);
  expect(after).toHaveLength(2);
  expect(after[0]).toMatchObject({ sourceId, startTime: 0, sourceOffset: 0 });
  expect(after[0].duration).toBeCloseTo(1.5, 6);
  expect(after[1]).toMatchObject({ sourceId });
  expect(after[1].startTime).toBeCloseTo(3.5, 6);
  expect(after[1].sourceOffset).toBeCloseTo(3.5, 6); // same audio at the same timeline time
  expect(after[1].duration).toBeCloseTo(2.5, 6);
  expect(await audio(page, sourceId)).toEqual(before);
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

test('UC2 remove a mistake', async ({ page }) => {
  const clip = await setUp(page, false);
  const before = await audio(page, clip.sourceId);
  expect(before.samples).toBe(VOICE_SAMPLES);
  expect(before.bytes).toBeGreaterThan(0);

  // Select the clip and drag across its waveform from 1.5 s to 3.5 s.
  const canvas = page.locator('.timeline-canvas-area canvas').nth(1);
  const box = (await canvas.boundingBox())!;
  const y = box.y + RULER + BODY_Y;
  await page.mouse.move(box.x + 150, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, y, { steps: 5 });
  await page.mouse.move(box.x + 350, y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('Selection length')).toContainText('2.000 s');

  await page.keyboard.press('Delete');
  await expectRegionRemoved(page, clip.sourceId, before);

  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => playing(page)).toBe('playing');
  await expect(page.getByLabel('Playhead time')).not.toHaveText('00:00.000');
});

test('UC2 keyboard only', async ({ page }) => {
  const clip = await setUp(page, true);
  const before = await audio(page, clip.sourceId);

  // Select the clip from the clip list, then type the region into the clip panel.
  await tabTo(page, page.getByRole('button', { name: /^Clip voice\.wav on Track 1/ }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByLabel('Selection start'));
  await page.keyboard.type('1.5');
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByLabel('Selection end'));
  await page.keyboard.type('3.5');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Selection length')).toContainText('2.000 s');

  // Delete needs focus outside the text fields.
  await tabTo(page, page.getByRole('button', { name: 'Delete selection' }));
  await page.keyboard.press('Delete');
  await expectRegionRemoved(page, clip.sourceId, before);

  await page.keyboard.press(' ');
  await expect.poll(() => playing(page)).toBe('playing');
  await expect(page.getByLabel('Playhead time')).not.toHaveText('00:00.000');
});
