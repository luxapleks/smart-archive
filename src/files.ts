/** Bestand aanbieden: downloaden, naar Verkenner slepen, pad kopiëren. */

export function triggerDownload(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Slepen naar Verkenner/bureaublad (Chromium/Edge: DownloadURL-formaat).
 * In andere omgevingen doet slepen niets; downloaden blijft dan de route.
 */
export function makeDraggable(el: HTMLElement, url: string, fileName: string, mime: string) {
  el.draggable = true;
  el.ondragstart = (e) => {
    const absolute = new URL(url, location.href).href;
    e.dataTransfer?.setData("DownloadURL", `${mime}:${fileName}:${absolute}`);
    e.dataTransfer?.setData("text/plain", fileName);
  };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Terugval voor iframes zonder clipboard-write-recht
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
