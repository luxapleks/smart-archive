import { buildFileName, sanitizeFolderPath, type NameParts } from "./shared/naming";
import { foldersFromRelativeFiles, fullTargetPath, parseFolderList, scoreFolders } from "./shared/folders";
import { suggestParts, type MailInfo } from "./shared/labels";
import { addCategory, canExport, getEml, readCurrentMail } from "./mail";
import { copyText, makeDraggable, triggerDownload } from "./files";
import {
  getBasePath,
  getFolders,
  getSettings,
  rememberFolder,
  senderFolder,
  setFolderConfig,
  setSettings,
  type Format,
  type Settings,
} from "./store";

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
  noFolders: $("no-folders"),
  suggestions: $("suggestions"),
  search: $<HTMLInputElement>("folder-search"),
  results: $<HTMLUListElement>("folder-results"),
  archive: $<HTMLButtonElement>("archive"),
};

interface Option {
  path: string;
  reason: string;
  score?: number;
  custom?: boolean;
}

let mail: MailInfo | null = null;
let settings: Settings;
let options: Option[] = [];
let current: State = "loading";
let lastState: State = "loading";
let loadSeq = 0;
let lastFile: { url: string; name: string; fullPath: string } | null = null;

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

function pathHtml(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? `<b>${escapeHtml(p)}</b>` : `${escapeHtml(p.slice(0, i + 1))}<b>${escapeHtml(p.slice(i + 1))}</b>`;
}

const ext = () => settings.format;

function parts(): NameParts {
  return { date: f.date.value, from: f.from.value, to: f.to.value, title: f.title.value };
}

function fileName() {
  return buildFileName(parts(), ext(), settings.template);
}

function updatePreview() {
  f.preview.textContent = fileName();
}

/* ------------------------------------------------------------- mappen */

function buildOptions(m: MailInfo): Option[] {
  const folders = getFolders();
  if (!folders.length) return [];
  const known = new Set(folders);
  const out: Option[] = [];

  const hist = senderFolder(m.from.address);
  if (hist && known.has(hist.path)) {
    out.push({ path: hist.path, reason: hist.byDomain ? "Eerder gekozen voor dit domein" : "Eerder gekozen voor deze afzender" });
  }
  const scored = scoreFolders(folders, {
    subject: m.subject,
    body: m.body,
    senderDomain: m.from.address?.split("@")[1],
    names: [m.from.name ?? "", ...m.to.map((t) => t.name ?? "")],
  }).filter((s) => s.score > 0);
  for (const s of scored) {
    if (out.length >= 3) break;
    if (out.some((o) => o.path === s.path)) continue;
    out.push({ path: s.path, score: s.score, reason: "Trefwoorden komen overeen" });
  }
  return out;
}

function renderOptions(selected?: string) {
  f.suggestions.innerHTML = "";
  const hasFolders = getFolders().length > 0;
  f.noFolders.hidden = hasFolders || options.length > 0;
  if (!options.length) {
    if (hasFolders) f.suggestions.innerHTML = `<p class="empty">Geen passende map gevonden — zoek hieronder.</p>`;
    return;
  }
  options.forEach((o, i) => {
    const label = document.createElement("label");
    label.className = "option" + (o.custom ? " custom" : "");
    label.innerHTML = `
      <input type="radio" name="folder" value="${i}">
      <span class="path">${pathHtml(o.path)}</span>
      <span class="conf"></span>
      <span class="reason">${escapeHtml(o.reason)}</span>`;
    label.querySelector("input")!.checked = selected ? o.path === selected : i === 0;
    f.suggestions.appendChild(label);
  });
}

function selectedFolder(): string {
  const c = f.suggestions.querySelector<HTMLInputElement>("input[name=folder]:checked");
  return c ? options[Number(c.value)].path : "";
}

function pick(path: string, custom = false) {
  options = [
    { path, reason: custom ? "Zelf getypt pad (map moet bestaan)" : "Zelf gekozen", custom },
    ...options.filter((o) => o.path !== path),
  ];
  renderOptions(path);
  f.search.value = "";
  f.results.hidden = true;
}

function onSearch() {
  const q = f.search.value.trim();
  if (q.length < 2) {
    f.results.hidden = true;
    return;
  }
  const terms = q.toLowerCase().split(/\s+/);
  const hits = getFolders()
    .filter((p) => terms.every((t) => p.toLowerCase().includes(t)))
    .sort((a, b) => a.length - b.length)
    .slice(0, 25);
  const typed = sanitizeFolderPath(q.replace(/\\/g, "/"));
  const items = hits.map((p, i) => `<li role="option" data-i="${i}">${pathHtml(p)}</li>`);
  if (typed && !hits.some((h) => h.toLowerCase() === typed.toLowerCase())) {
    items.push(`<li role="option" data-custom="1">Pad gebruiken: <b>${escapeHtml(typed)}</b></li>`);
  }
  f.results.innerHTML = items.join("");
  f.results.hidden = false;
  f.results.querySelectorAll<HTMLLIElement>("li").forEach((li) =>
    li.addEventListener("click", () => (li.dataset.custom ? pick(typed, true) : pick(hits[Number(li.dataset.i)]))),
  );
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
    options = buildOptions(m);
    renderOptions();
    updatePreview();
    f.archive.disabled = false;
    f.archive.textContent = "Archiveren";
    if (current !== "settings") show("form");
  } catch (e: any) {
    if (seq === loadSeq) show("error", e?.message ?? String(e));
  }
}

/* ---------------------------------------------------------- archiveren */

async function archive(ev: SubmitEvent) {
  ev.preventDefault();
  if (!mail) return;
  const folder = selectedFolder();
  f.archive.disabled = true;
  f.archive.textContent = "Bezig…";
  try {
    const eml = await getEml();
    let data: Uint8Array = eml;
    let mime = "message/rfc822";
    if (settings.format === "msg") {
      f.archive.textContent = "Omzetten naar .msg…";
      // Pas laden als het nodig is: houdt het openen van het paneel snel
      const { emlToMsg } = await import("./shared/mime2msg");
      data = await emlToMsg(eml, { receivedOn: new Date(mail.date) });
      mime = "application/vnd.ms-outlook";
    }
    const name = fileName();
    if (lastFile) URL.revokeObjectURL(lastFile.url);
    const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: mime }));
    const base = getBasePath();
    const full = base ? fullTargetPath(base, folder, name) : name;
    lastFile = { url, name, fullPath: full };

    // Eerst kopiëren (vereist de klik van de gebruiker), dan downloaden
    const copied = settings.copyPath ? await copyText(full) : false;
    triggerDownload(url, name);

    const warnings: string[] = [];
    if (folder) await rememberFolder(mail.from.address, folder);
    const catWarn = await addCategory(settings.category);
    if (catWarn) warnings.push(catWarn);

    showDone(folder, copied, base, mime, warnings);
  } catch (e: any) {
    f.warning.hidden = false;
    f.warning.textContent = e?.message ?? String(e);
  } finally {
    f.archive.disabled = false;
    f.archive.textContent = "Archiveren";
  }
}

function showDone(folder: string, copied: boolean, base: string, mime: string, warnings: string[]) {
  if (!lastFile) return;
  $("file-name").textContent = lastFile.name;
  $("file-ext").textContent = settings.format.toUpperCase();
  $("done-sub").textContent = folder ? `Doelmap: ${folder}` : "Geen map gekozen";
  makeDraggable($("file-chip"), lastFile.url, lastFile.name, mime);

  const step = $("step-save");
  if (copied && base) {
    step.innerHTML =
      "Het volledige pad staat op je klembord. Plak het in het opslagvenster bij <i>Bestandsnaam</i> " +
      "(<kbd>Ctrl</kbd>+<kbd>V</kbd>, <kbd>Enter</kbd>) — het bestand komt dan direct in de juiste map." +
      "<br><span class='muted small'>Geen opslagvenster? Zet in je browser/Outlook <i>Vragen waar elk bestand moet worden opgeslagen</i> aan, of sleep het bestand.</span>";
  } else if (!base) {
    step.innerHTML = "Het bestand is gedownload. Stel in de instellingen een basispad in, dan zet de add-in het volledige pad klaar op je klembord.";
  } else {
    step.innerHTML = "Het bestand is gedownload. Kopieer het pad hieronder en plak het in het opslagvenster.";
  }
  $("done-path").textContent = lastFile.fullPath;
  $("done-path").hidden = !base;
  const w = $("done-warning");
  w.hidden = !warnings.length;
  w.textContent = warnings.join(" ");
  show("done");
}

/* ---------------------------------------------------------- instellingen */

const s = {
  base: $<HTMLInputElement>("s-base"),
  folders: $<HTMLTextAreaElement>("s-folders"),
  count: $("s-count"),
  copy: $<HTMLInputElement>("s-copy"),
  category: $<HTMLInputElement>("s-category"),
  template: $<HTMLInputElement>("s-template"),
};

function psCommand(base: string) {
  const path = base || "C:\\Users\\<naam>\\Baker Tilly\\<site> - Documenten";
  return (
    `Get-ChildItem -LiteralPath "${path.replace(/\//g, "\\")}" -Directory -Recurse -Depth 4 |\n` +
    `  Select-Object -ExpandProperty FullName |\n` +
    `  Out-File "$env:USERPROFILE\\Desktop\\mappen.txt" -Encoding utf8`
  );
}

function updateCount() {
  const n = s.folders.value.split(/\r?\n/).filter((l) => l.trim()).length;
  s.count.textContent = n ? `${n}` : "";
}

function openSettings() {
  settings = getSettings();
  s.base.value = getBasePath().replace(/\//g, "\\");
  s.folders.value = getFolders().join("\n");
  s.copy.checked = settings.copyPath;
  s.category.value = settings.category;
  s.template.value = settings.template;
  document.querySelectorAll<HTMLInputElement>("input[name=s-format]").forEach((r) => (r.checked = r.value === settings.format));
  $("ps-cmd").textContent = psCommand(s.base.value);
  updateCount();
  show("settings");
}

function absorbList(text: string) {
  const parsed = parseFolderList(text, s.base.value);
  if (!s.base.value && parsed.base) s.base.value = parsed.base.replace(/\//g, "\\");
  s.folders.value = parsed.folders.join("\n");
  $("ps-cmd").textContent = psCommand(s.base.value);
  updateCount();
}

async function saveSettings(ev: SubmitEvent) {
  ev.preventDefault();
  const format = (document.querySelector<HTMLInputElement>("input[name=s-format]:checked")?.value ?? "msg") as Format;
  settings = {
    format,
    copyPath: s.copy.checked,
    category: s.category.value.trim(),
    template: s.template.value.trim() || "{date} - {from} - {to} - {title}",
  };
  // Geplakte absolute paden worden relatief gemaakt t.o.v. het basispad
  const parsed = parseFolderList(s.folders.value, s.base.value.trim());
  const base = (s.base.value.trim() || parsed.base).replace(/\\/g, "/");
  await Promise.all([setSettings(settings), setFolderConfig(base, parsed.folders)]);
  show("loading");
  await load();
}

/* --------------------------------------------------------------- start */

Office.onReady(() => {
  settings = getSettings();
  for (const el of [f.date, f.from, f.to, f.title]) el.addEventListener("input", updatePreview);
  f.search.addEventListener("input", onSearch);
  sections.form.addEventListener("submit", (e) => void archive(e as SubmitEvent));
  $("retry").addEventListener("click", () => void load());
  $("open-settings").addEventListener("click", (e) => {
    e.preventDefault();
    openSettings();
  });
  $("toggle-settings").addEventListener("click", () => (current === "settings" ? show(lastState) : openSettings()));

  // klaar-scherm
  $("again").addEventListener("click", () => lastFile && triggerDownload(lastFile.url, lastFile.name));
  $("copy-path").addEventListener("click", async () => {
    if (!lastFile) return;
    const ok = await copyText(lastFile.fullPath);
    $("copy-path").textContent = ok ? "Gekopieerd ✓" : "Kopiëren mislukt";
    setTimeout(() => ($("copy-path").textContent = "Pad kopiëren"), 2000);
  });

  // instellingen
  sections.settings.addEventListener("submit", (e) => void saveSettings(e as SubmitEvent));
  $("s-cancel").addEventListener("click", () => show(lastState));
  s.folders.addEventListener("input", updateCount);
  s.base.addEventListener("input", () => ($("ps-cmd").textContent = psCommand(s.base.value)));
  $("copy-ps").addEventListener("click", () => void copyText($("ps-cmd").textContent ?? ""));
  $("s-import").addEventListener("click", () => $("s-import-file").click());
  $<HTMLInputElement>("s-import-file").addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) absorbList(await file.text());
  });
  $("s-pick").addEventListener("click", () => $("s-pick-dir").click());
  $<HTMLInputElement>("s-pick-dir").addEventListener("change", (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    const parsed = foldersFromRelativeFiles(files.map((x) => (x as any).webkitRelativePath as string));
    s.folders.value = parsed.folders.join("\n");
    updateCount();
  });

  // Vastgepind paneel: nieuwe mail geselecteerd
  Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, () => void load());
  void load();
});
