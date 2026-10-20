import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      AUTH_MODE: 'dev',
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: './data/test-uploads',
    },
  },
});
