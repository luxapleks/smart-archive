/**
 * Zet een RFC 822-mail (.eml, zoals Graph die levert via /$value) om naar een
 * Outlook .msg-bestand. Gebruikt postal-mime voor het parsen en @tutao/oxmsg
 * (port van MsgKit, MIT) voor het schrijven van het compound file.
 */
import PostalMime, { type Address, type Mailbox } from "postal-mime";
import { Attachment, Email } from "@tutao/oxmsg";

function flatten(list: Address[] | Address | undefined): Mailbox[] {
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  const out: Mailbox[] = [];
  for (const a of arr) {
    if ("group" in a && Array.isArray((a as any).group)) out.push(...((a as any).group as Mailbox[]));
    else if ((a as Mailbox).address) out.push(a as Mailbox);
  }
  return out;
}

/** Ruwe headerblok (tot de eerste lege regel), voor PR_TRANSPORT_MESSAGE_HEADERS. */
export function rawHeaderBlock(eml: Uint8Array): string {
  const max = Math.min(eml.byteLength, 512 * 1024);
  for (let i = 0; i < max - 3; i++) {
    if (eml[i] === 13 && eml[i + 1] === 10 && eml[i + 2] === 13 && eml[i + 3] === 10) {
      return new TextDecoder("latin1").decode(eml.subarray(0, i + 2));
    }
    if (eml[i] === 10 && eml[i + 1] === 10) {
      return new TextDecoder("latin1").decode(eml.subarray(0, i + 1));
    }
  }
  return "";
}

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "text/calendar": ".ics",
  "message/rfc822": ".eml",
  "text/plain": ".txt",
  "text/html": ".html",
};

function safeAttachmentName(name: string | null, mimeType: string, index: number): string {
  let n = (name ?? "")
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();
  if (!n) n = `bijlage-${index + 1}${EXT_BY_MIME[mimeType.split(";")[0]] ?? ".bin"}`;
  if (mimeType.startsWith("message/rfc822") && !/\.(eml|msg)$/i.test(n)) n += ".eml";
  return n;
}

export interface ConvertOptions {
  /** Ontvangsttijd uit Graph; MIME bevat alleen de verzendtijd betrouwbaar. */
  receivedOn?: Date;
}

export async function emlToMsg(eml: Uint8Array, opts: ConvertOptions = {}): Promise<Uint8Array> {
  const parsed = await PostalMime.parse(eml, {
    attachmentEncoding: "arraybuffer",
    // Doorgestuurde mails als .eml-bijlage bewaren i.p.v. in de body te plakken
    forceRfc822Attachments: true,
  });

  const email = new Email(false, false);
  const from = flatten(parsed.from)[0] ?? flatten(parsed.sender)[0];
  if (from?.address) email.sender(from.address, from.name || undefined);

  const subject = parsed.subject ?? "";
  if (subject) email.subject(subject);

  for (const r of flatten(parsed.to)) email.to(r.address, r.name || undefined);
  for (const r of flatten(parsed.cc)) email.cc(r.address, r.name || undefined);
  for (const r of flatten(parsed.bcc)) email.bcc(r.address, r.name || undefined);
  for (const r of flatten(parsed.replyTo)) email.replyTo(r.address, r.name || undefined);

  const sent = parsed.date ? new Date(parsed.date) : null;
  if (sent && !isNaN(sent.getTime())) email.sentOn(sent);
  const received = opts.receivedOn ?? sent;
  if (received && !isNaN(received.getTime())) email.receivedOn(received);

  if (parsed.html) email.bodyHtml(parsed.html);
  if (parsed.text) email.bodyText(parsed.text);
  else if (parsed.html) email.bodyText(htmlToText(parsed.html));

  const headers = rawHeaderBlock(eml);
  if (headers) email.headers(headers);

  parsed.attachments.forEach((a, i) => {
    const content =
      a.content instanceof ArrayBuffer
        ? new Uint8Array(a.content)
        : typeof a.content === "string"
          ? new TextEncoder().encode(a.content)
          : new Uint8Array(a.content as unknown as Uint8Array); // agenda-delen: al een Uint8Array
    const cid = (a.contentId ?? "").replace(/^<|>$/g, "").trim();
    const inline = Boolean(cid) && (a.related || a.disposition === "inline");
    email.attach(new Attachment(content, safeAttachmentName(a.filename, a.mimeType, i), inline ? cid : ""));
  });

  return fixEmptyStreams(email.msg());
}

const ENDOFCHAIN = 0xfffffffe;

/**
 * De onderliggende cfb-writer geeft lege streams startsector 0 i.p.v. ENDOFCHAIN.
 * Strikte lezers (o.a. olefile, sommige Outlook-versies/DMS-koppelingen) keuren
 * dat af. Deze functie loopt de directory-sectoren af en corrigeert dat in-place.
 * Zie MS-CFB §2.6.3.
 */
export function fixEmptyStreams(buf: Uint8Array): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sectorSize = 1 << dv.getUint16(0x1e, true);
  const sectorOffset = (n: number) => (n + 1) * sectorSize;
  const perSector = sectorSize / 4;

  // FAT-sectoren verzamelen via de DIFAT (header + eventuele DIFAT-sectoren)
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = dv.getUint32(0x4c + i * 4, true);
    if (s < 0xfffffffa) fatSectors.push(s);
  }
  let difat = dv.getUint32(0x44, true);
  let guard = 0;
  while (difat < 0xfffffffa && guard++ < 10_000) {
    const off = sectorOffset(difat);
    for (let i = 0; i < perSector - 1; i++) {
      const s = dv.getUint32(off + i * 4, true);
      if (s < 0xfffffffa) fatSectors.push(s);
    }
    difat = dv.getUint32(off + (perSector - 1) * 4, true);
  }
  const fatNext = (n: number) => {
    const fs = fatSectors[Math.floor(n / perSector)];
    return fs === undefined ? ENDOFCHAIN : dv.getUint32(sectorOffset(fs) + (n % perSector) * 4, true);
  };

  let dir = dv.getUint32(0x30, true);
  guard = 0;
  while (dir < 0xfffffffa && guard++ < 100_000) {
    const off = sectorOffset(dir);
    for (let e = 0; e < sectorSize / 128; e++) {
      const entry = off + e * 128;
      if (entry + 128 > buf.byteLength) break;
      const type = dv.getUint8(entry + 66);
      const size = dv.getUint32(entry + 120, true) + dv.getUint32(entry + 124, true);
      if (type === 2 && size === 0) dv.setUint32(entry + 116, ENDOFCHAIN, true);
    }
    dir = fatNext(dir);
  }
  return buf;
}

/** Simpele HTML→tekst voor het geval een mail alleen HTML heeft. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
