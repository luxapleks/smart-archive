/**
 * Terugvaloptie: in sommige Outlook-versies draait het paneel in een iframe waarin
 * het Verkenner-venster geblokkeerd is. Dit dialoogvenster is een los venster
 * waarin dat wel mag. Het paneel stuurt de mail in stukken; hier kiest de
 * gebruiker de map en worden de bestanden geschreven.
 */
import { buildFiles, fromBase64, type BuildOptions } from "./build";
import { pickDirectory, saveToDirectory } from "./fsaccess";

interface Meta extends BuildOptions {
  stem: string;
  subfolder: string;
  total: number;
}

const $ = (id: string) => document.getElementById(id)!;
let meta: Meta | null = null;
let chunks: string[] = [];

function send(msg: object) {
  Office.context.ui.messageParent(JSON.stringify(msg));
}

Office.onReady(() => {
  Office.context.ui.addHandlerAsync(Office.EventType.DialogParentMessageReceived, (arg: any) => {
    const msg = JSON.parse(arg.message);
    if (msg.type === "meta") {
      meta = msg.meta;
      chunks = new Array(meta!.total);
      $("d-name").textContent = `${meta!.stem}.${meta!.format}`;
      $("d-name").hidden = false;
      $("d-sub").textContent = meta!.subfolder || "(geen)";
    } else if (msg.type === "chunk") {
      chunks[msg.i] = msg.data;
      const n = chunks.filter((c) => c !== undefined).length;
      $("d-status").textContent = `Mail ontvangen… ${Math.round((n / (meta?.total || 1)) * 100)}%`;
      if (meta && n === meta.total) {
        $("d-status").textContent = "Klaar om op te slaan.";
        ($("d-pick") as HTMLButtonElement).disabled = false;
      }
    }
  });

  $("d-pick").addEventListener("click", async () => {
    if (!meta) return;
    const btn = $("d-pick") as HTMLButtonElement;
    try {
      const dir = await pickDirectory(); // eerst kiezen: vereist de klik
      btn.disabled = true;
      $("d-status").textContent = "Bestanden maken…";
      const files = await buildFiles(fromBase64(chunks.join("")), meta);
      const res = await saveToDirectory(dir, meta.stem, files, meta.subfolder);
      send({ type: "done", result: res });
    } catch (e: any) {
      if (e?.name === "AbortError") return; // geannuleerd: venster open laten
      btn.disabled = false;
      $("d-status").textContent = e?.message ?? String(e);
      send({ type: "error", message: e?.message ?? String(e) });
    }
  });

  send({ type: "ready" });
});
