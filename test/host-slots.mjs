// Host slot-core acquisition for test/slot-mount.mjs.
//
// Why this file exists
// --------------------
// `test/slot-mount.mjs` drives the REAL `@deepseek-ai/dsh-client-ui-renderer`
// against the REAL `SlotCore` implementation. Up to dsh 0.2.0 the desktop/CLI
// host shipped `@deepseek-ai/dsh-client-ui-slots` as an installable package
// (a nested dependency of the host bundle), so the test resolved it out of the
// installed tree like any other host package. dsh 0.2.1 changed the packaging:
// slots (together with primitives / dockkit / client-store) is INLINED into
// `dsh-web-frontend/dist` and published to the browser through the shell
// bundle's shared module table (`staticModules: { "…/slots": SI, … }` in the
// shell entry). The asar/profile therefore contains no slots package at all,
// while `dsh-client-ui-renderer/lib/client.js` still does
// `require("@deepseek-ai/dsh-client-ui-slots")` — in the page that require is
// answered by the shell table, in node there is no page.
//
// A test that gave up here would stop guarding the browser half exactly when a
// host release rewrote the client packaging, so this file keeps the guard alive
// WITHOUT inventing a fake slot implementation. The package is still published
// on npm at the host's own version (the host's `dsh-client-test-runtime`
// declares it as a peer dependency for its own slot bench), so the honest node
// equivalent of the shell table is: load `@deepseek-ai/dsh-client-ui-slots` at
// the SAME version as the installed renderer. This file acquires that package.
//
// Resolution order
// ----------------
//   1. The installed host tree (caller-supplied probe) — the pre-0.2.1 layout,
//      unchanged and offline.
//   2. `DSH_GIT_SLOTS_ROOT` — authoritative when set: the directory must BE the
//      package root (package.json + lib/ entry). Bad value is a failure, never
//      a silent fallback; it is also the documented offline escape hatch.
//   3. The per-version cache `%TEMP%/dsh-git-slots/<version>` — populated by a
//      previous run, so the network is touched once per host version.
//   4. The npm registry: read the version's metadata, download its tarball,
//      verify `dist.integrity` when present, and extract just package.json plus
//      `lib/**/*.js`. `DSH_GIT_SLOTS_REGISTRY` overrides the registry base URL
//      (a mirror, or a dead URL to prove the failure path).
//
// Failure semantics
// -----------------
// This module throws with an actionable message when the package cannot be
// obtained. The CALLER decides what a throw means: `test/slot-mount.mjs` turns
// it into `FAIL` + exit 1 on any machine with a dsh install, and only a machine
// with no install at all skips (see `unresolvedHost()` in host-root.mjs). That
// is deliberate: "hosted but unable to run the guard" must stay loud.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

/** The host package this file acquires. */
export const SLOTS_PACKAGE = "@deepseek-ai/dsh-client-ui-slots";

/** Default registry base; `DSH_GIT_SLOTS_REGISTRY` overrides it. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** How long one HTTP round trip may take before acquisition gives up. */
const FETCH_TIMEOUT_MS = 20_000;

/** Absolute cache directory for one host version. */
export function slotsCacheDir(version) {
  return join(tmpdir(), "dsh-git-slots", version);
}

/** The package-relative entry file a manifest points at. */
function entryOf(manifest) {
  const dot = manifest.exports?.["."];
  if (typeof dot === "string") return dot;
  if (dot !== null && typeof dot === "object" && typeof dot.default === "string") return dot.default;
  if (typeof manifest.main === "string") return manifest.main;
  return "lib/index.js";
}

/**
 * Read and validate one extracted package directory.
 * @param dir - candidate package root.
 * @returns `{ manifest, entry }`, entry absolute.
 * @throws when the directory is not a usable copy of the host package.
 */
function readPackageDir(dir) {
  if (typeof dir !== "string" || dir === "") throw new Error("empty package directory");
  const manifestFile = join(dir, "package.json");
  if (!existsSync(manifestFile)) throw new Error(`${manifestFile} does not exist`);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (manifest.name !== SLOTS_PACKAGE) throw new Error(`${manifestFile} declares ${JSON.stringify(manifest.name)}, expected ${SLOTS_PACKAGE}`);
  const entry = resolve(dir, entryOf(manifest));
  if (!existsSync(entry)) throw new Error(`${manifestFile} points at ${entryOf(manifest)}, which does not exist`);
  return { manifest, entry };
}

/** True when `dir` holds a complete, importable copy of the package. */
function usablePackage(dir) {
  try {
    return readPackageDir(dir);
  } catch {
    return undefined;
  }
}

/** The message printed when the package cannot be obtained, with the knobs spelled out. */
function slotsFailure(version, notes, hint) {
  const cache = slotsCacheDir(version);
  return [
    `cannot obtain ${SLOTS_PACKAGE}@${version}, which the installed host's renderer requires:`,
    ...notes.map((note) => `  - ${note}`),
    `  dsh >= 0.2.1 no longer ships this package: it is inlined into the shell bundle's shared module table,`,
    `  which only exists in a browser page, so node cannot read it out of the installed host.`,
    `  The guard loads the SAME version from npm instead of faking a slot implementation.`,
    `  fix (any one): go online once (this test caches the package at ${cache}),`,
    `                 set DSH_GIT_SLOTS_ROOT to an extracted ${SLOTS_PACKAGE}@${version} directory,`,
    `                 or pre-populate ${cache} from "npm pack ${SLOTS_PACKAGE}@${version}".`,
    hint === undefined ? "" : `  note: ${hint}`
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Fetch one URL and return the body as a Buffer, with a timeout and a readable error. */
async function fetchBuffer(url) {
  if (typeof fetch !== "function") throw new Error(`this node (${process.version}) has no global fetch; set DSH_GIT_SLOTS_ROOT instead`);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`GET ${url} failed: ${error.message}`);
  }
  if (!response.ok) throw new Error(`GET ${url} answered HTTP ${response.status}${response.status === 404 ? " (unknown package/version)" : ""}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Verify one SRI string (`sha512-<base64>`) against the tarball bytes. */
function verifyIntegrity(tarball, integrity) {
  if (typeof integrity !== "string" || integrity === "") return false;
  const dash = integrity.indexOf("-");
  if (dash <= 0) return false;
  const algorithm = integrity.slice(0, dash);
  const expected = integrity.slice(dash + 1);
  const actual = createHash(algorithm).update(tarball).digest("base64");
  if (actual !== expected) throw new Error(`tarball integrity mismatch: ${algorithm}-${actual} != ${integrity}`);
  return true;
}

/** Parse a gzipped npm tarball into `Map<package-relative path, Buffer>` (regular files only). */
function extractTarball(tarball) {
  let tar;
  try {
    tar = gunzipSync(tarball);
  } catch (error) {
    throw new Error(`tarball is not gzip: ${error.message}`);
  }
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).replace(/\0[\s\S]*$/, "").trim();
    if (name === "") break; // end-of-archive block
    const sizeText = header.toString("utf8", 124, 136).replace(/\0[\s\S]*$/, "").trim();
    const size = sizeText === "" ? 0 : Number.parseInt(sizeText, 8);
    if (!Number.isFinite(size) || size < 0) throw new Error(`unreadable tar entry size for ${name}`);
    const type = String.fromCharCode(header[156] === 0 ? 48 : header[156]);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    // '0'/NUL are regular files; PAX/global headers and links are skipped on purpose.
    if ((type === "0" || type === "\0") && name.startsWith("package/")) {
      const relative = name.slice("package/".length);
      if (!relative.split("/").includes("..") && !relative.startsWith("/")) files.set(relative, Buffer.from(body));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/**
 * Download one version from the registry and cache the parts the test imports.
 * @param version - exact host version to fetch.
 * @param log - progress sink.
 * @returns the cache directory (validated, importable).
 */
async function downloadPackage(version, log) {
  const base = (process.env.DSH_GIT_SLOTS_REGISTRY ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
  const metadataUrl = `${base}/${SLOTS_PACKAGE.replace("/", "%2F")}/${version}`;
  log(`host-slots: fetching ${metadataUrl}`);
  const metadata = JSON.parse((await fetchBuffer(metadataUrl)).toString("utf8"));
  if (metadata?.version !== version) throw new Error(`${metadataUrl} describes version ${String(metadata?.version)}, expected ${version}`);
  const tarballUrl = metadata?.dist?.tarball;
  if (typeof tarballUrl !== "string" || tarballUrl === "") throw new Error(`${metadataUrl} carries no dist.tarball`);
  log(`host-slots: downloading ${tarballUrl}`);
  const tarball = await fetchBuffer(tarballUrl);
  const verified = verifyIntegrity(tarball, metadata?.dist?.integrity);

  const files = extractTarball(tarball);
  const manifestText = files.get("package.json");
  if (manifestText === undefined) throw new Error(`tarball ${tarballUrl} contains no package.json`);
  const manifest = JSON.parse(manifestText.toString("utf8"));
  if (manifest.name !== SLOTS_PACKAGE || manifest.version !== version) {
    throw new Error(`tarball ${tarballUrl} is ${String(manifest.name)}@${String(manifest.version)}, expected ${SLOTS_PACKAGE}@${version}`);
  }
  const wanted = new Map([["package.json", manifestText]]);
  for (const [relative, body] of files) {
    if (/^lib\/.+\.(?:js|mjs|cjs|json)$/.test(relative)) wanted.set(relative, body);
  }
  const entryRelative = entryOf(manifest).replace(/^\.\//, "");
  if (!wanted.has(entryRelative)) throw new Error(`tarball ${tarballUrl} is missing the entry ${entryRelative}`);

  const dir = slotsCacheDir(version);
  mkdirSync(dir, { recursive: true });
  for (const [relative, body] of wanted) {
    const target = join(dir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  const validated = readPackageDir(dir);
  log(`host-slots: cached ${SLOTS_PACKAGE}@${validated.manifest.version} (${verified ? "integrity verified, " : ""}${wanted.size} files) at ${dir}`);
  return dir;
}

/**
 * Obtain an importable copy of the host's slot core, version-matched to the
 * installed renderer unless the installed host still ships the package itself.
 * @param options.version - version of the installed `dsh-client-ui-renderer`.
 * @param options.locateInstalled - probe for a package directory in the installed host tree; may throw.
 * @param options.log - progress/diagnostic sink (defaults to a no-op).
 * @returns `{ dir, version, entry, source }` — source is `installed` / `override` / `cache` / `registry`.
 * @throws when no copy can be obtained; the caller maps that onto FAIL vs SKIP.
 */
export async function ensureSlotsPackage({ version, locateInstalled, log = () => {} } = {}) {
  if (typeof version !== "string" || version === "") throw new Error("ensureSlotsPackage needs the installed renderer's version");
  const notes = [];

  // 1. The pre-0.2.1 layout: the host vendors the package itself.
  if (typeof locateInstalled === "function") {
    try {
      const hit = locateInstalled();
      const { manifest, entry } = readPackageDir(hit?.dir);
      return { dir: resolve(hit.dir), version: manifest.version, entry, source: "installed" };
    } catch (error) {
      notes.push(`installed host tree: ${error.message}`);
    }
  } else {
    notes.push("installed host tree: no probe supplied");
  }

  // 2. Explicit override, authoritative and offline-friendly.
  const override = process.env.DSH_GIT_SLOTS_ROOT;
  if (typeof override === "string" && override !== "") {
    try {
      const { manifest, entry } = readPackageDir(override);
      return { dir: resolve(override), version: manifest.version, entry, source: "override" };
    } catch (error) {
      throw new Error(slotsFailure(version, [...notes, `DSH_GIT_SLOTS_ROOT=${override}: ${error.message}`], "DSH_GIT_SLOTS_ROOT is authoritative — unset it or point it at a real package directory"));
    }
  }

  // 3. A copy cached by an earlier run for this exact host version.
  const cacheDir = slotsCacheDir(version);
  const cached = usablePackage(cacheDir);
  if (cached !== undefined) return { dir: cacheDir, version: cached.manifest.version, entry: cached.entry, source: "cache" };
  notes.push(`cache: ${cacheDir} holds no usable copy`);

  // 4. The registry, at the version the installed renderer was built with.
  try {
    const dir = await downloadPackage(version, log);
    const { manifest, entry } = readPackageDir(dir);
    return { dir, version: manifest.version, entry, source: "registry" };
  } catch (error) {
    notes.push(`npm registry: ${error.message}`);
    throw new Error(slotsFailure(version, notes));
  }
}
