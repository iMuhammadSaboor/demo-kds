// Vitest config — keep tests boring and predictable.
// The integration suite spawns server.mjs as a child process,
// so we run files sequentially to avoid two suites both trying
// to bind PORT=4321 at the same time.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    testTimeout: 10000,
    hookTimeout: 15000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // tests share a port; serialize them
      },
    },
    reporters: ["default"],
  },
});
