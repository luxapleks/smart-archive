/** Instellingen, opgeslagen in Outlook roamingSettings (reist mee met je mailbox). */
import { DEFAULT_TEMPLATE } from "./shared/naming";

/** Eerdere standaardsjablonen: automatisch bijwerken naar de nieuwe standaard. */
const OLD_TEMPLATES = ["{date} - {from} - {to} - {title}"];
export type Format = "msg" | "eml";
export type DateFormat = "jjmmdd" | "jj-mm-dd" | "jj mm dd" | "jjjj-mm-dd";

export interface Settings {
  format: Format;
  dateFormat: DateFormat;
  saveAttachments: boolean;
  subfolder: string;
  template: string;
  category: string;
}

export const DEFAULTS: Settings = {
  format: "msg",
  dateFormat: "jjmmdd",
  saveAttachments: true,
  subfolder: "Inbound",
  template: DEFAULT_TEMPLATE,
  category: "Gearchiveerd",
};

export function getSettings(): Settings {
  const saved = (Office.context.roamingSettings.get("settings") as Partial<Settings>) ?? {};
  const s = { ...DEFAULTS, ...saved };
  if (OLD_TEMPLATES.includes(s.template)) s.template = DEFAULT_TEMPLATE;
  return s;
}

export function setSettings(s: Settings): Promise<void> {
  Office.context.roamingSettings.set("settings", s);
  return new Promise((resolve) => Office.context.roamingSettings.saveAsync(() => resolve()));
}
