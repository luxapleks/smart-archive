import { buildFileName, formatIsoDate, type NameParts } from "./shared/naming";
import { suggestParts, type MailInfo } from "./shared/labels";
import { addCategory, canExport, getEml, readCurrentMail } from "./mail";
import { buildFiles, toBase64 } from "./build";
import {
  ensurePermission,
  pickDirectory,
  pickerAvailable,
  remember,
  rememberedFor,
  saveToDirectory,
  type SaveResult,
} from "./fsaccess";
import { getSettings, setSettings, type DateFormat, type Format, type Settings } from "./store";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type State = "loading" | "error" | "form" | "done" | "settings";
const sections: Record<State, HTMLElement> = {
  loading: $("state-loading"),
  error: $("state-error"),
  form: $("state-form"),
  done: $("state-done"),
  settings: $("state-settings"),
};

const f = {
  warning: $("warning"),
  date: $<HTMLInputElement>("f-date"),
  from: $<HTMLInputElement>("f-from"),
  to: $<HTMLInputElement>("f-to"),
  title: $<HTMLInputElement>("f-title"),
  preview: $("preview"),
  original: $("original"),
  remembered: $<HTMLButtonElement>("save-remembered"),
  archive: $<HTMLButtonElement>("archive"),
  hint: $("save-hint"),
};

let mail: MailInfo | null = null;
let settings: Settings;
let current: State = "loading";
let lastState: State = "loading";
let loadSeq = 0;
let rememberedHandle: FileSystemDirectoryHandle | null = null;

/* ------------------------------------------------------------ helpers */

function show(state: State, errorText?: string) {
  if (state !== "settings") lastState = state;
  current = state;
  for (const [k, el] of Object.entries(sections)) el.hidden = k !== state;
  if (errorText !== undefined) $("error-text").textContent = errorText;
  $("bar-title").textContent = state === "settings" ? "Instellingen" : "Archiveren";
  $("toggle-settings").setAttribute("aria-pressed", String(state === "settings"));
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function parts(): NameParts {
  return { date: formatIsoDate(f.date.value, settings.dateFormat), from: f.from.value, to: f.to.value, title: f.title.value };
}

/** Bestandsnaam zonder extensie. */
function stem(): string {
  return buildFileName(parts(), settings.format, settings.template).replace(/\.[a-z]+$/i, "");
}

function updatePreview() {
  f.preview.textContent = `${stem()}.${settings.format}`;
}

function targetLabel(dirName: string) {
  const sub = settings.subfolder;
  return sub && dirName.toLowerCase() !== sub.toLowerCase() ? `${dirName} › ${sub}` : dirName;
}

function setBusy(text: string | null) {
  const busy = text !== null;
  f.archive.disabled = busy;
  f.remembered.disabled = busy;
  f.archive.textContent = busy ? text! : "Map kiezen en opslaan…";
}

function showWarning(text: string) {
  f.warning.hidden = false;
  f.warning.textContent = text;
}

/* --------------------------------------------------------------- laden */

async function load() {
  const seq = ++loadSeq;
  if (current !== "settings") show("loading");
  try {
    settings = getSettings();
    const m = await readCurrentMail();
    if (seq !== loadSeq) return;
    if (!m) {
      show("error", "Selecteer een e-mail om te archiveren.");
      return;
    }
    mail = m;
    const p = suggestParts(m);
    f.date.value = p.date;
    f.from.value = p.from;
    f.to.value = p.to;
    f.title.value = p.title;
    f.original.textContent = m.subject ? `Origineel onderwerp: ${m.subject}` : "";
    f.warning.hidden = canExport();
    f.warning.textContent = canExport() ? "" : "Let op: deze Outlook-versie kan de mail niet exporteren (Mailbox 1.14 nodig).";
    updatePreview();
    setBusy(null);

    // Eerder gekozen map voor deze afzender of dit domein
    rememberedHandle = null;
    f.remembered.hidden = true;
    const rem = await rememberedFor(m.from.address);
    if (seq !== loadSeq) return;
    if (rem) {
      rememberedHandle = rem.handle;
      f.remembered.innerHTML = `Opslaan in <b>${escapeHtml(targetLabel(rem.handle.name))}</b><br><span class="muted small">${
        rem.byDomain ? "eerder gekozen voor dit domein" : "eerder gekozen voor deze afzender"
      }</span>`;
      f.remembered.hidden = false;
    }
    f.hint.textContent = settings.subfolder
      ? `Het bestand komt in de map '${settings.subfolder}' binnen de map die je kiest, ook als die dieper ligt (bv. Information › ${settings.subfolder}). Is er geen, dan wordt hij aangemaakt.`
      : "Het bestand komt direct in de map die je kiest.";

    if (current !== "settings") show("form");
  } catch (e: any) {
    if (seq === loadSeq) show("error", e?.message ?? String(e));
  }
}

/* ---------------------------------------------------------- opslaan */

async function saveInto(dir: FileSystemDirectoryHandle) {
  if (!mail) return;
  setBusy("Mail ophalen…");
  const eml = await getEml();
  setBusy("Bestand maken…");
  const files = await buildFiles(eml, { format: settings.format, receivedOn: mail.date });
  setBusy("Opslaan…");
  const res = await saveToDirectory(dir, stem(), files, settings.subfolder);
  await remember(mail.from.address, dir);
  await finish(res);
}

async function finish(res: SaveResult) {
  const warnings: string[] = [];
  const catWarn = await addCategory(settings.category);
  if (catWarn) warnings.push(catWarn);
  $("done-sub").textContent = res.folder;
  $("done-files").innerHTML = res.names.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  const w = $("done-warning");
  w.hidden = !warnings.length;
  w.textContent = warnings.join(" ");
  setBusy(null);
  show("done");
}

/** Hoofdknop: Verkenner-venster openen. */
async function pickAndSave(ev?: Event) {
  ev?.preventDefault();
  if (!mail) return;
  f.warning.hidden = canExport();
  let dir: FileSystemDirectoryHandle;
  try {
    if (!pickerAvailable()) throw Object.assign(new Error("geen picker"), { name: "NotSupportedError" });
    dir = await pickDirectory(); // eerst kiezen: moet direct na de klik
  } catch (e: any) {
    if (e?.name === "AbortError") return; // geannuleerd
    // In een iframe (Outlook op het web / nieuwe Outlook) mag het venster niet: los dialoogvenster
    return viaDialog();
  }
  try {
    await saveInto(dir);
  } catch (e: any) {
    setBusy(null);
    showWarning(e?.message ?? String(e));
  }
}

/** Knop met de onthouden map: één klik. */
async function saveRemembered() {
  if (!rememberedHandle) return;
  try {
    const ok = await ensurePermission(rememberedHandle as any);
    if (!ok) return pickAndSave();
    await saveInto(rememberedHandle);
  } catch (e: any) {
    setBusy(null);
    if (e?.name === "NotFoundError") {
      showWarning("De onthouden map bestaat niet meer. Kies een andere map.");
      f.remembered.hidden = true;
    } else showWarning(e?.message ?? String(e));
  }
}

/* ------------------------------------------- terugval: dialoogvenster */

function viaDialog() {
  if (!Office.context.requirements.isSetSupported("DialogApi", "1.2")) return downloadFallback();
  const url = new URL("dialog.html", location.href).href;
  setBusy("Venster openen…");
  Office.context.ui.displayDialogAsync(url, { height: 35, width: 30, displayInIframe: false }, (r) => {
    if (r.status !== Office.AsyncResultStatus.Succeeded) {
      setBusy(null);
      return downloadFallback();
    }
    const dialog = r.value;
    dialog.addEventHandler(Office.EventType.DialogMessageReceived, async (arg: any) => {
      const msg = JSON.parse(arg.message);
      if (msg.type === "ready") {
        try {
          setBusy("Kies de map in het venster…");
          const b64 = toBase64(await getEml());
          const size = 200_000;
          const total = Math.max(1, Math.ceil(b64.length / size));
          dialog.messageChild(
            JSON.stringify({
              type: "meta",
              meta: { stem: stem(), subfolder: settings.subfolder, format: settings.format, receivedOn: mail?.date, total },
            }),
          );
          for (let i = 0; i < total; i++) {
            dialog.messageChild(JSON.stringify({ type: "chunk", i, data: b64.slice(i * size, (i + 1) * size) }));
          }
        } catch (e: any) {
          dialog.close();
          setBusy(null);
          showWarning(e?.message ?? String(e));
        }
      } else if (msg.type === "done") {
        dialog.close();
        await finish(msg.result as SaveResult);
      } else if (msg.type === "error") {
        showWarning(msg.message);
      }
    });
    dialog.addEventHandler(Office.EventType.DialogEventReceived, () => setBusy(null)); // venster gesloten
  });
}

/* ------------------------------------------- laatste terugval: download */

async function downloadFallback() {
  if (!mail) return;
  try {
    setBusy("Bestanden maken…");
    const files = await buildFiles(await getEml(), { format: settings.format, receivedOn: mail.date });
    const names: string[] = [];
    for (const file of files) {
      const name = `${stem()}.${file.ext}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([file.data as Uint8Array<ArrayBuffer>], { type: file.type }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      names.push(name);
    }
    await finish({ folder: "Gedownload (deze Outlook kan geen mapkeuzevenster openen)", names });
  } catch (e: any) {
    setBusy(null);
    showWarning(e?.message ?? String(e));
  }
}

/* ---------------------------------------------------------- instellingen */

const s = {
  dateFmt: $<HTMLSelectElement>("s-datefmt"),
  sub: $<HTMLInputElement>("s-sub"),
  category: $<HTMLInputElement>("s-category"),
  template: $<HTMLInputElement>("s-template"),
};

function openSettings() {
  settings = getSettings();
  s.dateFmt.value = settings.dateFormat;
  s.sub.value = settings.subfolder;
  s.category.value = settings.category;
  s.template.value = settings.template;
  document.querySelectorAll<HTMLInputElement>("input[name=s-format]").forEach((r) => (r.checked = r.value === settings.format));
  show("settings");
}

async function saveSettings(ev: SubmitEvent) {
  ev.preventDefault();
  settings = {
    format: (document.querySelector<HTMLInputElement>("input[name=s-format]:checked")?.value ?? "msg") as Format,
    dateFormat: s.dateFmt.value as DateFormat,
    subfolder: s.sub.value.trim().replace(/[\\/:*?"<>|]/g, ""),
    category: s.category.value.trim(),
    template: s.template.value.trim() || "{date} - {from} - {to} - {title}",
  };
  await setSettings(settings);
  show("loading");
  await load();
}

/* --------------------------------------------------------------- start */

Office.onReady(() => {
  settings = getSettings();
  for (const el of [f.date, f.from, f.to, f.title]) el.addEventListener("input", updatePreview);
  sections.form.addEventListener("submit", (e) => void pickAndSave(e));
  f.remembered.addEventListener("click", () => void saveRemembered());
  $("retry").addEventListener("click", () => void load());
  $("back").addEventListener("click", () => void load());
  $("toggle-settings").addEventListener("click", () => (current === "settings" ? show(lastState) : openSettings()));
  sections.settings.addEventListener("submit", (e) => void saveSettings(e as SubmitEvent));
  $("s-cancel").addEventListener("click", () => show(lastState));

  // Vastgepind paneel: nieuwe mail geselecteerd
  Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, () => void load());
  void load();
});
