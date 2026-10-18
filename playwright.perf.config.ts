import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e/perf',
  // Loading ten 5-minute files and playing for 30 s takes minutes, not seconds.
  timeout: 15 * 60_000,
  workers: 1, // one test at a time, or the timings measure each other
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173' },
  projects: [
    {
      name: 'chromium',
      // Headless Chromium has no sound card, so its audio clock never advances; this flag gives
      // it one (without it, playback would sit at 0 s).
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--disable-audio-output'] } },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
