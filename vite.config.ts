import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { getHttpsServerOptions } from "office-addin-dev-certs";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(async ({ command }) => ({
  // Relatieve paden: werkt ook op een submap zoals https://<naam>.github.io/slim-archiveren/
  base: "./",
  resolve: {
    // De .msg-bibliotheek is voor Node geschreven; deze shims laten hem in de browser draaien
    alias: { fs: r("./src/shims/fs.ts"), crypto: r("./src/shims/crypto.ts"), buffer: "buffer/" },
  },
  define: { global: "globalThis" },
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
