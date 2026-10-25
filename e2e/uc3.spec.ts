import {
  addTrack,
  clipHeaderPixel,
  createDriver,
  expect,
  header,
  importAudio,
  readState,
  skipWithoutWebAudio,
  test,
  transportPosition,
  transportState,
  type Mode,
} from './fixtures/helpers.ts';

// UC3: mix three tracks with solo, volume and mute, then play. The same steps run twice: with
// the mouse, and with the keyboard alone (Tab, Enter, Space and arrow keys; no clicks, no drags).

const MODES: Array<[Mode, string]> = [
  ['mouse', 'mouse'],
  ['keyboard', 'keyboard only'],
];

for (const [mode, label] of MODES) {
  test(`UC3 mixing with solo, volume and mute, then play (${label})`, async ({ page }) => {
    // Importing, mixing and playing takes a while, and Firefox can be slow to start its audio.
    test.setTimeout(60_000);
    await page.goto('/');
    await skipWithoutWebAudio(page);
    const d = createDriver(page, mode);

    // Three tracks, each with a clip.
    await addTrack(page, d, 'Narration');
    await importAudio(page, d, 'voice.wav');
    await addTrack(page, d, 'Music');
    await importAudio(page, d, 'music.wav');
    await addTrack(page, d, 'Effects');
    await importAudio(page, d, 'voice.wav');
    let state = await readState(page);
    expect(state.tracks.map((t) => [t.name, t.clips.map((c) => c.file)])).toEqual([
      ['Narration', ['voice.wav']],
      ['Music', ['music.wav']],
      ['Effects', ['voice.wav']],
    ]);

    const solo = (track: string) => header(page, track).getByRole('button', { name: 'Solo' });
    const mute = (track: string) => header(page, track).getByRole('button', { name: 'Mute' });

    // Solo on Music: its S is pressed, the other tracks are greyed out and silent.
    await d.press(solo('Music'));
    await expect(solo('Music')).toHaveAttribute('aria-pressed', 'true');
    await expect(header(page, 'Narration')).toHaveClass(/silenced/);
    await expect(header(page, 'Effects')).toHaveClass(/silenced/);
    await expect(header(page, 'Music')).not.toHaveClass(/silenced/);
    state = await readState(page);
    expect(state.audible).toEqual({ Narration: false, Music: true, Effects: false });
    expect(state.tracks.map((t) => t.soloed)).toEqual([false, true, false]);

    // Lower Music's volume; the label next to the slider shows decibels.
    const volume = header(page, 'Music').getByRole('slider', { name: 'Volume' });
    await d.setSlider(volume, 0.25, 0.01);
    await expect(volume).toHaveAttribute('aria-valuetext', '−12.0 dB');
    await expect(header(page, 'Music')).toContainText('−12.0 dB');
    state = await readState(page);
    expect(state.tracks[1].volume).toBeCloseTo(0.25, 5);
    expect(state.tracks[0].volume).toBeCloseTo(0.5011872336272722, 5); // the others are untouched

    // Release solo: everything is audible and nothing is greyed out.
    await d.press(solo('Music'));
    await expect(solo('Music')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.track-header.silenced')).toHaveCount(0);
    state = await readState(page);
    expect(state.audible).toEqual({ Narration: true, Music: true, Effects: true });

    // Mute the third track: M is pressed, and its clip is drawn faded.
    const before = await clipHeaderPixel(page, 2, 0);
    await d.press(mute('Effects'));
    await expect(mute('Effects')).toHaveAttribute('aria-pressed', 'true');
    await expect(mute('Narration')).toHaveAttribute('aria-pressed', 'false');
    state = await readState(page);
    expect(state.audible).toEqual({ Narration: true, Music: true, Effects: false });
    await expect
      .poll(() => clipHeaderPixel(page, 2, 0), { message: 'muted clip is faded' })
      .not.toBe(before);

    // Play: the playhead moves. Changing the mix while playing does not stop it.
    const playButton = page.getByRole('button', { name: 'Play', exact: true });
    if (mode === 'keyboard') await page.keyboard.press('Space');
    else await playButton.click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(await transportState(page)).toBe('playing');
    await expect.poll(() => transportPosition(page), { timeout: 20_000 }).toBeGreaterThan(0.3);

    await d.press(mute('Narration')); // live gain ramp, no restart
    await expect(mute('Narration')).toHaveAttribute('aria-pressed', 'true');
    expect(await transportState(page)).toBe('playing');

    // Pause, then Stop (Esc) puts the playhead back at 0.
    if (mode === 'keyboard') await page.keyboard.press('Space');
    else await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(playButton).toBeVisible();
    expect(await transportState(page)).toBe('paused');
    if (mode === 'keyboard') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect.poll(() => transportState(page)).toBe('stopped');
    expect(await transportPosition(page)).toBe(0);
  });
}
