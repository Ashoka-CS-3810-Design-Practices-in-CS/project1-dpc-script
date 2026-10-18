import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// T7 and the other performance targets (A3 §2.8). Local only: run `npm run fixtures -- --perf`,
// then `npm run test:perf`, on the laptop whose numbers you want, in a quiet browser session.
// The tests share one page and run in order: each builds on the project the one before left.

test.describe.configure({ mode: 'serial' });

// ---- targets (A3 §2.8) ----
const WAVEFORM_MS = 2000; // waveform summary of a 5-minute stereo file
const PLAY_MS = 100; // Play click → mix scheduled
const MIN_FPS = 30;
const EXPORT_MS = 10_000; // 3-minute stereo mix
const OPEN_MS = 200; // opening a project, up to store.replace
const SESSION_MS = 30_000; // how long to play, scroll and drag
const TRACKS = 10;

const perfFixture = (i: number) =>
  fileURLToPath(new URL(`../fixtures/generated/perf-${i}.wav`, import.meta.url));

// Timeline geometry (README §7); the test never zooms.
const PX_PER_SECOND = 100;
const RULER_PX = 28;
const CLIP_HEADER_MIDDLE_PX = 2 + 8;

interface Row {
  metric: string;
  target: string;
  result: string;
  pass: boolean | null; // null = reported, not a target
}
const rows: Row[] = [];
const record = (metric: string, target: string, result: string, pass: boolean | null): void => {
  rows.push({ metric, target, result, pass });
};
const ms = (n: number) => `${n.toFixed(0)} ms`;

let page: Page;
let browserVersion = '';
const pageErrors: Error[] = [];

/** Calls a function of e2e/perf/harness.mjs in the page. */
const run = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate<T>(
    `import('/e2e/perf/harness.mjs').then((m) => m.${fn}(${args.map((a) => JSON.stringify(a)).join(', ')}))`,
  );
const now = () => page.evaluate<number>('performance.now()');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeAll(async ({ browser }) => {
  for (let i = 1; i <= TRACKS; i++) {
    if (!existsSync(perfFixture(i))) {
      throw new Error('Missing perf fixtures. Run: npm run fixtures -- --perf');
    }
  }
  browserVersion = browser.version();
  page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(e));
  page.on('download', (d) => void d.cancel().catch(() => {})); // the export's file is not needed
  await page.goto('/');
  await run('installMonitors');
});

test.afterAll(async () => {
  await page.close();
  const cpu = os.cpus();
  const table = [
    '| Metric | Target | Result | |',
    '|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.metric} | ${r.target} | ${r.result} | ${r.pass === null ? '' : r.pass ? 'pass' : '**FAIL**'} |`,
    ),
  ].join('\n');
  const text = [
    `Machine: ${cpu[0].model.trim()} (${cpu.length} threads), ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM, ${os.platform()}`,
    `Browser: Chromium ${browserVersion}, headless, Vite dev server (unminified, React development build)`,
    '',
    table,
  ].join('\n');
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/perf-results.md', `${text}\n`);
  console.log(`\nPerformance results (also in test-results/perf-results.md)\n\n${text}\n`);
});

test.describe('T7 and A3 performance targets', () => {
  test('load 10 tracks of 5-minute stereo files and time the first waveform', async () => {
    const trackIds = await run<string[]>('addTracks', TRACKS);

    // File 1 alone, so its waveform has the machine to itself.
    const first = await run<{ sourceId: string; resolvedAt: number }>('importOne', 1, trackIds[0]);
    const peaks = await run<Array<{ sourceId: string; at: number }>>('waitForAllPeaks');
    const done = peaks.find((p) => p.sourceId === first.sourceId)!.at;
    const waveformMs = done - first.resolvedAt;
    const during = (
      await run<Array<{ start: number; ms: number }>>('longTasksSince', first.resolvedAt)
    ).filter((t) => t.start <= done);
    record(
      'Waveform summary, 5-min stereo file',
      `< ${WAVEFORM_MS} ms`,
      ms(waveformMs),
      waveformMs < WAVEFORM_MS,
    );
    record(
      'Long tasks while that waveform computes',
      'none over 50 ms',
      during.length === 0
        ? 'none'
        : `${during.length}, longest ${ms(Math.max(...during.map((t) => t.ms)))}`,
      during.length === 0,
    );

    // 73 ms for 13 million samples per channel is fast, so check the waveform is the real thing.
    const summary = await run<{
      length: number;
      levels: number;
      blockSize: number;
      widest: number;
    }>('describePeaks', first.sourceId);
    expect(summary).toMatchObject({ length: 300 * 44100, blockSize: 256 });
    expect(summary.levels).toBeGreaterThan(5);
    expect(summary.widest).toBeGreaterThan(0.4); // the tone's peaks (amplitude 0.5), not silence

    // Files 2..10, one per track, then the rest of the waveforms. A long task that falls inside an
    // import() call is import work (reading and storing a 50 MB file); the rest is waveforms.
    const loadStart = await now();
    const imports: Array<{ startedAt: number; resolvedAt: number }> = [];
    for (let i = 2; i <= TRACKS; i++) {
      imports.push(
        await run<{ startedAt: number; resolvedAt: number }>('importOne', i, trackIds[i - 1]),
      );
    }
    await run('waitForAllPeaks');
    const loadTasks = await run<Array<{ start: number; ms: number }>>('longTasksSince', loadStart);
    const inImport = (t: { start: number; ms: number }) =>
      imports.some((w) => t.start + t.ms >= w.startedAt && t.start <= w.resolvedAt);
    const importTasks = loadTasks.filter(inImport);
    const waveformTasks = loadTasks.filter((t) => !inImport(t));
    const describeTasks = (tasks: Array<{ ms: number }>) =>
      tasks.length === 0
        ? 'none'
        : `${tasks.length}, longest ${ms(Math.max(...tasks.map((t) => t.ms)))}`;
    record(
      'Long tasks inside import() calls, files 2–10',
      '(reported)',
      describeTasks(importTasks),
      null,
    );
    record(
      'Long tasks while only waveforms compute, files 2–10',
      'none over 50 ms',
      describeTasks(waveformTasks),
      waveformTasks.length === 0,
    );

    const layout = await run<{ tracks: number; clips: number; sourcesReady: boolean }>(
      'splitIntoFive',
    );
    expect(layout).toMatchObject({ tracks: TRACKS, clips: TRACKS * 5, sourcesReady: true });
  });

  test('play, scroll and drag for 30 s', async () => {
    const play = page.getByRole('button', { name: 'Play', exact: true });
    const pause = page.getByRole('button', { name: 'Pause', exact: true });

    // First Play creates the audio context; the second is the usual case.
    await play.click();
    await expect(pause).toBeVisible();
    const cold = await run<number | null>('playLatency');
    await pause.click();
    await play.click();
    await expect(pause).toBeVisible();
    const warm = await run<number | null>('playLatency');
    expect(cold).not.toBeNull();
    expect(warm).not.toBeNull();
    record('Play click → mix scheduled, first Play', `< ${PLAY_MS} ms`, ms(cold!), cold! < PLAY_MS);
    record(
      'Play click → mix scheduled, later Plays',
      `< ${PLAY_MS} ms`,
      ms(warm!),
      warm! < PLAY_MS,
    );

    // 30 s of scrolling both ways and dragging the first clip of the first track, while playing.
    const versionBefore = await page.evaluate<number>('window.__dpcs.store.version()');
    await run('startRecording');
    const sessionStart = await now();
    const started = Date.now();
    let dragRight = true;
    while (Date.now() - started < SESSION_MS) {
      await page.evaluate("document.querySelector('.timeline-scroll').scrollTop = 0");
      const box = (await page.locator('.timeline-canvas-area canvas').last().boundingBox())!;
      await page.mouse.move(box.x + 500, box.y + 200);
      await page.mouse.wheel(300, 0); // 3 s to the right
      await sleep(150);
      await page.mouse.wheel(-300, 0);
      await sleep(150);
      await page.mouse.wheel(0, 300); // down through the tracks
      await sleep(150);
      await page.mouse.wheel(0, -300);
      await sleep(150);

      await page.evaluate("document.querySelector('.timeline-scroll').scrollTop = 0");
      const y = box.y + RULER_PX + CLIP_HEADER_MIDDLE_PX;
      const x = box.x + 3 * PX_PER_SECOND; // 3 s: inside the first clip (1–61 s), on its top strip
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (dragRight ? 20 : -20), y, { steps: 4 });
      await page.mouse.move(x + (dragRight ? 40 : -40), y, { steps: 4 });
      await page.mouse.up();
      dragRight = !dragRight;
    }
    const { frames, longTasks } = await run<{
      frames: number[];
      longTasks: Array<{ start: number; ms: number }>;
    }>('stopRecording', sessionStart);
    const versionAfter = await page.evaluate<number>('window.__dpcs.store.version()');
    expect(await page.evaluate('window.__dpcs.transport.state()'), 'still playing').toBe('playing');
    expect(versionAfter, 'the drags committed edits').toBeGreaterThan(versionBefore);

    // Frame rate over the whole session, and its worst second.
    const seconds = (frames.at(-1)! - frames[0]) / 1000;
    const average = (frames.length - 1) / seconds;
    const perSecond = new Map<number, number>();
    for (const t of frames) {
      const bucket = Math.floor((t - frames[0]) / 1000);
      perSecond.set(bucket, (perSecond.get(bucket) ?? 0) + 1);
    }
    const fullSeconds = [...perSecond.entries()].filter(([bucket]) => bucket < Math.floor(seconds));
    const worstSecond = Math.min(...fullSeconds.map(([, n]) => n));
    const longestGap = Math.max(...frames.slice(1).map((t, i) => t - frames[i]));
    record(
      'Frame rate, playing + scrolling + dragging',
      `≥ ${MIN_FPS} fps`,
      `${average.toFixed(1)} fps average`,
      average >= MIN_FPS,
    );
    record('Frame rate, worst single second', '(reported)', `${worstSecond} fps`, null);
    record('Longest gap between frames', '(reported)', ms(longestGap), null);
    record(
      'Long tasks during those 30 s',
      'none over 50 ms',
      longTasks.length === 0
        ? 'none'
        : `${longTasks.length}, longest ${ms(Math.max(...longTasks.map((t) => t.ms)))}`,
      longTasks.length === 0,
    );

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
  });

  test('export a 3-minute stereo mix', async () => {
    const cut = await run<{ end: number; clips: number }>('cutToThreeMinutes');
    expect(cut.end).toBe(180);

    const exported = await run<{
      ok: boolean;
      error: string | null;
      ms: number;
      bytes: number;
      duration: number;
    }>('exportMix');
    expect(exported.error).toBeNull();
    expect(exported.bytes).toBe(44 + 2 * 2 * Math.ceil(180 * 44100));
    record(
      `Export, 3-min stereo mix (${TRACKS} tracks, ${cut.clips} clips)`,
      `< ${EXPORT_MS / 1000} s`,
      ms(exported.ms),
      exported.ms < EXPORT_MS,
    );
  });

  test('open a saved project', async () => {
    const opened = await run<{
      ok: boolean;
      toReplaceMs: number | null;
      openCallMs: number;
      tracks: number;
      sourcesLoading: number;
    }>('saveThenOpen');
    expect(opened.ok).toBe(true);
    expect(opened.tracks).toBe(TRACKS);
    expect(opened.toReplaceMs).not.toBeNull();
    record(
      'Open a saved project, up to store.replace',
      `< ${OPEN_MS} ms`,
      ms(opened.toReplaceMs!),
      opened.toReplaceMs! < OPEN_MS,
    );
    record('Open a saved project, whole open() call', '(reported)', ms(opened.openCallMs), null);
  });

  test('every target is met', () => {
    const missed = rows
      .filter((r) => r.pass === false)
      .map((r) => `${r.metric}: ${r.result} (target ${r.target})`);
    expect(missed).toEqual([]);
  });

  test('the page raised no uncaught errors', () => {
    expect(pageErrors).toEqual([]);
  });
});
