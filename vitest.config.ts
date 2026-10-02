import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    exclude: [
      ...configDefaults.exclude,
      "tests/integration/**/*.database.test.ts",
    ],
  },
});
