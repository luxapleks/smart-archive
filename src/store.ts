/** Instellingen, opgeslagen in Outlook roamingSettings (reist mee met je mailbox). */
export type Format = "msg" | "eml";
export type DateFormat = "jjmmdd" | "jj-mm-dd" | "jj mm dd" | "jjjj-mm-dd";

export interface Settings {
  format: Format;
  dateFormat: DateFormat;
  subfolder: string;
  template: string;
  category: string;
}

export const DEFAULTS: Settings = {
  format: "msg",
  dateFormat: "jjmmdd",
  subfolder: "Inbound",
  template: "{date} - {from} - {to} - {title}",
  category: "Gearchiveerd",
};

export function getSettings(): Settings {
  const saved = (Office.context.roamingSettings.get("settings") as Partial<Settings>) ?? {};
  return { ...DEFAULTS, ...saved };
}

export function setSettings(s: Settings): Promise<void> {
  Office.context.roamingSettings.set("settings", s);
  return new Promise((resolve) => Office.context.roamingSettings.saveAsync(() => resolve()));
}
