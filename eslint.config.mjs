import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "**/next-env.d.ts",
  ]),
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/**/*.{js,mjs,ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  { settings: { next: { rootDir: "apps/web/" } } },
]);
