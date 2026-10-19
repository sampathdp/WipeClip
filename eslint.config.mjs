import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // In the desktop app the dialog plugin makes window.confirm async (its
    // Promise is always truthy), so `if (!confirm(...))` never stops
    // anything there. Use confirmAction from @/lib/platform.
    rules: {
      "no-restricted-properties": ["error", { object: "window", property: "confirm", message: "Use confirmAction() from @/lib/platform." }],
      "no-restricted-globals": ["error", { name: "confirm", message: "Use confirmAction() from @/lib/platform." }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Desktop app build output (see docs/desktop).
    "desktop/.next/**",
    "desktop/out/**",
    "src-tauri/target/**",
  ]),
]);

export default eslintConfig;
