import { test } from "node:test";
import assert from "node:assert/strict";
import { orgFromDomain, personLabel, suggestParts } from "../src/shared/labels.ts";
import { commonBase, foldersFromRelativeFiles, fullTargetPath, parseFolderList, scoreFolders } from "../src/shared/folders.ts";
import { buildFileName } from "../src/shared/naming.ts";

test("organisation from domain", () => {
  assert.equal(orgFromDomain("rabobank.nl"), "Rabobank");
  assert.equal(orgFromDomain("mail.kpmg.com"), "KPMG");
  assert.equal(orgFromDomain("houthoff-buruma.com"), "Houthoff Buruma");
  assert.equal(orgFromDomain("company.co.uk"), "Company");
  assert.equal(orgFromDomain("gmail.com"), "");
  assert.equal(orgFromDomain("bakertilly.nl", "bakertilly.nl"), "");
});

test("person labels", () => {
  assert.equal(personLabel({ name: "Jürgen de Vries", address: "jurgen@rabobank.nl" }, "bakertilly.nl"), "Jürgen de Vries (Rabobank)");
  assert.equal(personLabel({ name: "Niemeijer, Alexander", address: "a@bakertilly.nl" }, "bakertilly.nl"), "Alexander Niemeijer");
  assert.equal(personLabel({ address: "piet.de.vries@acme.nl" }, "bakertilly.nl"), "Piet de Vries (ACME)");
  assert.equal(personLabel({ name: "Rabobank Servicedesk", address: "noreply@rabobank.nl" }), "Rabobank Servicedesk");
});

test("parts for received and sent mail", () => {
  const me = "a.niemeijer@bakertilly.nl";
  const rec = suggestParts({
    subject: "RE: FW: [EXTERN] Concept SPA Project Alpha",
    from: { name: "Jürgen de Vries", address: "jurgen@rabobank.nl" },
    to: [{ name: "Niemeijer, Alexander", address: me }],
    cc: [], date: "2026-11-09T08:13:27Z", body: "", me,
  });
  assert.deepEqual(rec, { date: "2026-11-09", from: "Jürgen de Vries (Rabobank)", to: "Alexander Niemeijer", title: "Concept SPA Project Alpha" });
  assert.equal(
    buildFileName(rec, "msg"),
    "2026-11-09 - Jürgen de Vries (Rabobank) - Alexander Niemeijer - Concept SPA Project Alpha.msg",
  );

  const sent = suggestParts({
    subject: "", from: { name: "Alexander Niemeijer", address: me },
    to: [{ name: "Niemeijer, Alexander", address: me }, { name: "Anna Bakker", address: "anna@acme.nl" }],
    cc: [], date: "2026-11-09T23:30:00Z", body: "Beste Anna,\n\nHierbij de waarderingsrapportage Q3.\n", me,
  });
  assert.equal(sent.to, "Anna Bakker (ACME) e.a.");
  assert.equal(sent.title, "Hierbij de waarderingsrapportage Q3.");
  assert.equal(sent.date, "2026-11-10");
});

test("parse PowerShell folder list with auto base", () => {
  const txt = [
    "\uFEFFC:\\Users\\alex\\Baker Tilly\\TAS - Dossiers\\Klanten",
    "C:\\Users\\alex\\Baker Tilly\\TAS - Dossiers\\Klanten\\Rabobank",
    "C:\\Users\\alex\\Baker Tilly\\TAS - Dossiers\\Klanten\\Rabobank\\Project Alpha",
    "C:\\Users\\alex\\Baker Tilly\\TAS - Dossiers\\Intern\\HR",
  ].join("\r\n");
  const r = parseFolderList(txt);
  assert.equal(r.base, "C:/Users/alex/Baker Tilly/TAS - Dossiers");
  assert.deepEqual(r.folders, ["Intern", "Intern/HR", "Klanten", "Klanten/Rabobank", "Klanten/Rabobank/Project Alpha"]);
});

test("parse relative list and webkitdirectory files", () => {
  assert.deepEqual(parseFolderList("Klanten/ACME/2026\n# commentaar\n\n").folders, ["Klanten", "Klanten/ACME", "Klanten/ACME/2026"]);
  assert.deepEqual(
    foldersFromRelativeFiles(["Dossiers/Klanten/ACME/a.pdf", "Dossiers/Klanten/b.docx", "Dossiers/top.txt"]).folders,
    ["Klanten", "Klanten/ACME"],
  );
  assert.equal(commonBase(["C:/a/b/c", "C:/a/b/d/e"]), "C:/a/b");
});

test("full target path uses Windows separators", () => {
  assert.equal(
    fullTargetPath("C:/Users/alex/TAS", "Klanten/ACME", "x.msg"),
    "C:\\Users\\alex\\TAS\\Klanten\\ACME\\x.msg",
  );
  assert.equal(fullTargetPath("C:\\Users\\alex\\TAS\\", "", "x.msg"), "C:\\Users\\alex\\TAS\\x.msg");
});

test("scoring prefers matching client and project", () => {
  const s = scoreFolders(["Intern/HR", "Klanten/Rabobank", "Klanten/Rabobank/Project Alpha", "Klanten/ACME"], {
    subject: "Concept SPA Project Alpha", body: "", senderDomain: "rabobank.nl",
  });
  assert.equal(s[0].path, "Klanten/Rabobank/Project Alpha");
  assert.equal(s.find((x) => x.path === "Intern/HR")!.score, 0);
});
