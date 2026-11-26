/**
 * Maakt een leesbare, doorzoekbare PDF van een mail (.eml): kop met afzender,
 * ontvangers, datum, onderwerp en bijlagen, gevolgd door de tekst van de mail.
 * Bewust tekstgebaseerd (geen screenshot): klein, doorzoekbaar en betrouwbaar.
 */
import PostalMime, { type Address, type Mailbox } from "postal-mime";
import { jsPDF } from "jspdf";
import { htmlToText } from "./mime2msg";

const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const REPLACE: Record<string, string> = {
  "‐": "-", "‑": "-", "‒": "-", "−": "-", "⁃": "-",
  "′": "'", "″": '"', "‛": "'", "‟": '"',
  "•": "•", "●": "•", "▪": "•", "‣": "•", "·": "·",
  "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "≈": "~",
  "✓": "v", "✔": "v", "✗": "x", "…": "…",
};

/** Houd alleen tekens over die de standaard PDF-fonts (Windows-1252) kennen. */
export function toWinAnsi(s: string): string {
  let out = "";
  for (const ch of (s ?? "").normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (ch === "\t") out += "    ";
    else if (ch === "\n") out += "\n";
    else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.includes(ch)) out += ch;
    else if (REPLACE[ch]) out += REPLACE[ch];
    else if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0xfeff || c === 0x00ad || (c >= 0xfe00 && c <= 0xfe0f)) continue;
    else if (c === 0x202f || c === 0x2009 || c === 0x2007) out += " ";
    else {
      // Accenten loskoppelen en opnieuw proberen (ő -> o), anders weglaten/vervangen
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += base && base !== ch && base.codePointAt(0)! < 0x100 ? base : c > 0xffff ? "" : "?";
    }
  }
  return out;
}

function flatten(list: Address[] | Address | undefined): Mailbox[] {
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  const out: Mailbox[] = [];
  for (const a of arr) {
    if ("group" in a && Array.isArray((a as any).group)) out.push(...((a as any).group as Mailbox[]));
    else if ((a as Mailbox).address) out.push(a as Mailbox);
  }
  return out;
}

const fmtPeople = (l: Mailbox[]) =>
  l.map((p) => (p.name ? `${p.name} <${p.address}>` : p.address)).join("; ");

function fmtDate(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface PdfOptions {
  timeZone?: string;
  /** Tekst in de voettekst, bv. de bestandsnaam */
  footer?: string;
}

export async function emlToPdf(eml: Uint8Array, opts: PdfOptions = {}): Promise<Uint8Array> {
  const tz = opts.timeZone ?? "Europe/Amsterdam";
  const p = await PostalMime.parse(eml, { attachmentEncoding: "arraybuffer", forceRfc822Attachments: true });

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: toWinAnsi(p.subject ?? ""), creator: "Smart archive" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 18;
  const width = W - 2 * M;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > H - M - 6) {
      doc.addPage();
      y = M;
    }
  };

  // Onderwerp
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  for (const line of doc.splitTextToSize(toWinAnsi(p.subject || "(geen onderwerp)"), width) as string[]) {
    ensure(7);
    doc.text(line, M, y + 5);
    y += 6.5;
  }
  y += 2;

  // Kopregels
  const sent = p.date ? new Date(p.date) : null;
  const visibleAttachments = p.attachments.filter((a) => !(a.related && a.contentId));
  const rows: [string, string][] = [
    ["Van", fmtPeople(flatten(p.from))],
    ["Aan", fmtPeople(flatten(p.to))],
    ["Cc", fmtPeople(flatten(p.cc))],
    ["Datum", sent && !isNaN(sent.getTime()) ? fmtDate(sent, tz) : ""],
    [
      "Bijlagen",
      visibleAttachments
        .map((a) => `${a.filename || (a.mimeType?.startsWith("message/") ? "doorgestuurde mail.eml" : "naamloze bijlage")} (${fmtSize((a.content as ArrayBuffer).byteLength ?? 0)})`)
        .join("; "),
    ],
  ];
  doc.setFontSize(9.5);
  const labelW = 20;
  for (const [label, value] of rows) {
    if (!value) continue;
    const lines = doc.splitTextToSize(toWinAnsi(value), width - labelW) as string[];
    ensure(lines.length * 4.6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(90);
    doc.text(label, M, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20);
    lines.forEach((l, i) => doc.text(l, M + labelW, y + 4 + i * 4.6));
    y += lines.length * 4.6 + 1;
  }
  y += 2;
  doc.setDrawColor(180);
  doc.line(M, y, W - M, y);
  y += 5;

  // Tekst
  const body = (p.text?.trim() ? p.text : p.html ? htmlToText(p.html) : "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(20);
  const lh = 4.8;
  for (const para of toWinAnsi(body || "(geen tekst)").split("\n")) {
    const lines = para ? (doc.splitTextToSize(para, width) as string[]) : [""];
    for (const l of lines) {
      ensure(lh);
      doc.text(l, M, y + 3.5);
      y += lh;
    }
  }

  // Voettekst met paginanummers
  const pages = doc.getNumberOfPages();
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const left = toWinAnsi(opts.footer ?? "");
    if (left) doc.text(doc.splitTextToSize(left, width - 30)[0] as string, M, H - 10);
    doc.text(`Pagina ${i} van ${pages}`, W - M, H - 10, { align: "right" });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
