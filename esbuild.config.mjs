import esbuild from "esbuild";
import process from "node:process";

const production = process.env.NODE_ENV === "production";

await esbuild.build({
  banner: {
    js: "/* SQL Viewer generated bundle */",
  },
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["obsidian"],
  format: "cjs",
  loader: {
    ".wasm": "binary",
  },
  logLevel: "info",
  minify: production,
  outfile: "main.js",
  platform: "browser",
  sourcemap: production ? false : "inline",
  target: "es2022",
});
