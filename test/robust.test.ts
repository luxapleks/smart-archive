import { test } from "node:test";
import assert from "node:assert/strict";
import { listFolders, stillExists, findSubfolder } from "../src/fsaccess.ts";

const nf = () => Object.assign(new Error("A requested file or directory could not be found"), { name: "NotFoundError" });

function dir(name: string, children: any[] = [], opts: { throwAt?: number; hangAt?: number; gone?: boolean } = {}) {
  return {
    kind: "directory",
    name,
    values() {
      let i = 0;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          if (opts.gone) return Promise.reject(nf());
          if (opts.throwAt === i) return Promise.reject(nf());
          if (opts.hangAt === i) return new Promise(() => {}); // OneDrive die blijft "ophalen"
          return Promise.resolve(i < children.length ? { done: false, value: children[i++] } : { done: true, value: undefined });
        },
      };
    },
  };
}

test("listing continues with what it found when an entry cannot be read", async () => {
  const root = dir("Prospects", [dir("ACME"), dir("Bakker BV"), dir("kapot"), dir("Zeeman")], { throwAt: 2 });
  const f = await listFolders(root as any, 1);
  assert.deepEqual(f.map((x) => x.path), ["ACME", "Bakker BV"]);
});

test("a hanging folder is skipped instead of blocking forever", async () => {
  const root = dir("Prospects", [dir("ACME"), dir("Traag")], { hangAt: 1 });
  const t0 = Date.now();
  const f = await listFolders(root as any, 1);
  assert.deepEqual(f.map((x) => x.path), ["ACME"]);
  assert.ok(Date.now() - t0 < 5000);
});

test("deeper levels: unreadable child folder does not break the rest", async () => {
  const root = dir("Prospects", [dir("2025", [dir("ACME")], { gone: true }), dir("2026", [dir("Zeeman")])]);
  const f = await listFolders(root as any, 2);
  assert.deepEqual(f.map((x) => x.path), ["2025", "2026", "2026/Zeeman"]);
});

test("stale root is detected", async () => {
  assert.equal(await stillExists(dir("weg", [], { gone: true }) as any), false);
  assert.equal(await stillExists(dir("ok", [dir("a")]) as any), true);
});

test("inbound search survives unreadable subfolders", async () => {
  const client = dir("ACME", [dir("Snelkoppeling", [], { gone: true }), dir("Information", [dir("Inbound")])]);
  const r = await findSubfolder(client as any, "Inbound");
  assert.deepEqual(r?.path, ["Information", "Inbound"]);
});
