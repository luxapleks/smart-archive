import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentFileName, extractAttachments, isSignatureImage, nameAttachments } from "../src/shared/attachments.ts";
import { makeEml } from "./fixtures/make-eml.ts";

test("extracts real attachments, skips inline logo, names them", async () => {
  const raw = await extractAttachments(makeEml());
  const named = nameAttachments("261109", raw);
  assert.deepEqual(named.map((n) => n.name), [
    "261109 Bijlage 1 Concept SPA v3 – markup.pdf",
    "261109 Bijlage 2 Oorspronkelijke vraag.eml",
  ]);
  assert.equal(Buffer.from(named[0].data.subarray(0, 8)).toString(), "%PDF-1.4");
});

test("attachment names are sanitized and length-limited, extension kept", () => {
  assert.equal(attachmentFileName("261120", 3, "Q3: cijfers/WACC.xlsx"), "261120 Bijlage 3 Q3 cijfers WACC.xlsx");
  const long = attachmentFileName("261120", 1, "a".repeat(300) + ".pdf");
  assert.ok(long.length <= 150 && long.endsWith(".pdf"));
  assert.equal(attachmentFileName("26 11 20", 2, "README"), "26 11 20 Bijlage 2 README");
});

test("signature images are recognised", () => {
  assert.ok(isSignatureImage({ filename: "image001.png", mimeType: "image/png", size: 5000, inline: false }));
  assert.ok(isSignatureImage({ filename: "logo.png", mimeType: "image/png", size: 5000, inline: true }));
  assert.ok(!isSignatureImage({ filename: "foto bouwplaats.jpg", mimeType: "image/jpeg", size: 2_000_000, inline: false }));
  assert.ok(!isSignatureImage({ filename: "image001.png", mimeType: "image/png", size: 500_000, inline: false }));
});
