import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { buildAttachments } from "../src/build.ts";
import { makeEml } from "./fixtures/make-eml.ts";

test("attached mail is saved as a readable .msg", async () => {
  const files = await buildAttachments(makeEml(), { format: "msg", attachmentDate: "261126" });
  assert.deepEqual(files.map((f) => f.name), ["261126 Bijlage 1 Concept SPA v3 – markup.pdf", "261126 Bijlage 2 Oorspronkelijke vraag.msg"]);
  const msg = files[1].data;
  assert.deepEqual([...msg.subarray(0, 4)], [0xd0, 0xcf, 0x11, 0xe0]); // compound file
  mkdirSync("test/out", { recursive: true });
  writeFileSync("test/out/attached.msg", msg);
});

test("eml format keeps attached mail as .eml", async () => {
  const files = await buildAttachments(makeEml(), { format: "eml", attachmentDate: "261126" });
  assert.equal(files[1].name, "261126 Bijlage 2 Oorspronkelijke vraag.eml");
});
