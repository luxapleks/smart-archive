// Maakt manifest.xml op basis van manifest.template.xml.
//   ADDIN_URL  – adres waar dist/ gehost wordt (eindigt op /). Standaard https://localhost:3000/
//   ADDIN_ID   – vaste GUID voor de add-in (verander die niet meer na de eerste installatie)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
let url = process.env.ADDIN_URL || "https://localhost:3000/";
if (!url.endsWith("/")) url += "/";
if (!url.startsWith("https://")) throw new Error("ADDIN_URL moet met https:// beginnen");

const xml = readFileSync("manifest.template.xml", "utf8")
  .replaceAll("{{BASE_URL}}", url)
  .replaceAll("{{ADDIN_ID}}", process.env.ADDIN_ID || "0f3c6d1e-5a7b-4c2e-9d84-71b2a6e9c351")
  .replaceAll("{{PROVIDER}}", process.env.ADDIN_PROVIDER || "Slim archiveren")
  .replaceAll("{{VERSION}}", `${pkg.version}.0`);

mkdirSync("dist", { recursive: true });
writeFileSync("dist/manifest.xml", xml);
if (url.startsWith("https://localhost")) writeFileSync("manifest.dev.xml", xml);
console.log(`manifest.xml gemaakt voor ${url}`);
