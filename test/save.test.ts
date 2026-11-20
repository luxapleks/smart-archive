import { test } from "node:test";
import assert from "node:assert/strict";
import { findSubfolder, matchesSubfolder, saveToDirectory, uniqueStem } from "../src/fsaccess.ts";
import { formatIsoDate } from "../src/shared/naming.ts";

/** Minimale in-memory nabootsing van FileSystemDirectoryHandle. */
class MemDir {
  kind = "directory" as const;
  dirs = new Map<string, MemDir>();
  files = new Map<string, Uint8Array>();
  constructor(public name: string) {}
  sub(...names: string[]): MemDir {
    let d: MemDir = this;
    for (const n of names) {
      if (!d.dirs.has(n)) d.dirs.set(n, new MemDir(n));
      d = d.dirs.get(n)!;
    }
    return d;
  }
  async *values() {
    for (const d of this.dirs.values()) yield d;
    for (const n of this.files.keys()) yield { kind: "file", name: n };
  }
  async getDirectoryHandle(n: string, o?: { create?: boolean }) {
    const k = [...this.dirs.keys()].find((x) => x.toLowerCase() === n.toLowerCase());
    if (k) return this.dirs.get(k)!;
    if (!o?.create) throw Object.assign(new Error("nf"), { name: "NotFoundError" });
    return this.sub(n);
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

const files = [{ ext: "msg", data: new Uint8Array([1, 2]), type: "x" }];

test("creates Inbound when none exists", async () => {
  const root = new MemDir("ACME BV");
  root.sub("Financials", "2025");
  const r = await saveToDirectory(root as any, "x", files, "Inbound");
  assert.equal(r.folder, "ACME BV\\Inbound");
  assert.ok(root.dirs.get("Inbound")!.files.has("x.msg"));
});

test("uses existing deeper Inbound instead of creating one", async () => {
  const root = new MemDir("ACME BV");
  root.sub("Deliverables");
  const deep = root.sub("1. Information", "Inbound");
  const r = await saveToDirectory(root as any, "x", files, "Inbound");
  assert.equal(r.folder, "ACME BV\\1. Information\\Inbound");
  assert.ok(deep.files.has("x.msg"));
  assert.equal(root.dirs.has("Inbound"), false);
});

test("shallowest match wins; numbered names count", async () => {
  const root = new MemDir("ACME");
  root.sub("Information", "Sub", "Inbound");
  root.sub("Information", "02 Inbound");
  const f = await findSubfolder(root as any, "Inbound");
  assert.deepEqual(f?.path, ["Information", "02 Inbound"]);
});

test("search depth is limited to 3 levels", async () => {
  const root = new MemDir("ACME");
  root.sub("a", "b", "c", "Inbound");
  assert.equal(await findSubfolder(root as any, "Inbound"), null);
});

test("chosen Inbound folder itself is used directly; duplicates are numbered", async () => {
  const inbound = new MemDir("Inbound");
  inbound.files.set("x.msg", new Uint8Array());
  const r = await saveToDirectory(inbound as any, "x", files, "Inbound");
  assert.equal(r.folder, "Inbound");
  assert.deepEqual(r.names, ["x (2).msg"]);
  assert.equal(await uniqueStem(inbound as any, "y", ["msg"]), "y");
});

test("empty subfolder setting saves directly in chosen folder", async () => {
  const root = new MemDir("ACME");
  const r = await saveToDirectory(root as any, "x", files, "");
  assert.equal(r.folder, "ACME");
  assert.ok(root.files.has("x.msg"));
});

test("subfolder name matching", () => {
  for (const n of ["Inbound", "inbound", "01 Inbound", "1. Inbound", "2 - Inbound", " Inbound "]) assert.ok(matchesSubfolder(n, "Inbound"), n);
  for (const n of ["Inbound oud", "Outbound", "Inbound (archief)"]) assert.ok(!matchesSubfolder(n, "Inbound"), n);
});

test("date formats", () => {
  assert.equal(formatIsoDate("2026-11-20", "jjmmdd"), "261120");
  assert.equal(formatIsoDate("2026-11-20", "jj-mm-dd"), "26-11-20");
  assert.equal(formatIsoDate("2026-11-20", "jj mm dd"), "26 11 20");
  assert.equal(formatIsoDate("2026-11-20", "jjjj-mm-dd"), "2026-11-20");
});

test("attachments saved next to the mail with own names; duplicates numbered", async () => {
  const root = new MemDir("ACME");
  const inbound = root.sub("Information", "Inbound");
  inbound.files.set("261120 Bijlage 1 SPA.pdf", new Uint8Array());
  const r = await saveToDirectory(root as any, "261120 - A→B - T", files, "Inbound", [
    { name: "261120 Bijlage 1 SPA.pdf", data: new Uint8Array([9]), type: "application/pdf" },
    { name: "261120 Bijlage 2 README", data: new Uint8Array([8]), type: "text/plain" },
  ]);
  assert.deepEqual(r.names, ["261120 - A→B - T.msg", "261120 Bijlage 1 SPA (2).pdf", "261120 Bijlage 2 README"]);
  assert.equal(r.folder, "ACME\\Information\\Inbound");
});
