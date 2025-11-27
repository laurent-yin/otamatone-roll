import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

const isHeadless = process.env.VITEST_BROWSER_HEADLESS !== 'false';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/browser/**/*.test.ts'],
    setupFiles: ['tests/browser/setup.ts'],
    globals: true,
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          headless: isHeadless,
        },
      }),
      headless: isHeadless,
      instances: [
        {
          browser: 'chromium',
          name: 'chromium',
        },
      ],
    },
  },
});
