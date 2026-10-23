import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["workerd", "worker", "browser"],
  external: ["node:*"],
  legalComments: "none",
  outfile: "dist/index.js",
  logLevel: "info",
});
