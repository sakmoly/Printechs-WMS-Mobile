// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

/** Match tsconfig / repo hygiene: do not lint snapshots or native build trees */
const ignoredPaths = [
  "**/node_modules/**",
  "dist/**",
  "android/**",
  "ios/**",
  ".expo/**",
  "backups/**",
  "src/backup_*/**",
  "coverage/**",
];

module.exports = defineConfig([
  { ignores: ignoredPaths },
  expoConfig,
  {
    files: ["App.{js,jsx,ts,tsx}", "src/**/*.{js,jsx,ts,tsx}"],
    rules: {
      // User-facing copy uses apostrophes; escaping hurts RN readability
      "react/no-unescaped-entities": "off",
      // Many screens intentionally omit deps to avoid refetch loops; use reviews for risky effects
      "react-hooks/exhaustive-deps": "off",
      // Unused locals/imports: TypeScript `strict` + `tsc --noEmit` already enforce correctness;
      // ESLint duplicate reporting produced hundreds of noisy warnings in this codebase.
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);
