import { expect, test } from '@playwright/test';

// A canary for the test machine, not for the app. The playback tests rest on the browser's audio
// clock moving once an AudioContext is resumed. Firefox needs a sound card for that; on a machine
// without one resume() never finishes and the playhead stays at 0, which shows up far from the
// cause. If this test passes and a playback test fails, the app is at fault; if this one fails
// too, the machine is (CI starts a virtual sound card for it, see .github/workflows/ci.yml).

test('Firefox audio clock advances after resume()', async ({ page, browserName }) => {
  test.skip(browserName !== 'firefox', 'Chromium and WebKit fake the clock when there is no card');
  await page.goto('/');

  const result = await page.evaluate<{
    resumed: string;
    state: string;
    start: number;
    later: number;
  }>(`(async () => {
    const ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
    let resumed = 'still waiting after 10 s';
    await Promise.race([
      ctx.resume().then(() => (resumed = 'resolved'), (e) => (resumed = 'rejected: ' + e.name)),
      new Promise((done) => setTimeout(done, 10000)),
    ]);
    const start = ctx.currentTime;
    await new Promise((done) => setTimeout(done, 1000));
    return { resumed, state: ctx.state, start, later: ctx.currentTime };
  })()`);

  expect(
    result.later - result.start,
    `resume() ${result.resumed}, context ${result.state}, ` +
      `clock ${result.start} to ${result.later} after one real second`,
  ).toBeGreaterThan(0.5);
});
