/**
 * Mappen scoren op overeenkomst met een mail (afzenderdomein, onderwerp, tekst).
 * Puur TypeScript, testbaar in Node.
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
