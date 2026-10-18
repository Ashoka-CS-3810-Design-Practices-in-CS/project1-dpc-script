import { statSync } from 'node:fs';
import {
  addTrack,
  createDriver,
  expect,
  header,
  importAudio,
  readState,
  selectClip,
  setClipField,
  skipWithoutWebAudio,
  test,
  type Mode,
} from './fixtures/helpers.ts';

// UC4: edit a project, name and save it, reload the page, open it again and export it. The same
// steps run twice: with the mouse, and with the keyboard alone.

const MODES: Array<[Mode, string]> = [
  ['mouse', 'mouse'],
  ['keyboard', 'keyboard only'],
];

for (const [mode, label] of MODES) {
  test(`UC4 save, reopen and export (${label})`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await skipWithoutWebAudio(page);
    const d = createDriver(page, mode);
    const dialog = (name: string) => page.getByRole('dialog', { name });

    // Two tracks with a clip each.
    await addTrack(page, d, 'Narration');
    await importAudio(page, d, 'voice.wav'); // 6 s
    await addTrack(page, d, 'Music');
    await importAudio(page, d, 'music.wav'); // 8 s

    // The clip panel: trim the narration to 4 s and give it fades.
    await selectClip(page, d, 'Narration', 'voice.wav');
    await setClipField(page, d, 'Length', 4);
    await setClipField(page, d, 'Fade-in', 0.5);
    await setClipField(page, d, 'Fade-out', 1);

    // Move the music to 1 s, then trim it to the part between 3 s and 7 s.
    await selectClip(page, d, 'Music', 'music.wav');
    await setClipField(page, d, 'Start', 1);
    await setClipField(page, d, 'Selection start', 3);
    await setClipField(page, d, 'Selection end', 7);
    await d.press(
      page.getByRole('region', { name: 'Clip details' }).getByRole('button', { name: 'Trim' }),
    );

    // Mix: music at 0.6, narration muted.
    await d.setSlider(header(page, 'Music').getByRole('slider', { name: 'Volume' }), 0.6, 0.01);
    await d.press(header(page, 'Narration').getByRole('button', { name: 'Mute' }));

    // Name the project (it has no Save As; the name is edited in the project bar).
    await d.press(page.getByRole('button', { name: /^Project name: .*\. Rename$/ }));
    await d.enter(page.getByRole('textbox', { name: 'Project name' }), 'UC4 Demo');
    const status = page.locator('footer.status-line');
    await expect(status).toHaveText('Unsaved changes');

    // Save.
    if (mode === 'keyboard') await page.keyboard.press('ControlOrMeta+S');
    else await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(status).toHaveText(/^All changes saved \d{2}:\d{2}$/);

    const saved = await readState(page);
    expect(saved.name).toBe('UC4 Demo');
    expect(saved.tracks.map((t) => t.name)).toEqual(['Narration', 'Music']);
    expect(saved.tracks[0]).toMatchObject({ muted: true, soloed: false });
    expect(saved.tracks[0].clips).toEqual([
      { file: 'voice.wav', startTime: 0, sourceOffset: 0, duration: 4, fadeIn: 0.5, fadeOut: 1 },
    ]);
    expect(saved.tracks[1].volume).toBeCloseTo(0.6, 5);
    expect(saved.tracks[1].clips).toEqual([
      { file: 'music.wav', startTime: 3, sourceOffset: 2, duration: 4, fadeIn: 0, fadeOut: 0 },
    ]);
    expect(saved.end).toBe(7);

    // Reload: the app starts with an empty project; open the saved one from the Open dialog.
    await page.reload();
    await expect(
      page.getByRole('button', { name: /^Project name: Untitled project/ }),
    ).toBeVisible();
    await d.press(page.getByRole('button', { name: 'Open', exact: true }));
    await expect(dialog('Open project')).toBeVisible();
    await d.press(dialog('Open project').getByRole('button', { name: 'Open UC4 Demo' }));
    await expect(dialog('Open project')).toHaveCount(0);

    // Everything is back: names, order, positions, trims, volume, mute, solo and fades.
    await expect.poll(async () => (await readState(page)).allSourcesReady).toBe(true);
    const reopened = await readState(page);
    expect(reopened.name).toBe('UC4 Demo');
    expect(reopened.tracks).toEqual(saved.tracks);
    expect(reopened.audible).toEqual({ Narration: false, Music: true });
    await expect(status).toHaveText(''); // opening a project is not an edit
    await expect(page.getByRole('group', { name: 'Track Narration' })).toBeVisible();

    // Export: the dialog starts with the project name; the file is 44 + 2 · L · ch bytes.
    await d.press(page.getByRole('button', { name: 'Export', exact: true }));
    await expect(dialog('Export WAV')).toBeVisible();
    await expect(dialog('Export WAV').getByLabel('File name')).toHaveValue('UC4 Demo');
    const download = page.waitForEvent('download');
    await d.press(dialog('Export WAV').getByRole('button', { name: 'Export', exact: true }));
    const file = await download;
    expect(file.suggestedFilename()).toBe('UC4 Demo.wav');
    const frames = Math.ceil(reopened.end * 44100);
    expect(statSync(await file.path()).size).toBe(44 + 2 * frames * 2); // 16-bit stereo
    await expect(dialog('Export WAV')).toHaveCount(0);
    await expect(page.getByText(/Exported UC4 Demo\.wav \(0:07, /)).toBeVisible();
  });
}
