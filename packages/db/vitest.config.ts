import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files share one PostgreSQL cluster, and roles such as ezysource_runtime are
    // cluster-wide. Running files one at a time keeps their migrations from racing.
    fileParallelism: false,
  },
});
