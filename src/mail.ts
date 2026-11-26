/** Leest de geopende mail uit via Office.js – alles blijft lokaal in Outlook. */
import type { MailInfo, Person } from "./shared/labels";

const toPerson = (d?: Office.EmailAddressDetails): Person => ({ name: d?.displayName, address: d?.emailAddress });

function item(): Office.MessageRead | null {
  const it = Office.context.mailbox.item as Office.MessageRead | null;
  return it && it.itemType === Office.MailboxEnums.ItemType.Message ? it : null;
}

export async function readCurrentMail(): Promise<MailInfo | null> {
  const it = item();
  if (!it) return null;
  // Tekst is alleen voor mapvoorstellen: nooit langer dan 5 s op wachten
  const body = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve(""), 5000);
    it.body.getAsync(Office.CoercionType.Text, (r) => {
      clearTimeout(timer);
      resolve(r.status === Office.AsyncResultStatus.Succeeded ? r.value : "");
    });
  });
  return {
    subject: it.subject ?? "",
    from: toPerson(it.from),
    to: (it.to ?? []).map(toPerson),
    cc: (it.cc ?? []).map(toPerson),
    date: (it.dateTimeCreated ?? new Date()).toISOString(),
    body: body.slice(0, 20000),
    me: Office.context.mailbox.userProfile.emailAddress,
    attachments: (it.attachments ?? [])
      .filter((a) => !a.isInline && a.attachmentType !== Office.MailboxEnums.AttachmentType.Cloud)
      .filter((a) => !(/^image\d{3}\.(png|jpe?g|gif|bmp)$/i.test(a.name) && a.size < 100 * 1024))
      .map((a) => (a.attachmentType === Office.MailboxEnums.AttachmentType.Item && !/\.(eml|msg)$/i.test(a.name) ? `${a.name}.eml` : a.name)),
  };
}

export function canExport(): boolean {
  return Office.context.requirements.isSetSupported("Mailbox", "1.14");
}

/** Volledige mail (MIME/.eml) incl. bijlagen en headers. Vereist Mailbox 1.14. */
export async function getEml(): Promise<Uint8Array> {
  const it = item();
  if (!it) throw new Error("Geen mail geselecteerd");
  if (!canExport()) {
    throw new Error("Deze Outlook-versie kan de mail niet exporteren (Mailbox 1.14 vereist). Werk Outlook bij of gebruik nieuwe Outlook / Outlook op het web.");
  }
  const b64 = await new Promise<string>((resolve, reject) =>
    (it as any).getAsFileAsync((r: Office.AsyncResult<string>) =>
      r.status === Office.AsyncResultStatus.Succeeded ? resolve(r.value) : reject(new Error(r.error?.message ?? "Exporteren mislukt")),
    ),
  );
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Categorie toevoegen; vereist dat de categorie in Outlook bestaat (master list). */
export function addCategory(name: string): Promise<string | null> {
  const it = item() as any;
  if (!name || !it?.categories || !Office.context.requirements.isSetSupported("Mailbox", "1.8")) return Promise.resolve(null);
  return new Promise((resolve) =>
    it.categories.getAsync((g: Office.AsyncResult<Office.CategoryDetails[]>) => {
      if (g.status === Office.AsyncResultStatus.Succeeded && g.value?.some((c) => c.displayName === name)) return resolve(null);
      it.categories.addAsync([name], (r: Office.AsyncResult<void>) =>
        resolve(
          r.status === Office.AsyncResultStatus.Succeeded
            ? null
            : `Categorie '${name}' niet gezet: maak deze categorie eenmalig aan in Outlook.`,
        ),
      );
    }),
  );
}
