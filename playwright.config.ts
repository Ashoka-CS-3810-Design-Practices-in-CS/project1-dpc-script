import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'perf/**',
  // Firefox is slow to start its audio when several browsers run at once, so allow for it.
  // These apply to every spec, which is why no spec needs its own timeouts.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:5173' },
  projects: [
    {
      name: 'chromium',
      // Headless Chromium has no sound card, so its audio clock never advances; this flag gives
      // it one (without it, playback would sit at 0 s).
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--disable-audio-output'] } },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
