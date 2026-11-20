/**
 * Opslaan via een Verkenner-venster (File System Access API).
 * De gebruiker kiest een map; de bestanden komen in de submap "Inbound"
 * (wordt aangemaakt als die nog niet bestaat). Gekozen mappen worden per
 * afzender/domein onthouden, zodat de volgende keer één klik genoeg is.
 */

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
};

export interface OutFile {
  name: string;
  data: Uint8Array;
  type: string;
}

export interface SaveResult {
  folder: string; // bv. "ACME BV\Inbound"
  names: string[];
}

export function pickerAvailable(): boolean {
  return typeof (window as any).showDirectoryPicker === "function";
}

/** Opent het mapkeuzevenster. Gooit AbortError bij annuleren, SecurityError in een iframe. */
export async function pickDirectory(startIn?: FileSystemHandle): Promise<DirHandle> {
  const opts: any = { id: "smart-archive", mode: "readwrite" };
  if (startIn) opts.startIn = startIn;
  try {
    return await (window as any).showDirectoryPicker(opts);
  } catch (e: any) {
    // startIn kan ongeldig zijn geworden (map verplaatst): opnieuw zonder
    if (startIn && e?.name === "TypeError") return (window as any).showDirectoryPicker({ id: "smart-archive", mode: "readwrite" });
    throw e;
  }
}

export async function ensurePermission(h: DirHandle): Promise<boolean> {
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await h.requestPermission?.({ mode: "readwrite" })) === "granted";
}

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** Unieke basisnaam zodat .msg en .pdf hetzelfde volgnummer krijgen ("… (2).msg" / "… (2).pdf"). */
export async function uniqueStem(dir: FileSystemDirectoryHandle, stem: string, exts: string[]): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? stem : `${stem} (${i})`;
    const taken = await Promise.all(exts.map((e) => exists(dir, `${candidate}.${e}`)));
    if (!taken.some(Boolean)) return candidate;
  }
  return `${stem} (${Date.now()})`;
}

export async function saveToDirectory(
  picked: FileSystemDirectoryHandle,
  stem: string,
  files: { ext: string; data: Uint8Array; type: string }[],
  subfolder: string,
): Promise<SaveResult> {
  // Kiest de gebruiker zelf al de Inbound-map, dan niet nog een Inbound daarin
  const useSub = subfolder && picked.name.toLowerCase() !== subfolder.toLowerCase();
  const target = useSub ? await picked.getDirectoryHandle(subfolder, { create: true }) : picked;
  const finalStem = await uniqueStem(target, stem, files.map((f) => f.ext));
  const names: string[] = [];
  for (const f of files) {
    const name = `${finalStem}.${f.ext}`;
    const fh = await target.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([f.data as Uint8Array<ArrayBuffer>], { type: f.type }));
    await w.close();
    names.push(name);
  }
  return { folder: useSub ? `${picked.name}\\${target.name}` : picked.name, names };
}

/* --------------------------------------- onthouden (IndexedDB) */

const DB = "smart-archive";
const STORE = "handles";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise<T>((resolve, reject) => {
      const r = fn(d.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined; // opslag niet beschikbaar: gewoon niet onthouden
  }
}

const GENERIC = new Set(["gmail.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "ziggo.nl", "kpnmail.nl", "yahoo.com"]);
const keysFor = (address?: string) => {
  const a = (address ?? "").toLowerCase();
  const d = a.split("@")[1] ?? "";
  return { address: a ? `a:${a}` : "", domain: d && !GENERIC.has(d) ? `d:${d}` : "" };
};

export async function rememberedFor(address?: string): Promise<{ handle: DirHandle; byDomain: boolean } | null> {
  const k = keysFor(address);
  const a = k.address ? await idb<DirHandle>("readonly", (s) => s.get(k.address)) : undefined;
  if (a) return { handle: a, byDomain: false };
  const d = k.domain ? await idb<DirHandle>("readonly", (s) => s.get(k.domain)) : undefined;
  return d ? { handle: d, byDomain: true } : null;
}

export async function lastFolder(): Promise<DirHandle | undefined> {
  return idb<DirHandle>("readonly", (s) => s.get("last"));
}

export async function remember(address: string | undefined, handle: FileSystemDirectoryHandle) {
  const k = keysFor(address);
  for (const key of [k.address, k.domain, "last"]) {
    if (key) await idb("readwrite", (s) => s.put(handle, key));
  }
}
