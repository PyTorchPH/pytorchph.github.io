import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default defineConfig([
  { files: ["frontend/**/*.{ts,tsx}"], extends: [js.configs.recommended, tseslint.configs.recommended] },
  globalIgnores(["frontend/portal/.next/**", "frontend/portal/out/**", "frontend/portal/build/**", "frontend/portal/next-env.d.ts"]),
]);
