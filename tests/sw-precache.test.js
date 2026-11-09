import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { buildPrecache, ROOT } from "../tools/gen-precache.mjs";
import { VERSION } from "../src/version.js";

const FIX = "run node tools/gen-precache.mjs";

function loadPrecache() {
  const path = join(ROOT, "precache.js");
  assert.ok(existsSync(path), `precache.js is missing — ${FIX}`);
  const self = {};
  vm.runInNewContext(readFileSync(path, "utf8"), { self });
  return { self, text: readFileSync(path, "utf8") };
}

test("precache.js is up to date with src/version.js and the file tree", () => {
  const { self, text } = loadPrecache();
  const expected = buildPrecache(ROOT);
  assert.equal(self.APP_VERSION, VERSION, `precache.js APP_VERSION is stale — ${FIX}`);
  assert.deepEqual([...self.PRECACHE_URLS], expected.urls, `precache.js file list is stale — ${FIX}`);
  assert.equal(text, expected.source, `precache.js is stale — ${FIX}`);
});

test("every precached URL exists on disk", () => {
  const { self } = loadPrecache();
  for (const url of self.PRECACHE_URLS) {
    assert.ok(url.startsWith("./"), `relative URL: ${url}`);
    if (url === "./") continue; // served as index.html
    assert.ok(existsSync(join(ROOT, url.slice(2))), `${url} is precached but missing on disk — create it or ${FIX}`);
  }
});

test("precache list starts with ./ and ./index.html and contains the core files", (t) => {
  const { self } = loadPrecache();
  const urls = self.PRECACHE_URLS;
  assert.equal(urls[0], "./");
  assert.equal(urls[1], "./index.html");
  assert.equal(new Set(urls).size, urls.length, "no duplicates");
  for (const u of ["./program.json", "./manifest.webmanifest", "./assets/icon-192.png", "./assets/icon-512.png"]) {
    assert.ok(urls.includes(u), `${u} must be precached — ${FIX}`);
  }
  if (existsSync(join(ROOT, "src", "app.js"))) {
    assert.ok(urls.includes("./src/app.js"), `./src/app.js must be precached — ${FIX}`);
  } else {
    t.diagnostic("src/app.js not present yet; skipped that assertion");
  }
});

test("generator: ordering and exclusions (temp tree)", () => {
  const dir = mkdtempSync(join(tmpdir(), "gzclp-precache-"));
  try {
    const files = [
      "index.html", "program.json", "manifest.webmanifest", "sw.js", "precache.js",
      "README.md", "package.json", "package-lock.json", ".nojekyll", ".git/HEAD",
      "tests/a.test.js", "tools/x.mjs", "docs/SPEC.md", "node_modules/m/index.js",
      "src/version.js", "src/app.js", "src/ui/dev/preview.html", "src/ui/screens/workout.js",
      "src/styles/base.css", "assets/icon.svg", "assets/.DS_Store",
    ];
    for (const f of files) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), f === "src/version.js" ? 'export const VERSION = "9.9.9";\n' : "x");
    }
    const { version, urls, source } = buildPrecache(dir);
    assert.equal(version, "9.9.9");
    assert.deepEqual(urls, [
      "./", "./index.html",
      "./assets/icon.svg", "./manifest.webmanifest", "./program.json",
      "./src/app.js", "./src/styles/base.css", "./src/ui/screens/workout.js", "./src/version.js",
    ]);
    const self = {};
    vm.runInNewContext(source, { self });
    assert.equal(self.APP_VERSION, "9.9.9");
    assert.deepEqual([...self.PRECACHE_URLS], urls);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sw.js imports precache.js and uses a versioned gzclp- cache", () => {
  const sw = readFileSync(join(ROOT, "sw.js"), "utf8");
  assert.match(sw, /importScripts\(\s*["']\.\/precache\.js["']\s*\)/);
  assert.match(sw, /"gzclp-"/);
  assert.match(sw, /skipWaiting\(\)/);
  assert.match(sw, /clients\.claim\(\)/);
  assert.match(sw, /sw-updated/);
});

test("manifest.webmanifest is valid and installable-shaped", () => {
  const m = JSON.parse(readFileSync(join(ROOT, "manifest.webmanifest"), "utf8"));
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.display, "standalone");
  assert.ok(m.name && m.short_name && m.theme_color && m.background_color);
  const has = (size, purpose) => m.icons.some((i) => i.sizes === size && i.purpose.split(" ").includes(purpose));
  assert.ok(has("192x192", "any") && has("512x512", "any") && has("512x512", "maskable"));
  for (const icon of m.icons) {
    assert.ok(icon.src.startsWith("./"), "relative icon path");
    const path = join(ROOT, icon.src.slice(2));
    assert.ok(existsSync(path), `${icon.src} exists`);
    if (icon.type === "image/png") {
      const buf = readFileSync(path);
      assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
      const [w, h] = icon.sizes.split("x").map(Number);
      assert.equal(buf.readUInt32BE(16), w);
      assert.equal(buf.readUInt32BE(20), h);
    }
  }
});
