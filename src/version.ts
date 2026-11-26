declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/**
 * Outlook/GitHub Pages kunnen het paneel tot ~10 minuten uit de cache laden.
 * Is er een nieuwere versie online, dan laden we het paneel één keer opnieuw
 * met een andere URL, zodat altijd de nieuwste versie draait.
 */
export async function ensureLatest(): Promise<void> {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const { v } = (await res.json()) as { v: string };
    const url = new URL(location.href);
    if (v && v !== APP_VERSION && url.searchParams.get("v") !== v) {
      url.searchParams.set("v", v);
      location.replace(url.href);
    }
  } catch {
    /* offline of geblokkeerd: gewoon doorgaan */
  }
}
