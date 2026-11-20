/**
 * Mappenlijst inlezen en mappen scoren op overeenkomst met een mail.
 * Puur TypeScript, geen Office- of DOM-afhankelijkheden (testbaar in Node).
 */

const STOP = new Set(
  (
    "de het een en van in op te dat die voor met is zijn er aan als bij of om uit door naar " +
    "over ook nog maar dan wel niet geen wat wie hoe dit deze je jij u uw we wij ik mij mijn " +
    "the a an and of to in on for with is are be at by from as or this that your our re fw " +
    "fwd aw wg antw doorst mail email bericht groet groeten regards dank thanks hi hallo beste " +
    "com nl www https http"
  ).split(" "),
);

export function tokenize(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d{1,2}$/.test(t));
}

export interface ScoreInput {
  subject: string;
  body: string;
  senderDomain?: string;
  names?: string[];
}

/**
 * Woorden in afzenderdomein en onderwerp wegen zwaarder dan woorden in de body;
 * matches in diepere (specifiekere) mappen krijgen een kleine bonus.
 */
export function scoreFolders(folders: string[], text: ScoreInput): { path: string; score: number }[] {
  const weights = new Map<string, number>();
  const add = (tokens: string[], w: number) => {
    for (const t of tokens) weights.set(t, Math.max(weights.get(t) ?? 0, w));
  };
  add(tokenize(text.body).slice(0, 1500), 1);
  add(tokenize((text.names ?? []).join(" ")), 2);
  add(tokenize(text.subject), 3);
  if (text.senderDomain) add(tokenize(text.senderDomain.split(".").slice(0, -1).join(" ")), 4);

  return folders
    .map((path) => {
      let score = 0;
      path.split("/").forEach((seg, i) => {
        for (const t of tokenize(seg)) {
          const w = weights.get(t);
          if (w) score += w * (1 + i * 0.25);
          else {
            for (const [k, kw] of weights) {
              if (k.length >= 5 && t.length >= 5 && (t.includes(k) || k.includes(t))) {
                score += kw * 0.5;
                break;
              }
            }
          }
        }
      });
      return { path, score };
    })
    .sort((a, b) => b.score - a.score || b.path.length - a.path.length);
}

/* ------------------------------------------------------- mappenlijst */

const norm = (p: string) => p.trim().replace(/^"|"$/g, "").replace(/\\/g, "/").replace(/\/+$/, "");

/** Langste gemeenschappelijke map van een lijst absolute paden. */
export function commonBase(paths: string[]): string {
  if (!paths.length) return "";
  const split = paths.map((p) => p.split("/"));
  const first = split[0];
  let n = first.length;
  for (const s of split) {
    let i = 0;
    while (i < n && i < s.length && s[i].toLowerCase() === first[i].toLowerCase()) i++;
    n = i;
  }
  // Als alle paden gelijk beginnen met een map die zelf in de lijst staat, is dat de basis.
  return first.slice(0, n).join("/");
}

export interface ParsedFolders {
  /** Basispad met "/" als scheiding, leeg als onbekend */
  base: string;
  /** Mappen relatief aan de basis, gesorteerd, zonder dubbelen */
  folders: string[];
}

/**
 * Leest een geplakte of geïmporteerde mappenlijst in (één pad per regel; absolute
 * paden zoals uit PowerShell, of relatieve paden). Als er geen basispad is opgegeven
 * wordt de gemeenschappelijke basis van absolute paden gebruikt.
 */
export function parseFolderList(text: string, basePath = ""): ParsedFolders {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map(norm)
    .filter((l) => l && !/^#/.test(l));

  const isAbs = (p: string) => /^[a-z]:\//i.test(p) || p.startsWith("//") || p.startsWith("/");
  let base = norm(basePath);
  const abs = lines.filter(isAbs);
  if (!base && abs.length) base = commonBase(abs);

  const set = new Set<string>();
  for (const l of lines) {
    let rel = l;
    if (isAbs(l)) {
      if (!base || !l.toLowerCase().startsWith(base.toLowerCase())) continue;
      rel = l.slice(base.length).replace(/^\/+/, "");
    }
    rel = rel.replace(/^\.\//, "").replace(/^\/+/, "");
    if (!rel) continue;
    // Ook bovenliggende mappen opnemen (bij lijsten met alleen diepste mappen)
    const segs = rel.split("/").filter(Boolean);
    for (let i = 1; i <= segs.length; i++) set.add(segs.slice(0, i).join("/"));
  }
  const folders = [...set].filter((f) => !/(^|\/)(\.|~\$|desktop\.ini$)/i.test(f)).sort((a, b) => a.localeCompare(b, "nl"));
  return { base, folders };
}

/** Mappen afleiden uit bestanden gekozen via <input webkitdirectory> (webkitRelativePath). */
export function foldersFromRelativeFiles(relPaths: string[]): ParsedFolders {
  const set = new Set<string>();
  for (const p of relPaths) {
    const segs = p.split("/").filter(Boolean);
    // segs[0] = gekozen map zelf, laatste = bestandsnaam
    for (let i = 2; i < segs.length; i++) set.add(segs.slice(1, i).join("/"));
  }
  return { base: "", folders: [...set].sort((a, b) => a.localeCompare(b, "nl")) };
}

/** Volledig pad voor het klembord, met de scheiding van het basispad (\ op Windows). */
export function fullTargetPath(base: string, folder: string, fileName: string): string {
  const raw = [base.replace(/[\\/]+$/, ""), folder, fileName].filter(Boolean).join("/");
  const windows = /^[a-z]:/i.test(base) || base.startsWith("\\\\") || base.includes("\\");
  return windows ? raw.replace(/\//g, "\\") : raw;
}
