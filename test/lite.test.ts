import { test } from "node:test";
import assert from "node:assert/strict";
import { orgFromDomain, personLabel, shortName, suggestParts } from "../src/shared/labels.ts";
import { buildFileName } from "../src/shared/naming.ts";

test("organisation from domain", () => {
  assert.equal(orgFromDomain("rabobank.nl"), "Rabobank");
  assert.equal(orgFromDomain("mail.kpmg.com"), "KPMG");
  assert.equal(orgFromDomain("houthoff-buruma.com"), "Houthoff Buruma");
  assert.equal(orgFromDomain("company.co.uk"), "Company");
  assert.equal(orgFromDomain("gmail.com"), "");
  assert.equal(orgFromDomain("bakertilly.nl", "bakertilly.nl"), "");
});

test("short person names", () => {
  assert.equal(personLabel({ name: "Jürgen de Vries", address: "jurgen@rabobank.nl" }), "JdeVries");
  assert.equal(personLabel({ name: "Niemeijer, Alexander", address: "a@bakertilly.nl" }), "ANiemeijer");
  assert.equal(personLabel({ address: "piet.van.den.berg@acme.nl" }), "PvandenBerg");
  assert.equal(shortName("Jan Pieter Jansen"), "JJansen");
  assert.equal(shortName("Anna Jansen-Bakker (Extern)"), "AJansen-Bakker");
  assert.equal(shortName("Piet Jansen | Rabobank"), "PJansen");
  assert.equal(shortName("Servicedesk"), "Servicedesk");
});

test("parts for received and sent mail", () => {
  const me = "a.niemeijer@bakertilly.nl";
  const rec = suggestParts({
    subject: "RE: FW: [EXTERN] Concept SPA Project Alpha",
    from: { name: "Jürgen de Vries", address: "jurgen@rabobank.nl" },
    to: [{ name: "Niemeijer, Alexander", address: me }],
    cc: [], date: "2026-11-09T08:13:27Z", body: "", me,
  });
  assert.deepEqual(rec, { date: "2026-11-09", from: "JdeVries", to: "ANiemeijer", title: "Concept SPA Project Alpha" });
  assert.equal(
    buildFileName(rec, "msg"),
    "2026-11-09 - JdeVries - ANiemeijer - Concept SPA Project Alpha.msg",
  );

  const sent = suggestParts({
    subject: "", from: { name: "Alexander Niemeijer", address: me },
    to: [{ name: "Niemeijer, Alexander", address: me }, { name: "Anna Bakker", address: "anna@acme.nl" }],
    cc: [], date: "2026-11-09T23:30:00Z", body: "Beste Anna,\n\nHierbij de waarderingsrapportage Q3.\n", me,
  });
  assert.equal(sent.to, "ABakker e.a.");
  assert.equal(sent.title, "Hierbij de waarderingsrapportage Q3.");
  assert.equal(sent.date, "2026-11-10");
});

