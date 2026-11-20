import { test } from "node:test";
import assert from "node:assert/strict";
import { saveToDirectory, uniqueStem } from "../src/fsaccess.ts";
import { emlToPdf, toWinAnsi } from "../src/shared/pdf.ts";
import { makeEml } from "./fixtures/make-eml.ts";

/** Minimale in-memory nabootsing van FileSystemDirectoryHandle. */
class MemDir {
  dirs = new Map<string, MemDir>();
  files = new Map<string, Uint8Array>();
  constructor(public name: string) {}
  async getDirectoryHandle(n: string, o?: { create?: boolean }) {
    const k = [...this.dirs.keys()].find((x) => x.toLowerCase() === n.toLowerCase());
    if (k) return this.dirs.get(k)!;
    if (!o?.create) throw Object.assign(new Error("nf"), { name: "NotFoundError" });
    const d = new MemDir(n);
    this.dirs.set(n, d);
    return d;
  }
  async getFileHandle(n: string, o?: { create?: boolean }) {
    if (!this.files.has(n) && !o?.create) throw Object.assign(new Error("nf"), { name: "NotFoundError" });
    const self = this;
    return {
      async createWritable() {
        let data = new Uint8Array();
        return {
          async write(b: Blob) { data = new Uint8Array(await b.arrayBuffer()); },
          async close() { self.files.set(n, data); },
        };
      },
    };
  }
}

const files = [
  { ext: "msg", data: new Uint8Array([1, 2]), type: "x" },
  { ext: "pdf", data: new Uint8Array([3]), type: "y" },
];

test("saves into Inbound subfolder, creating it", async () => {
  const root = new MemDir("ACME BV");
  const r = await saveToDirectory(root as any, "2026-11-20 - A - B - T", files, "Inbound");
  assert.equal(r.folder, "ACME BV\\Inbound");
  assert.deepEqual(r.names, ["2026-11-20 - A - B - T.msg", "2026-11-20 - A - B - T.pdf"]);
  assert.deepEqual([...root.dirs.get("Inbound")!.files.keys()].sort(), r.names);
});

test("uses existing inbound (any case) and numbers duplicates consistently", async () => {
  const root = new MemDir("ACME BV");
  const inbound = await root.getDirectoryHandle("inbound", { create: true });
  inbound.files.set("x.pdf", new Uint8Array()); // alleen pdf bestaat al
  const r = await saveToDirectory(root as any, "x", files, "Inbound");
  assert.deepEqual(r.names, ["x (2).msg", "x (2).pdf"]);
  assert.equal(root.dirs.size, 1);
});

test("no Inbound-in-Inbound when the Inbound folder itself is chosen", async () => {
  const inbound = new MemDir("Inbound");
  const r = await saveToDirectory(inbound as any, "x", files, "Inbound");
  assert.equal(r.folder, "Inbound");
  assert.equal(inbound.dirs.size, 0);
  assert.equal(await uniqueStem(inbound as any, "x", ["msg"]), "x (2)");
});

test("empty subfolder setting saves directly in chosen folder", async () => {
  const root = new MemDir("ACME");
  const r = await saveToDirectory(root as any, "x", files, "");
  assert.equal(r.folder, "ACME");
  assert.equal(root.files.size, 2);
});

test("PDF is generated with header and body text", async () => {
  const pdf = await emlToPdf(makeEml(), { footer: "2026-11-09 - test" });
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), "%PDF-");
  assert.ok(pdf.byteLength > 1500);
});

test("WinAnsi sanitizing keeps Dutch text and drops emoji", () => {
  assert.equal(toWinAnsi("Jürgen – “offerte” € 5 ✓ 👍​"), "Jürgen – “offerte” € 5 v ");
});
