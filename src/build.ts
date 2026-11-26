/** Maakt het te bewaren bestand (.msg of .eml) uit de originele mail. */
export interface BuildOptions {
  format: "msg" | "eml";
  receivedOn?: string;
  /** Bijlagen ook los opslaan, met deze datum in de naam (leeg = niet) */
  attachmentDate?: string;
}

export interface NamedFile {
  name: string;
  data: Uint8Array;
  type: string;
}

/** Losse bijlagen: "{datum} Bijlage {n} {naam}". */
export async function buildAttachments(eml: Uint8Array, o: BuildOptions): Promise<NamedFile[]> {
  if (!o.attachmentDate) return [];
  const { extractAttachments, nameAttachments } = await import("./shared/attachments");
  const named = nameAttachments(o.attachmentDate, await extractAttachments(eml));
  // Bijgevoegde mails als PDF opslaan: altijd te openen en te lezen.
  // (Het origineel zit ook nog in de .msg/.eml van de mail zelf.)
  const out: NamedFile[] = [];
  for (const a of named) {
    const isMail = a.type.toLowerCase().startsWith("message/rfc822") || /\.eml$/i.test(a.name);
    if (!isMail) {
      out.push(a);
      continue;
    }
    try {
      const { emlToPdf } = await import("./shared/pdf");
      const name = a.name.replace(/\.eml$/i, "") + ".pdf";
      out.push({ name, data: await emlToPdf(a.data, { footer: name }), type: "application/pdf" });
    } catch {
      out.push(a); // PDF maken lukt niet: dan het origineel als .eml bewaren
    }
  }
  return out;
}

export interface BuiltFile {
  ext: string;
  data: Uint8Array;
  type: string;
}

export async function buildFiles(eml: Uint8Array, o: BuildOptions): Promise<BuiltFile[]> {
  if (o.format === "eml") return [{ ext: "eml", data: eml, type: "message/rfc822" }];
  // Pas laden als het nodig is: houdt het openen van het paneel snel
  const { emlToMsg } = await import("./shared/mime2msg");
  return [
    {
      ext: "msg",
      data: await emlToMsg(eml, { receivedOn: o.receivedOn ? new Date(o.receivedOn) : undefined }),
      type: "application/vnd.ms-outlook",
    },
  ];
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
