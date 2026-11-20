/** Maakt het te bewaren bestand (.msg of .eml) uit de originele mail. */
export interface BuildOptions {
  format: "msg" | "eml";
  receivedOn?: string;
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
