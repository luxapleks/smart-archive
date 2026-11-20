/** Instellingen, opgeslagen in Outlook roamingSettings (reist mee met je mailbox). */
export type Format = "msg" | "eml";

export interface Settings {
  format: Format;
  pdf: boolean;
  subfolder: string;
  template: string;
  category: string;
}

export const DEFAULTS: Settings = {
  format: "msg",
  pdf: true,
  subfolder: "Inbound",
  template: "{date} - {from} - {to} - {title}",
  category: "Gearchiveerd",
};

export function getSettings(): Settings {
  return { ...DEFAULTS, ...((Office.context.roamingSettings.get("settings") as Partial<Settings>) ?? {}) };
}

export function setSettings(s: Settings): Promise<void> {
  Office.context.roamingSettings.set("settings", s);
  return new Promise((resolve) => Office.context.roamingSettings.saveAsync(() => resolve()));
}
