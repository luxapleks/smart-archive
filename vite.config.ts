import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { getHttpsServerOptions } from "office-addin-dev-certs";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const VERSION = (() => {
  let hash = "dev";
  try {
    hash = execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    /* geen git */
  }
  return `${hash}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
})();

export default defineConfig(async ({ command }) => ({
  plugins: [
    {
      name: "version-file",
      closeBundle() {
        mkdirSync("dist", { recursive: true });
        writeFileSync("dist/version.json", JSON.stringify({ v: VERSION }));
      },
    },
  ],
  // Relatieve paden: werkt ook op een submap zoals https://<naam>.github.io/slim-archiveren/
  base: "./",
  resolve: {
    // De .msg-bibliotheek is voor Node geschreven; deze shims laten hem in de browser draaien
    alias: { fs: r("./src/shims/fs.ts"), crypto: r("./src/shims/crypto.ts"), buffer: "buffer/" },
  },
  define: { global: "globalThis", __APP_VERSION__: JSON.stringify(VERSION) },
  server: {
    port: 3000,
    strictPort: true,
    https: command === "serve" ? await getHttpsServerOptions() : undefined,
  },
  build: {
    outDir: "dist",
    target: "es2020",
    rollupOptions: { input: { taskpane: "taskpane.html", dialog: "dialog.html" } },
  },
}));
