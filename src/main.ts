import { buildFileName, DEFAULT_TEMPLATE, formatIsoDate, type NameParts } from "./shared/naming";
import { suggestParts, type MailInfo } from "./shared/labels";
import { attachmentFileName } from "./shared/attachments";
import { scoreFolders } from "./shared/score";
import { addCategory, canExport, getEml, readCurrentMail } from "./mail";
import { buildAttachments, buildFiles, toBase64 } from "./build";
import {
  ensurePermission,
  getFavorites,
  getRoot,
  hasPermission,
  listFolders,
  pickDirectory,
  pickerAvailable,
  rememberPath,
  rememberedPath,
  saveToDirectory,
  setFavorites,
  setRoot,
  type Favorite,
  type FolderEntry,
  type SaveResult,
} from "./fsaccess";
import { getSettings, setSettings, type DateFormat, type Format, type Settings } from "./store";
import { buildReminderIcs, firstOccurrence, PRESETS, REMINDER_SUBJECT, type ReminderKind } from "./shared/ics";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type State = "loading" | "error" | "form" | "done" | "settings" | "welcome";
const sections: Record<State, HTMLElement> = {
  loading: $("state-loading"),
  error: $("state-error"),
  form: $("state-form"),
  done: $("state-done"),
  settings: $("state-settings"),
  welcome: $("state-welcome"),
};

const f = {
  warning: $("warning"),
  date: $<HTMLInputElement>("f-date"),
  from: $<HTMLInputElement>("f-from"),
  to: $<HTMLInputElement>("f-to"),
  title: $<HTMLInputElement>("f-title"),
  preview: $("preview"),
  original: $("original"),
  direction: $("direction"),
  rootMissing: $("root-missing"),
  rootLocked: $("root-locked"),
  unlock: $<HTMLButtonElement>("unlock-root"),
  folderArea: $("folder-area"),
  suggestions: $("suggestions"),
  search: $<HTMLInputElement>("folder-search"),
  results: $<HTMLUListElement>("folder-results"),
  archive: $<HTMLButtonElement>("archive"),
  pickOther: $<HTMLButtonElement>("pick-other"),
  addFav: $<HTMLButtonElement>("add-fav"),
  hint: $("save-hint"),
};

interface Option {
  /** "p:<pad>" voor een klantmap in de archiefmap, "f:<id>" voor een losse favoriet */
  key: string;
  label: string;
  reason: string;
  path?: string;
  fav?: Favorite;
}

let mail: MailInfo | null = null;
let settings: Settings;
let current: State = "loading";
let lastState: State = "loading";
let loadSeq = 0;
let busy = false;

let root: FileSystemDirectoryHandle | null = null;
let folders: FolderEntry[] | null = null; // klantmappen, één keer per sessie ingelezen
let options: Option[] = [];
let favorites: Favorite[] = [];

/* ------------------------------------------------------------ helpers */

function show(state: State, errorText?: string) {
  if (state !== "settings" && state !== "welcome") lastState = state;
  current = state;
  for (const [k, el] of Object.entries(sections)) el.hidden = k !== state;
  if (state === "done" || state === "settings" || state === "welcome") window.scrollTo(0, 0);
  if (errorText !== undefined) $("error-text").textContent = errorText;
  $("bar-title").textContent = state === "settings" ? "Instellingen" : state === "welcome" ? "Herinnering" : "Archiveren";
  $("toggle-settings").setAttribute("aria-pressed", String(state === "settings"));
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function pathHtml(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? `<b>${escapeHtml(p)}</b>` : `${escapeHtml(p.slice(0, i + 1))}<b>${escapeHtml(p.slice(i + 1))}</b>`;
}

function parts(): NameParts {
  return { date: formatIsoDate(f.date.value, settings.dateFormat), from: f.from.value, to: f.to.value, title: f.title.value };
}

function sentByMe(): boolean {
  return !!mail && mail.from.address?.toLowerCase() === mail.me.toLowerCase();
}

/** De andere partij: afzender bij ontvangen mail, eerste externe ontvanger bij verzonden mail. */
function counterpart() {
  if (!mail) return undefined;
  return sentByMe() ? mail.to.find((t) => t.address?.toLowerCase() !== mail!.me.toLowerCase()) ?? mail.to[0] : mail.from;
}

/** Inbound bij ontvangen mail, Outbound als jij de afzender bent. */
function subfolder(): string {
  return sentByMe() ? settings.subfolderOut : settings.subfolder;
}

function buildOptions() {
  return {
    format: settings.format,
    receivedOn: mail?.date,
    attachmentDate: settings.saveAttachments ? formatIsoDate(f.date.value, settings.dateFormat) : "",
  };
}

/** Bestandsnaam zonder extensie. */
function stem(): string {
  return buildFileName(parts(), settings.format, settings.template).replace(/\.[a-z]+$/i, "");
}

function updatePreview() {
  f.preview.textContent = `${stem()}.${settings.format}`;
  const list = $("attachments-preview");
  const atts = settings.saveAttachments ? attachmentNames() : [];
  list.hidden = !atts.length;
  list.innerHTML = atts.length ? `<b>Bijlagen (${atts.length})</b>` + atts.map((n) => `<div>${escapeHtml(n)}</div>`).join("") : "";
}

/** Voorbeeldnamen van de bijlagen volgens Outlook (handtekeningplaatjes niet meegeteld). */
function attachmentNames(): string[] {
  const date = formatIsoDate(f.date.value, settings.dateFormat);
  return (mail?.attachments ?? []).map((a, i) => attachmentFileName(date, i + 1, a));
}

function setBusy(text: string | null) {
  busy = text !== null;
  const panelMode = !!root || favorites.length > 0;
  f.archive.disabled = busy || (panelMode && !selectedOption());
  f.pickOther.disabled = busy;
  f.unlock.disabled = busy;
  f.archive.textContent = busy ? text! : panelMode ? "Opslaan" : "Map kiezen en opslaan…";
}

function showWarning(text: string) {
  f.warning.hidden = false;
  f.warning.textContent = text;
}

function updateHint() {
  const sub = subfolder();
  const where = root ? "de klantmap" : "de map die je kiest";
  f.hint.textContent = sub
    ? `Komt in '${sub}' binnen ${where}, ook als die dieper ligt (bv. Information › ${sub}). Is er geen, dan wordt hij aangemaakt.`
    : `Komt direct in ${where}.`;
  f.direction.textContent = sentByMe() ? `verzonden → ${settings.subfolderOut || "klantmap"}` : `ontvangen → ${settings.subfolder || "klantmap"}`;
}

/* ------------------------------------------------------ klantmappen */

function renderRootState() {
  f.rootMissing.hidden = !!root || !pickerAvailable();
  f.rootLocked.hidden = !root || folders !== null;
  f.folderArea.hidden = !((root && folders !== null) || favorites.length);
  f.search.parentElement!.hidden = !(root && folders !== null);
  f.addFav.hidden = !pickerAvailable();
  f.pickOther.hidden = !pickerAvailable() || !(root || favorites.length);
  if (root) f.unlock.innerHTML = `Klantmappen in <b>${escapeHtml(root.name)}</b> openen`;
  setBusy(busy ? f.archive.textContent : null);
}

/** Klantmappen inlezen (vereist toestemming; vraagt die zo nodig met één melding). */
async function openRoot(ask: boolean): Promise<boolean> {
  if (!root) return false;
  if (!(await hasPermission(root as any))) {
    if (!ask || !(await ensurePermission(root as any))) return false;
  }
  if (!folders) {
    f.unlock.textContent = "Mappen inlezen…";
    folders = await listFolders(root, settings.folderDepth);
  }
  return true;
}

const favKey = (fav: Favorite) => (fav.path !== undefined ? `p:${fav.path}` : `f:${fav.id}`);
const isFav = (path: string) => favorites.some((x) => x.path === path);

async function buildFolderOptions() {
  if (!mail) return;
  const out: Option[] = [];
  const add = (o: Option) => {
    if (!out.some((x) => x.key === o.key)) out.push(o);
  };
  const known = new Set((folders ?? []).map((x) => x.path));
  const other = counterpart();
  const rem = await rememberedPath(other?.address);
  const remReason = rem?.byDomain ? "Eerder gekozen voor dit domein" : "Eerder gekozen voor deze contactpersoon";

  // Voorstellen: eerdere keuze + trefwoorden (alleen als de klantmappen ingelezen zijn)
  const sugg: Option[] = [];
  if (rem) {
    if (rem.path.startsWith("fav:")) {
      const fav = favorites.find((x) => `fav:${x.id}` === rem.path);
      if (fav) sugg.push({ key: favKey(fav), label: fav.label, reason: remReason, fav, path: fav.path });
    } else if (known.has(rem.path)) sugg.push({ key: `p:${rem.path}`, label: rem.path, reason: remReason, path: rem.path });
  }
  if (folders) {
    const scored = scoreFolders([...known], {
      subject: mail.subject,
      body: mail.body,
      senderDomain: other?.address?.split("@")[1],
      names: [other?.name ?? "", ...mail.to.map((t) => t.name ?? "")],
    }).filter((x) => x.score > 0);
    for (const sc of scored) {
      if (sugg.length >= 3) break;
      if (!sugg.some((o) => o.path === sc.path)) sugg.push({ key: `p:${sc.path}`, label: sc.path, reason: "Naam komt overeen met de mail", path: sc.path });
    }
  }
  sugg.forEach(add);
  // Favorieten daarna (zonder dubbelingen)
  for (const fav of favorites) {
    add({ key: favKey(fav), label: fav.label, reason: fav.handle ? "Favoriet (buiten archiefmap)" : "Favoriet", fav, path: fav.path });
  }
  options = out;
  renderOptions();
}

function renderOptions(selectedKey?: string) {
  f.suggestions.innerHTML = "";
  if (!options.length) {
    if (folders) f.suggestions.innerHTML = `<p class="empty">Geen voorstel — zoek de klantmap hieronder.</p>`;
    setBusy(null);
    return;
  }
  let lastGroup = "";
  options.forEach((o, i) => {
    const group = o.reason.startsWith("Favoriet") ? "Favorieten" : "Voorstellen";
    if (group !== lastGroup) {
      const h = document.createElement("p");
      h.className = "group-title";
      h.textContent = group;
      f.suggestions.appendChild(h);
      lastGroup = group;
    }
    const starred = o.fav !== undefined || (o.path !== undefined && isFav(o.path));
    const label = document.createElement("label");
    label.className = "option";
    label.innerHTML = `
      <input type="radio" name="folder" value="${i}">
      <span class="path">${pathHtml(o.label)}</span>
      <button type="button" class="star${starred ? " on" : ""}" title="${starred ? "Uit favorieten halen" : "Aan favorieten toevoegen"}">${starred ? "★" : "☆"}</button>
      <span class="reason">${escapeHtml(o.reason)}</span>`;
    const input = label.querySelector("input")!;
    input.checked = selectedKey ? o.key === selectedKey : i === 0;
    input.addEventListener("change", () => setBusy(null));
    label.querySelector<HTMLButtonElement>(".star")!.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void toggleFavorite(o);
    });
    f.suggestions.appendChild(label);
  });
  setBusy(null);
}

function selectedOption(): Option | undefined {
  const c = f.suggestions.querySelector<HTMLInputElement>("input[name=folder]:checked");
  return c ? options[Number(c.value)] : undefined;
}

async function toggleFavorite(o: Option) {
  const keep = selectedOption()?.key;
  if (o.fav) favorites = favorites.filter((x) => x.id !== o.fav!.id);
  else if (o.path !== undefined && isFav(o.path)) favorites = favorites.filter((x) => x.path !== o.path);
  else if (o.path !== undefined) favorites = [...favorites, { id: crypto.randomUUID(), label: o.path, path: o.path }];
  favorites.sort((a, b) => a.label.localeCompare(b.label, "nl"));
  await setFavorites(favorites);
  await buildFolderOptions();
  if (keep && options.some((x) => x.key === keep)) renderOptions(keep);
  renderRootState();
}

/** Map buiten de archiefmap als favoriet toevoegen (Verkenner-venster). */
async function addOutsideFavorite() {
  try {
    const h = await pickDirectory();
    const fav: Favorite = { id: crypto.randomUUID(), label: h.name, handle: h };
    favorites = [...favorites, fav].sort((a, b) => a.label.localeCompare(b.label, "nl"));
    await setFavorites(favorites);
    await buildFolderOptions();
    renderOptions(favKey(fav));
    renderRootState();
  } catch (e: any) {
    if (e?.name !== "AbortError") showWarning(e?.message ?? String(e));
  }
}

function pick(path: string) {
  const o: Option = { key: `p:${path}`, label: path, reason: "Zelf gekozen", path };
  options = [o, ...options.filter((x) => x.key !== o.key)];
  renderOptions(o.key);
  f.search.value = "";
  f.results.hidden = true;
}

function onSearch() {
  const q = f.search.value.trim().toLowerCase();
  if (q.length < 2 || !folders) {
    f.results.hidden = true;
    return;
  }
  const terms = q.split(/\s+/);
  const hits = folders
    .map((x) => x.path)
    .filter((p) => terms.every((t) => p.toLowerCase().includes(t)))
    .sort((a, b) => a.length - b.length)
    .slice(0, 30);
  f.results.innerHTML = hits.length
    ? hits
        .map((p, i) => `<li role="option" data-i="${i}"><span>${pathHtml(p)}</span><button type="button" class="star${isFav(p) ? " on" : ""}" data-star="${i}" title="Favoriet">${isFav(p) ? "★" : "☆"}</button></li>`)
        .join("")
    : `<li aria-disabled="true">Geen klantmap gevonden</li>`;
  f.results.hidden = false;
  f.results.querySelectorAll<HTMLLIElement>("li[data-i]").forEach((li) => li.addEventListener("click", () => pick(hits[Number(li.dataset.i)])));
  f.results.querySelectorAll<HTMLButtonElement>("button[data-star]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const p = hits[Number(b.dataset.star)];
      await toggleFavorite({ key: `p:${p}`, label: p, reason: "", path: p });
      onSearch();
    }),
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
    updatePreview();
    updateHint();

    root ??= (await getRoot()) ?? null;
    favorites = await getFavorites();
    if (seq !== loadSeq) return;
    options = [];
    f.suggestions.innerHTML = "";
    // Al toestemming (eerder deze sessie)? Dan direct de mappen tonen, zonder melding
    if (root && folders === null) await openRoot(false).catch(() => false);
    if (seq !== loadSeq) return;
    await buildFolderOptions();
    renderRootState();

    if (current !== "settings") show("form");
  } catch (e: any) {
    if (seq === loadSeq) show("error", e?.message ?? String(e));
  }
}

/* ---------------------------------------------------------- opslaan */

async function saveInto(dir: FileSystemDirectoryHandle, relPath?: string, favId?: string) {
  if (!mail) return;
  setBusy("Mail ophalen…");
  const eml = await getEml();
  setBusy("Bestand maken…");
  const opts = buildOptions();
  const files = await buildFiles(eml, opts);
  const extras = await buildAttachments(eml, opts);
  setBusy(extras.length ? `Opslaan (mail + ${extras.length} bijlage${extras.length > 1 ? "n" : ""})…` : "Opslaan…");
  const res = await saveToDirectory(dir, stem(), files, subfolder(), extras);
  if (favId) await rememberPath(counterpart()?.address, `fav:${favId}`);
  if (relPath !== undefined && root) {
    await rememberPath(counterpart()?.address, relPath);
    // "Prospects\ACME\Information\Inbound" i.p.v. alleen "ACME\Information\Inbound"
    res.folder = [root.name, ...relPath.split("/"), ...res.folder.split("\\").slice(1)].join("\\");
  }
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
  celebrate();
}

/* ------------------------------------------------------- een klein feestje */

const QUIPS = [
  "Keurig gearchiveerd. Zo zie ik het graag!",
  "Dossier op orde. Ingerukt, mars!",
  "Inbox −1. Missie geslaagd.",
  "Weer een mail in het gelid.",
  "Orde en discipline. Uitstekend!",
  "Rapport: bestand veilig opgeborgen.",
  "Daar kan de auditor niks op aanmerken.",
  "Netjes. Uw toekomstige zelf salueert mee.",
  "Geen mail blijft achter!",
  "Volgende mail. Voorwaarts!",
]

function celebrate() {
  // Teller (reist mee met je mailbox)
  const rs = Office.context.roamingSettings;
  const count = ((rs.get("archivedCount") as number) ?? 0) + 1;
  rs.set("archivedCount", count);
  rs.saveAsync(() => undefined);

  const milestone = count % 100 === 0 || count === 10 || count === 25 || count === 50;
  $("done-title").textContent = milestone ? `Medaille! Mail nr. ${count}` : `Opgeslagen! (#${count})`;
  $("done-quip").textContent = milestone
    ? "Voor buitengewone archiefdiscipline. Haal maar een koffie, dat heb je verdiend. ☕"
    : QUIPS[Math.floor(Math.random() * QUIPS.length)];

  // Animatie opnieuw starten
  const box = $("celebrate");
  box.classList.remove("go", "big");
  void box.offsetWidth; // reflow, zodat de animatie opnieuw speelt
  box.classList.add("go");
  if (milestone) box.classList.add("big");

  // Confetti: een handvol snippers, bij een mijlpaal wat meer
  const conf = $("confetti");
  conf.innerHTML = "";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#00b7b3", "#d1ec51", "#2b303a", "#62d4d0", "#36678e"]; // Baker Tilly-palet
  if (!milestone) return; // gewone keer: alleen saluut, confetti bewaren voor mijlpalen
  const n = 46;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = (milestone ? 70 : 45) + Math.random() * (milestone ? 70 : 35);
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist - 20}px`);
    p.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    p.style.setProperty("--delay", `${1.05 + Math.random() * 0.12}s`);
    p.style.background = colors[i % colors.length];
    if (i % 3 === 0) p.style.borderRadius = "50%";
    conf.appendChild(p);
  }
}

/** Hoofdknop: opslaan in de gekozen klantmap/favoriet, of (zonder archiefmap) via Verkenner. */
async function onSave(ev?: Event) {
  ev?.preventDefault();
  if (!mail) return;
  f.warning.hidden = canExport();
  const opt = selectedOption();
  if (!root && !favorites.length) return pickAndSave();
  if (!opt) {
    showWarning("Kies eerst een klantmap.");
    return;
  }
  try {
    // Losse favoriet buiten de archiefmap: eigen toestemming
    if (opt.fav?.handle) {
      if (!(await ensurePermission(opt.fav.handle as any))) {
        showWarning("Geen toestemming voor die map.");
        return;
      }
      await saveInto(opt.fav.handle, undefined, opt.fav.id);
      return;
    }
    if (!(await openRoot(true))) {
      showWarning("Geen toestemming voor de archiefmap.");
      return;
    }
    const entry = folders?.find((x) => x.path === opt.path);
    if (!entry) {
      await buildFolderOptions();
      renderRootState();
      showWarning(`Map '${opt.label}' niet gevonden in ${root?.name ?? "de archiefmap"}. Kies opnieuw.`);
      return;
    }
    await saveInto(entry.handle, entry.path);
  } catch (e: any) {
    setBusy(null);
    if (e?.name === "NotFoundError") {
      folders = null; // map verplaatst/verwijderd: opnieuw inlezen
      showWarning("Die map bestaat niet meer. De lijst is opnieuw ingelezen; kies opnieuw.");
      await openRoot(false).catch(() => false);
      await buildFolderOptions();
      renderRootState();
    } else showWarning(e?.message ?? String(e));
  }
}

/** Verkenner-venster (zonder archiefmap, of 'Andere map kiezen'). */
async function pickAndSave() {
  let dir: FileSystemDirectoryHandle;
  try {
    if (!pickerAvailable()) throw Object.assign(new Error("geen picker"), { name: "NotSupportedError" });
    dir = await pickDirectory();
  } catch (e: any) {
    if (e?.name === "AbortError") return;
    return viaDialog();
  }
  try {
    await saveInto(dir);
  } catch (e: any) {
    setBusy(null);
    showWarning(e?.message ?? String(e));
  }
}

async function chooseRoot(): Promise<boolean> {
  try {
    const h = await pickDirectory();
    await setRoot(h);
    root = h;
    folders = null;
    await openRoot(true);
    await buildFolderOptions();
    renderRootState();
    updateHint();
    return true;
  } catch (e: any) {
    if (e?.name !== "AbortError") showWarning(e?.message ?? String(e));
    return false;
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
          dialog.messageChild(JSON.stringify({ type: "meta", meta: { stem: stem(), subfolder: subfolder(), ...buildOptions(), total } }));
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
    dialog.addEventHandler(Office.EventType.DialogEventReceived, () => setBusy(null));
  });
}

async function downloadFallback() {
  if (!mail) return;
  try {
    setBusy("Bestanden maken…");
    const eml = await getEml();
    const files = (await buildFiles(eml, buildOptions())).map((x) => ({ ...x, name: `${stem()}.${x.ext}` }));
    const all = [...files, ...(await buildAttachments(eml, buildOptions()))];
    for (const file of all) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([file.data as Uint8Array<ArrayBuffer>], { type: file.type }));
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    await finish({ folder: "Gedownload (deze Outlook kan geen mapkeuzevenster openen)", names: all.map((x) => x.name) });
  } catch (e: any) {
    setBusy(null);
    showWarning(e?.message ?? String(e));
  }
}

/* ---------------------------------------------------------- instellingen */

const s = {
  root: $("s-root"),
  depth: $<HTMLSelectElement>("s-depth"),
  dateFmt: $<HTMLSelectElement>("s-datefmt"),
  atts: $<HTMLInputElement>("s-atts"),
  sub: $<HTMLInputElement>("s-sub"),
  subOut: $<HTMLInputElement>("s-sub-out"),
  category: $<HTMLInputElement>("s-category"),
  template: $<HTMLInputElement>("s-template"),
};

function openSettings() {
  settings = getSettings();
  s.root.textContent = root ? root.name : "Nog niet gekozen";
  s.depth.value = String(settings.folderDepth);
  s.dateFmt.value = settings.dateFormat;
  s.atts.checked = settings.saveAttachments;
  s.sub.value = settings.subfolder;
  s.subOut.value = settings.subfolderOut;
  s.category.value = settings.category;
  s.template.value = settings.template;
  document.querySelectorAll<HTMLInputElement>("input[name=s-format]").forEach((r) => (r.checked = r.value === settings.format));
  show("settings");
}

async function saveSettings(ev: SubmitEvent) {
  ev.preventDefault();
  const clean = (v: string) => v.trim().replace(/[\\/:*?"<>|]/g, "");
  const depth = Number(s.depth.value) || 1;
  if (depth !== settings.folderDepth) folders = null;
  settings = {
    format: (document.querySelector<HTMLInputElement>("input[name=s-format]:checked")?.value ?? "msg") as Format,
    dateFormat: s.dateFmt.value as DateFormat,
    saveAttachments: s.atts.checked,
    subfolder: clean(s.sub.value),
    subfolderOut: clean(s.subOut.value),
    folderDepth: depth,
    category: s.category.value.trim(),
    template: s.template.value.trim() || DEFAULT_TEMPLATE,
  };
  await setSettings(settings);
  show("loading");
  await load();
}

/* ---------------------------------------------- welkom / herinnering */

let welcomeFromSettings = false;

function openWelcome(fromSettings: boolean) {
  welcomeFromSettings = fromSettings;
  $("welcome-title").textContent = fromSettings ? "Herinnering instellen" : "Welkom bij Smart archive!";
  // Captain Quality, salueert al (zonder animatie)
  const holder = $("welcome-captain");
  if (!holder.firstChild) {
    const svg = document.querySelector(".captain")!.cloneNode(true) as SVGElement;
    svg.classList.add("posed");
    holder.appendChild(svg);
  }
  const opts = $("rem-options");
  opts.innerHTML =
    PRESETS.map(
      (p, i) => `<label class="check"><input type="radio" name="rem" value="${p.kind}" ${i === 0 ? "checked" : ""} />
        <span>${escapeHtml(p.label)}${i === 0 ? " (aanbevolen)" : ""}<br><small>${escapeHtml(p.hint)} · ${p.time}</small></span></label>`,
    ).join("") + `<label class="check"><input type="radio" name="rem" value="none" /><span>Nee, liever niet</span></label>`;
  const time = $<HTMLInputElement>("rem-time");
  time.value = PRESETS[0].time;
  opts.querySelectorAll<HTMLInputElement>("input[name=rem]").forEach((r) =>
    r.addEventListener("change", () => {
      const p = PRESETS.find((x) => x.kind === r.value);
      if (p) time.value = p.time;
      $("rem-time-label").hidden = r.value === "none";
      $("rem-ok").textContent = r.value === "none" ? "Opslaan" : "Herinnering toevoegen";
    }),
  );
  $("rem-time-label").hidden = false;
  $("rem-ok").textContent = "Herinnering toevoegen";
  $("rem-skip").textContent = fromSettings ? "Annuleren" : "Nee, bedankt";
  $("rem-form").hidden = false;
  $("rem-after").hidden = true;
  show("welcome");
}

async function markOnboarded() {
  const rs = Office.context.roamingSettings;
  if (rs.get("onboarded")) return;
  rs.set("onboarded", true);
  await new Promise<void>((r) => rs.saveAsync(() => r()));
}

function reminderChoice(): { kind: ReminderKind | "none"; time: string } {
  const kind = (document.querySelector<HTMLInputElement>("input[name=rem]:checked")?.value ?? "none") as ReminderKind | "none";
  return { kind, time: $<HTMLInputElement>("rem-time").value || "15:30" };
}

async function addReminder() {
  const { kind, time } = reminderChoice();
  await markOnboarded();
  if (kind === "none") return leaveWelcome();
  const ics = buildReminderIcs(kind, time);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = "Archiefherinnering.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  const rs = Office.context.roamingSettings;
  rs.set("reminder", { kind, time });
  rs.saveAsync(() => undefined);
  $("rem-form").hidden = true;
  $("rem-after").hidden = false;
}

/** Terugval: nieuw afspraakformulier openen (terugkeerpatroon zet de gebruiker zelf). */
function manualReminder() {
  const { kind, time } = reminderChoice();
  if (kind === "none") return;
  const start = firstOccurrence(kind, time, new Date());
  Office.context.mailbox.displayNewAppointmentForm({
    subject: REMINDER_SUBJECT,
    start,
    end: new Date(start.getTime() + 15 * 60_000),
    body: "Tijd om je mail op te ruimen! Open een mail in Outlook en klik op 'Slim archiveren'.",
    requiredAttendees: [],
    optionalAttendees: [],
    location: "",
    resources: [],
  } as any);
}

function leaveWelcome() {
  if (welcomeFromSettings) openSettings();
  else void load();
}

/* --------------------------------------------------------------- start */

Office.onReady(() => {
  settings = getSettings();
  for (const el of [f.date, f.from, f.to, f.title]) el.addEventListener("input", updatePreview);
  f.search.addEventListener("input", onSearch);
  sections.form.addEventListener("submit", (e) => void onSave(e));
  f.pickOther.addEventListener("click", () => void pickAndSave());
  f.addFav.addEventListener("click", () => void addOutsideFavorite());
  $("choose-root").addEventListener("click", () => void chooseRoot());
  f.unlock.addEventListener("click", async () => {
    try {
      if (await openRoot(true)) await buildFolderOptions();
      else showWarning("Geen toestemming gekregen. Probeer opnieuw.");
    } catch (e: any) {
      showWarning(e?.message ?? String(e));
    } finally {
      renderRootState();
    }
  });
  $("retry").addEventListener("click", () => void load());
  $("back").addEventListener("click", () => void load());
  $("toggle-settings").addEventListener("click", () => (current === "settings" ? show(lastState) : openSettings()));
  sections.settings.addEventListener("submit", (e) => void saveSettings(e as SubmitEvent));
  $("s-cancel").addEventListener("click", () => show(lastState));
  $("s-choose-root").addEventListener("click", async () => {
    if (await chooseRoot()) s.root.textContent = root!.name;
  });

  // herinnering
  $("rem-ok").addEventListener("click", () => void addReminder());
  $("rem-skip").addEventListener("click", async () => {
    await markOnboarded();
    leaveWelcome();
  });
  $("rem-manual").addEventListener("click", manualReminder);
  $("rem-done").addEventListener("click", leaveWelcome);
  $("s-reminder").addEventListener("click", () => openWelcome(true));

  Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, () => {
    if (current !== "welcome") void load();
  });
  // Eerste keer: eerst vragen of je herinnerd wilt worden
  if (!Office.context.roamingSettings.get("onboarded")) openWelcome(false);
  else void load();
});
