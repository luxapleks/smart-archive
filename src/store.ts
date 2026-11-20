/**
 * Instellingen en geheugen.
 * - Kleine instellingen + keuzes per afzender: Outlook roamingSettings (reist mee met je mailbox).
 * - Mappenlijst en basispad: localStorage (kan groot zijn; per computer).
 */
export type Format = "msg" | "eml";

export interface Settings {
  format: Format;
  template: string;
  category: string;
  copyPath: boolean;
}

export const DEFAULTS: Settings = {
  format: "msg",
  template: "{date} - {from} - {to} - {title}",
  category: "Gearchiveerd",
  copyPath: true,
};

const rs = () => Office.context.roamingSettings;

function saveRoaming(): Promise<void> {
  return new Promise((resolve) => rs().saveAsync(() => resolve()));
}

export function getSettings(): Settings {
  return { ...DEFAULTS, ...((rs().get("settings") as Partial<Settings>) ?? {}) };
}

export function setSettings(s: Settings): Promise<void> {
  rs().set("settings", s);
  return saveRoaming();
}

/* ------------------------------------------------ mappen (lokaal) */

const memory: Record<string, string> = {};
function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return memory[k] ?? null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    memory[k] = v;
  }
}

export function getBasePath(): string {
  return lsGet("sa.basePath") ?? (rs().get("basePath") as string) ?? "";
}

export function getFolders(): string[] {
  try {
    return JSON.parse(lsGet("sa.folders") ?? "[]");
  } catch {
    return [];
  }
}

export async function setFolderConfig(basePath: string, folders: string[]): Promise<void> {
  lsSet("sa.basePath", basePath);
  lsSet("sa.folders", JSON.stringify(folders));
  rs().set("basePath", basePath); // klein; zo staat het basispad ook op een tweede pc
  await saveRoaming();
}

/* ------------------------------------------ keuzes per afzender */

interface Entry { path: string; t: number }
const GENERIC = new Set(["gmail.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "ziggo.nl", "kpnmail.nl", "yahoo.com"]);
const MAX = 100;

function history(): Record<string, Entry> {
  return (rs().get("senderFolders") as Record<string, Entry>) ?? {};
}
const domainOf = (a: string) => a.split("@")[1]?.toLowerCase() ?? "";

export function senderFolder(address?: string): { path: string; byDomain: boolean } | undefined {
  if (!address) return undefined;
  const h = history();
  const a = h[address.toLowerCase()];
  if (a) return { path: a.path, byDomain: false };
  const d = domainOf(address);
  const b = d && !GENERIC.has(d) ? h[`@${d}`] : undefined;
  return b ? { path: b.path, byDomain: true } : undefined;
}

export function rememberFolder(address: string | undefined, path: string): Promise<void> {
  if (!address) return Promise.resolve();
  const h = history();
  const e = { path, t: Date.now() };
  h[address.toLowerCase()] = e;
  const d = domainOf(address);
  if (d && !GENERIC.has(d)) h[`@${d}`] = e;
  rs().set("senderFolders", Object.fromEntries(Object.entries(h).sort((x, y) => y[1].t - x[1].t).slice(0, MAX)));
  return saveRoaming();
}
