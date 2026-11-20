/**
 * Naamdelen zonder AI: nette persoonsnamen en organisatie afgeleid uit het domein.
 * "jurgen.devries@rabobank.nl" + "Jürgen de Vries" -> "Jürgen de Vries (Rabobank)"
 */
import { isoDateInZone, labelFromAddress, stripSubjectPrefixes, type NameParts } from "./naming";

export interface Person {
  name?: string;
  address?: string;
}

const GENERIC = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.nl", "live.com", "live.nl",
  "msn.com", "icloud.com", "me.com", "yahoo.com", "ziggo.nl", "kpnmail.nl", "planet.nl", "home.nl",
  "xs4all.nl", "hetnet.nl", "proton.me", "protonmail.com", "gmx.net", "gmx.de", "onmicrosoft.com",
]);
const MULTI_TLD = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i;
const SUBDOMAIN_NOISE = /^(mail|email|smtp|mx|post|info|e|news|nieuwsbrief|noreply|no-reply)$/i;

export function orgFromDomain(domain: string | undefined, ownDomain?: string): string {
  const d = (domain ?? "").toLowerCase().trim();
  if (!d || GENERIC.has(d) || d.endsWith(".onmicrosoft.com")) return "";
  if (ownDomain && d === ownDomain.toLowerCase()) return "";
  const labels = d.split(".");
  const core = MULTI_TLD.test(d) ? labels[labels.length - 3] : labels[labels.length - 2];
  if (!core || SUBDOMAIN_NOISE.test(core)) return "";
  if (core.length <= 4) return core.toUpperCase(); // KPMG, ING, ABN, EY
  return core
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const SMALL = new Set(["de", "den", "der", "van", "von", "het", "te", "ter", "ten", "op", "in", "'t", "la", "le", "du", "da", "di", "del", "della"]);

/** "piet.de.vries" -> "Piet de Vries" (tussenvoegsels klein) */
function prettifyLocalPart(local: string): string {
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Korte naam: eerste letter van de voornaam + volledige achternaam, zonder spaties.
 * "Jürgen de Vries" -> "JdeVries", "Jan Pieter van den Berg" -> "JvandenBerg",
 * "Anna Jansen-Bakker" -> "AJansen-Bakker". Eén woord blijft zoals het is.
 */
export function shortName(full: string): string {
  const clean = (full ?? "")
    .replace(/\s*[([{].*?[)\]}]\s*/g, " ") // "(Extern)", "[Rabobank]"
    .replace(/\s+[|–—]\s+.*$/, "") // "Piet Jansen | Rabobank"
    .replace(/\s+-\s+.*$/, "")
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words[0] ?? "";
  // Achternaam begint bij het eerste tussenvoegsel na de voornaam, anders het laatste woord
  let start = words.findIndex((w, i) => i > 0 && SMALL.has(w.toLowerCase()));
  if (start < 0) start = words.length - 1;
  const surname = words.slice(start).map((w, i, arr) =>
    i < arr.length - 1 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1),
  );
  return words[0].charAt(0).toUpperCase() + surname.join("");
}

export function personLabel(p: Person | undefined): string {
  if (!p) return "";
  let name = labelFromAddress(p.name, p.address);
  if (!p.name || p.name.includes("@")) name = prettifyLocalPart(name);
  return shortName(name);
}

export interface MailInfo {
  subject: string;
  from: Person;
  to: Person[];
  cc: Person[];
  date: string;
  body: string;
  me: string;
  /** Namen van echte bijlagen (geen ingesloten afbeeldingen), in volgorde */
  attachments?: string[];
}

/** Eerste zinvolle regel uit de body, als het onderwerp leeg is. */
function titleFromBody(body: string): string {
  const line = (body ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 3 && !/^(beste|hallo|hoi|hi|dear|geachte|goedemorgen|goedemiddag)\b/i.test(l));
  return line ? line.slice(0, 70) : "";
}

export function suggestParts(m: MailInfo, timeZone = "Europe/Amsterdam"): NameParts {
  const own = m.me.split("@")[1];
  const d = new Date(m.date);
  const others = m.to.filter((t) => t.address?.toLowerCase() !== m.me.toLowerCase());
  const sentByMe = m.from.address?.toLowerCase() === m.me.toLowerCase();
  // Verzonden: belangrijkste externe ontvanger; ontvangen: eerste ontvanger
  const main = sentByMe ? others[0] ?? m.to[0] : m.to[0];
  let to = personLabel(main);
  if (m.to.length > 1 && to) to += " e.a.";
  return {
    date: isoDateInZone(isNaN(d.getTime()) ? new Date() : d, timeZone),
    from: personLabel(m.from),
    to,
    title: stripSubjectPrefixes(m.subject) || titleFromBody(m.body) || "Zonder onderwerp",
  };
}
