import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/js/radioCore.js', 'src/js/stateMachine.js'],
    },
  },
});
