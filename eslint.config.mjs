import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Game screens keep round state in a ref-backed store and re-render with
    // a tick, so the voice engine's async callbacks always see the latest
    // state. Reading that ref during render is intentional here.
    files: ["src/app/play/**/*.tsx"],
    rules: { "react-hooks/refs": "off" },
  },
  {
    // Loading data from the API in an effect is deliberate (client screens).
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "data/**"]),
]);

export default eslintConfig;
