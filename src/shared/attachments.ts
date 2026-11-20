/**
 * Bijlagen uit de mail halen en een naam geven volgens
 * "{datum} Bijlage {n} {oorspronkelijke naam}", bv. "261120 Bijlage 1 Concept SPA.pdf".
 * Ingesloten afbeeldingen (logo's in handtekeningen) worden overgeslagen.
 */
import PostalMime from "postal-mime";
import { sanitizeSegment } from "./naming";

export interface NamedFile {
  name: string;
  data: Uint8Array;
  type: string;
}

export interface RawAttachment {
  filename: string;
  data: Uint8Array;
  type: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "text/calendar": ".ics",
  "message/rfc822": ".eml",
  "text/plain": ".txt",
};

/** Logo's/afbeeldingen uit de handtekening tellen niet als bijlage. */
export function isSignatureImage(a: { filename?: string | null; mimeType: string; size: number; inline: boolean }): boolean {
  if (!a.mimeType.startsWith("image/")) return false;
  if (a.inline) return true;
  // Outlook noemt handtekeningplaatjes image001.png enz.
  return /^image\d{3}\.(png|jpe?g|gif|bmp)$/i.test(a.filename ?? "") && a.size < 100 * 1024;
}

export async function extractAttachments(eml: Uint8Array): Promise<RawAttachment[]> {
  const p = await PostalMime.parse(eml, { attachmentEncoding: "arraybuffer", forceRfc822Attachments: true });
  const out: RawAttachment[] = [];
  for (const a of p.attachments) {
    const data =
      a.content instanceof ArrayBuffer
        ? new Uint8Array(a.content)
        : typeof a.content === "string"
          ? new TextEncoder().encode(a.content)
          : new Uint8Array(a.content as unknown as Uint8Array);
    const inline = Boolean(a.contentId) && (Boolean(a.related) || a.disposition === "inline");
    if (isSignatureImage({ filename: a.filename, mimeType: a.mimeType, size: data.byteLength, inline })) continue;
    const ext = EXT_BY_MIME[a.mimeType.split(";")[0]] ?? "";
    let filename = a.filename?.trim() || "";
    if (!filename && a.mimeType.startsWith("message/")) {
      // Bijgevoegde mail zonder bestandsnaam: onderwerp gebruiken, net als Outlook
      try {
        filename = ((await PostalMime.parse(data)).subject ?? "").trim();
      } catch {
        /* ongeldige bijgevoegde mail */
      }
      filename ||= "Doorgestuurde mail";
    }
    filename ||= `Bijlage${ext}`;
    if (a.mimeType.startsWith("message/rfc822") && !/\.(eml|msg)$/i.test(filename)) filename += ".eml";
    out.push({ filename, data, type: a.mimeType || "application/octet-stream" });
  }
  return out;
}

/** "261120 Bijlage 1 Concept SPA v3.pdf" – maximaal `maxLen` tekens, extensie blijft behouden. */
export function attachmentFileName(date: string, index: number, original: string, maxLen = 150): string {
  const m = original.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/)!;
  const ext = (m[2] ?? "").toLowerCase();
  const base = sanitizeSegment(m[1] || "bijlage");
  const prefix = sanitizeSegment(`${date} Bijlage ${index}`);
  const room = maxLen - prefix.length - 1 - ext.length;
  return `${prefix} ${base.slice(0, Math.max(10, room)).trim()}${ext}`;
}

export function nameAttachments(date: string, list: RawAttachment[]): NamedFile[] {
  return list.map((a, i) => ({ name: attachmentFileName(date, i + 1, a.filename), data: a.data, type: a.type }));
}
