import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4317/',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' },
    ...devices['iPhone 13'],
    browserName: 'chromium',
  },
  webServer: {
    command: 'npx vite preview --port 4317 --strictPort',
    port: 4317,
    reuseExistingServer: true,
  },
});
