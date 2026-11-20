/**
 * Bestandsnaamlogica. Puur TypeScript zonder Node-afhankelijkheden:
 * wordt ook door de add-in gebruikt voor de live preview, zodat preview en
 * uiteindelijke naam gegarandeerd gelijk zijn.
 */

export interface NameParts {
  /** ISO-datum YYYY-MM-DD */
  date: string;
  from: string;
  to: string;
  title: string;
}

export const DEFAULT_TEMPLATE = "{date} - {from}→{to} - {title}";
export const MAX_FILE_NAME = 150;

const REPLY_PREFIX =
  /^\s*((re|fw|fwd|aw|wg|antw|antwoord|doorst|tr|sv|vs|rv|ref)\s*(\[\d+\])?\s*:\s*)+/i;
const TAG_PREFIX = /^\s*(\[(extern|external|ext|secure|vertrouwelijk|confidential)\]\s*)+/i;

/** Verwijdert RE:/FW:/Antw:/Doorst:-ketens en [EXTERN]-tags aan het begin van een onderwerp. */
export function stripSubjectPrefixes(subject: string): string {
  let s = subject ?? "";
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(TAG_PREFIX, "").replace(REPLY_PREFIX, "");
  }
  return s.trim();
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Maakt één naamdeel veilig voor SharePoint/OneDrive en Windows.
 * Verwijdert  " * : < > ? / \ | # %  en stuurtekens, normaliseert spaties.
 */
export function sanitizeSegment(input: string): string {
  let s = (input ?? "")
    .normalize("NFC")
    // stuurtekens en bidi-overrides
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, " ")
    .replace(/["*:<>?/\\|#%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Geen punten/spaties aan het eind, geen ~$ aan het begin
  s = s.replace(/[.\s]+$/g, "").replace(/^~\$/, "").replace(/^[.\s]+/, "");
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/** Valt terug op lokaal deel van een e-mailadres als er geen weergavenaam is. */
export function labelFromAddress(name: string | undefined, address: string | undefined): string {
  const n = (name ?? "").replace(/^['"]|['"]$/g, "").trim();
  if (n && !n.includes("@")) {
    // "Jansen, Piet" -> "Piet Jansen"
    const m = n.match(/^([^,]+),\s*([^,]+)$/);
    return m ? `${m[2]} ${m[1]}` : n;
  }
  const a = (address ?? n).trim();
  return a.split("@")[0] || a;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Bouwt de bestandsnaam volgens het template. Lege delen (bv. geen ontvanger)
 * worden inclusief hun scheidingsteken weggelaten. Te lange namen worden
 * eerst op de titel en daarna op de namen ingekort.
 */
export function buildFileName(
  parts: NameParts,
  ext: string,
  template: string = DEFAULT_TEMPLATE,
  maxLen: number = MAX_FILE_NAME,
): string {
  const extension = ext.startsWith(".") ? ext : `.${ext}`;
  const budget = maxLen - extension.length;

  const clean = {
    date: sanitizeSegment(parts.date),
    from: sanitizeSegment(parts.from),
    to: sanitizeSegment(parts.to),
    title: sanitizeSegment(parts.title) || "Zonder onderwerp",
  };

  const render = (p: typeof clean) => {
    // Splits het template op placeholders, laat lege placeholders + volgende scheider weg
    const tokens = template.split(/(\{(?:date|from|to|title)\})/);
    let out = "";
    let pendingSep = "";
    for (const t of tokens) {
      const m = t.match(/^\{(date|from|to|title)\}$/);
      if (m) {
        const val = p[m[1] as keyof typeof p];
        if (val) {
          out += (out ? pendingSep : "") + val;
        }
        pendingSep = "";
      } else {
        pendingSep += t;
      }
    }
    if (out) out += pendingSep; // literale tekst na de laatste placeholder, bv. ")"
    return sanitizeSegment(out);
  };

  let name = render(clean);
  if (name.length > budget) {
    const over = name.length - budget;
    clean.title = truncate(clean.title, Math.max(20, clean.title.length - over));
    name = render(clean);
  }
  if (name.length > budget) {
    clean.from = truncate(clean.from, 30);
    clean.to = truncate(clean.to, 30);
    name = render(clean);
  }
  if (name.length > budget) name = truncate(name, budget);
  return name + extension;
}

/** Datum als YYYY-MM-DD in de opgegeven tijdzone. */
export function isoDateInZone(d: Date, timeZone = "Europe/Amsterdam"): string {
  // en-CA levert YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** ISO-datum (YYYY-MM-DD) omzetten naar het gekozen formaat: jjmmdd, jj-mm-dd, jj mm dd of jjjj-mm-dd. */
export function formatIsoDate(iso: string, format: string): string {
  const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso ?? "";
  const [, yyyy, mm, dd] = m;
  const yy = yyyy.slice(2);
  switch (format) {
    case "jj-mm-dd": return `${yy}-${mm}-${dd}`;
    case "jj mm dd": return `${yy} ${mm} ${dd}`;
    case "jjjj-mm-dd": return `${yyyy}-${mm}-${dd}`;
    default: return `${yy}${mm}${dd}`;
  }
}

/** Maakt een mappad veilig: elk segment gesanitized, lege segmenten verwijderd. */
export function sanitizeFolderPath(path: string): string {
  return (path ?? "")
    .split("/")
    .map(sanitizeSegment)
    .filter(Boolean)
    .join("/");
}
