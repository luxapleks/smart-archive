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

/**
 * Toestemming vragen (alleen na een klik van de gebruiker).
 * Direct requestPermission: is er al toestemming, dan komt er geen melding.
 * Bewust géén queryPermission vooraf: die blijft in classic Outlook soms eindeloos hangen.
 */
export async function ensurePermission(h: DirHandle): Promise<boolean> {
  if (!h.requestPermission) return true;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** Unieke basisnaam: "naam", "naam (2)", "naam (3)", … */
/** Naam inkorten tot `max` tekens, bij voorkeur op een woordgrens (begin blijft: datum en namen). */
export function shortenStem(stem: string, max: number): string {
  if (!isFinite(max) || stem.length <= max) return stem;
  const cut = stem.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.\-–,]+$/, "");
}

/** Unieke bestandsnaam: "naam.pdf", "naam (2).pdf", … */
export async function uniqueName(dir: FileSystemDirectoryHandle, base: string, ext: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const candidate = `${i === 1 ? base : `${base} (${i})`}${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

export async function uniqueStem(dir: FileSystemDirectoryHandle, stem: string, exts: string[]): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? stem : `${stem} (${i})`;
    const taken = await Promise.all(exts.map((e) => exists(dir, `${candidate}.${e}`)));
    if (!taken.some(Boolean)) return candidate;
  }
  return `${stem} (${Date.now()})`;
}

/** "Inbound", "inbound", "01 Inbound", "1. Inbound" en "1 - Inbound" tellen allemaal als Inbound. */
export function matchesSubfolder(dirName: string, subfolder: string): boolean {
  const esc = subfolder.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(\\d+[\\s._-]*)?${esc}$`, "i").test(dirName.trim());
}

/**
 * Zoekt een bestaande Inbound-map binnen de gekozen map, tot `maxDepth` niveaus diep
 * (bv. "Information\\Inbound"). Ondiepste treffer wint; bij gelijke diepte alfabetisch.
 */
export async function findSubfolder(
  root: FileSystemDirectoryHandle,
  subfolder: string,
  maxDepth = 3,
): Promise<{ handle: FileSystemDirectoryHandle; path: string[] } | null> {
  let level: { handle: FileSystemDirectoryHandle; path: string[] }[] = [{ handle: root, path: [] }];
  for (let depth = 1; depth <= maxDepth && level.length; depth++) {
    const next: typeof level = [];
    const hits: typeof level = [];
    for (const { handle, path } of level) {
      for await (const child of (handle as any).values() as AsyncIterable<FileSystemHandle>) {
        if (child.kind !== "directory") continue;
        const entry = { handle: child as FileSystemDirectoryHandle, path: [...path, child.name] };
        if (matchesSubfolder(child.name, subfolder)) hits.push(entry);
        else if (!child.name.startsWith(".")) next.push(entry);
      }
    }
    if (hits.length) return hits.sort((a, b) => a.path.join("/").localeCompare(b.path.join("/"), "nl"))[0];
    level = next;
  }
  return null;
}

export async function saveToDirectory(
  picked: FileSystemDirectoryHandle,
  stem: string,
  files: { ext: string; data: Uint8Array; type: string }[],
  subfolder: string,
  extras: { name: string; data: Uint8Array; type: string }[] = [],
  onStep?: (m: string) => void,
): Promise<SaveResult> {
  let target: FileSystemDirectoryHandle = picked;
  let path: string[] = [];
  onStep?.(`submap zoeken in '${picked.name}'`);
  // Kiest de gebruiker zelf al de Inbound-map, dan daar opslaan
  if (subfolder && !matchesSubfolder(picked.name, subfolder)) {
    const found = await findSubfolder(picked, subfolder);
    if (found) ({ handle: target, path } = found);
    else {
      // Nergens een Inbound-map: direct onder de gekozen map aanmaken
      target = await picked.getDirectoryHandle(subfolder, { create: true });
      path = [target.name];
    }
  }
  onStep?.(`doelmap: ${[picked.name, ...path].join("\\")}`);
  const write = async (name: string, data: Uint8Array, type: string) => {
    onStep?.(`schrijven: ${name} (${Math.round(data.byteLength / 1024)} kB)`);
    const fh = await target.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
    await w.close();
  };
  const names: string[] = [];

  // Windows weigert paden langer dan ~260 tekens (fout "NotFoundError"). Het volledige
  // pad kennen we niet, dus: lukt schrijven niet, dan de naam stap voor stap inkorten.
  const LIMITS = [Infinity, 120, 100, 85, 70, 55, 42];
  for (const limit of LIMITS) {
    const s = shortenStem(stem, limit);
    if (limit !== Infinity && s === shortenStem(stem, LIMITS[LIMITS.indexOf(limit) - 1])) continue;
    const finalStem = await uniqueStem(target, s, files.map((f) => f.ext));
    try {
      const done: string[] = [];
      for (const f of files) {
        const name = `${finalStem}.${f.ext}`;
        await write(name, f.data, f.type);
        done.push(name);
      }
      names.push(...done);
      if (limit !== Infinity) onStep?.(`naam ingekort tot ${s.length} tekens (pad te lang voor Windows)`);
      break;
    } catch (e: any) {
      if (e?.name !== "NotFoundError" || limit === LIMITS[LIMITS.length - 1]) throw e;
      onStep?.(`te lang pad, naam inkorten…`);
    }
  }

  // Bijlagen: elk een eigen naam; bij een bestaande naam "… (2).pdf"; zo nodig ingekort
  for (const x of extras) {
    const m = x.name.match(/^(.*?)(\.[^.]+)?$/)!;
    const ext = m[2] ?? "";
    for (const limit of LIMITS) {
      const base = shortenStem(m[1], limit);
      const name = await uniqueName(target, base, ext);
      try {
        await write(name, x.data, x.type);
        names.push(name);
        break;
      } catch (e: any) {
        if (e?.name !== "NotFoundError" || limit === LIMITS[LIMITS.length - 1]) throw e;
      }
    }
  }
  return { folder: [picked.name, ...path].join("\\"), names };
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

/** Laatste melding van de lokale opslag (voor het logboek). */
let idbIssue = "";
export function takeIdbIssue(): string {
  const m = idbIssue;
  idbIssue = "";
  return m;
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const work = (async () => {
    const d = await db();
    return await new Promise<T>((resolve, reject) => {
      const r = fn(d.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  })();
  try {
    // Lokale opslag mag nooit iets blokkeren: na 3 s gewoon zonder verder
    const r = await Promise.race([work, new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 3000))]);
    if (r === "timeout") {
      idbIssue = `lokale opslag gaf geen antwoord binnen 3 s (${mode})`;
      return undefined;
    }
    return r as T;
  } catch (e: any) {
    idbIssue = `lokale opslag: ${e?.name ?? ""} ${e?.message ?? e}`;
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

/* --------------------------------------- archiefroot (eenmalig gekozen) */

export async function getRoot(): Promise<DirHandle | undefined> {
  return idb<DirHandle>("readonly", (s) => s.get("root"));
}

export async function setRoot(h: FileSystemDirectoryHandle): Promise<void> {
  await idb("readwrite", (s) => s.put(h, "root"));
}

/**
 * Toegang krijgen tot een eerder gekozen map, betrouwbaar in classic Outlook:
 * 1. requestPermission (toont normaal de toestemmingsvraag);
 * 2. komt daar binnen `timeoutMs` geen antwoord op (classic Outlook na een herstart),
 *    dan het Verkenner-venster openen in diezelfde map. De gebruiker klikt
 *    'Map selecteren' en geeft akkoord; dat levert een verse map met toestemming.
 * Geeft de (eventueel nieuwe) map terug, of null bij weigeren/annuleren.
 */
export async function requestAccess(h: DirHandle, timeoutMs = 1500, onStep?: (m: string) => void): Promise<FileSystemDirectoryHandle | null> {
  if (h.requestPermission) {
    const r = await Promise.race([
      h.requestPermission({ mode: "readwrite" }).catch(() => "error" as const),
      new Promise<"timeout">((res) => setTimeout(() => res("timeout"), timeoutMs)),
    ]);
    onStep?.(`toestemming vragen: ${r}`);
    if (r === "granted") return h;
    if (r === "denied") return null;
  }
  onStep?.("Verkenner-venster openen in de archiefmap");
  try {
    return await pickDirectory(h);
  } catch (e: any) {
    onStep?.(`Verkenner-venster: ${e?.name ?? e}`);
    if (e?.name === "AbortError") return null;
    throw e;
  }
}

/**
 * Is er al toestemming? In classic Outlook (WebView2) geeft queryPermission na een
 * herstart soms nooit antwoord. Na `timeoutMs` gaan we uit van "nog geen toestemming";
 * de gebruiker klikt dan op 'Klantmappen openen'.
 */
export async function hasPermission(h: DirHandle, timeoutMs = 1500): Promise<boolean> {
  if (!h.queryPermission) return true;
  const answer = await Promise.race([
    h.queryPermission({ mode: "readwrite" }).catch(() => "prompt" as PermissionState),
    new Promise<"timeout">((r) => setTimeout(() => r("timeout"), timeoutMs)),
  ]);
  return answer === "granted";
}

export interface FolderEntry {
  path: string; // relatief aan de root, met "/"
  handle: FileSystemDirectoryHandle;
}

/** Klantmappen onder de root, tot `depth` niveaus. */
export async function listFolders(
  root: FileSystemDirectoryHandle,
  depth = 1,
  cap = 5000,
  onProgress?: (msg: string) => void,
): Promise<FolderEntry[]> {
  const out: FolderEntry[] = [];
  let level: FolderEntry[] = [{ path: "", handle: root }];
  for (let d = 0; d < depth && level.length; d++) {
    const next: FolderEntry[] = [];
    for (const parent of level) {
      onProgress?.(`map openen: ${parent.path || root.name}`);
      let seen = 0;
      for await (const child of (parent.handle as any).values() as AsyncIterable<FileSystemHandle>) {
        seen++;
        if (child.kind !== "directory" || child.name.startsWith(".") || child.name.startsWith("~")) continue;
        const e = { path: parent.path ? `${parent.path}/${child.name}` : child.name, handle: child as FileSystemDirectoryHandle };
        out.push(e);
        next.push(e);
        if (out.length >= cap) return out;
      }
    }
    level = next;
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, "nl"));
}

/* --------------------------------------------------------- favorieten */

/** Favoriet: een klantmap binnen de archiefmap (path) of een losse map elders (handle). */
export interface Favorite {
  id: string;
  label: string;
  path?: string;
  handle?: FileSystemDirectoryHandle;
}

export async function getFavorites(): Promise<Favorite[]> {
  const v = await idb<Favorite[]>("readonly", (s) => s.get("favorites"));
  return Array.isArray(v) ? v : [];
}

export async function setFavorites(list: Favorite[]): Promise<void> {
  await idb("readwrite", (s) => s.put(list, "favorites"));
}

/** Gekozen klantmap (pad t.o.v. de root, of "fav:<id>") per afzender en domein onthouden. */
export async function rememberPath(address: string | undefined, path: string) {
  const k = keysFor(address);
  for (const key of [k.address, k.domain]) if (key) await idb("readwrite", (s) => s.put(path, `p${key}`));
}

export async function rememberedPath(address?: string): Promise<{ path: string; byDomain: boolean } | null> {
  const k = keysFor(address);
  const a = k.address ? await idb<string>("readonly", (s) => s.get(`p${k.address}`)) : undefined;
  if (typeof a === "string") return { path: a, byDomain: false };
  const d = k.domain ? await idb<string>("readonly", (s) => s.get(`p${k.domain}`)) : undefined;
  return typeof d === "string" ? { path: d, byDomain: true } : null;
}
