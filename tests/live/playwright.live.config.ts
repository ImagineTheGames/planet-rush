/** Config for the post-deploy live boot check — no webServer; targets LIVE_URL. */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 1,
  reporter: [['list']],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'phone-landscape',
      use: { ...devices['Pixel 7 landscape'] },
    },
  ],
});
