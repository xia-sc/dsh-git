// Shared host discovery for the two host-contract guards
// (test/host-mount.mjs, test/slot-mount.mjs).
//
// Why this file exists
// --------------------
// Both guards used to look for the host packages in only two places:
// `$DSH_HOME/profiles/web/node_modules` and `$DSH_HOME/profiles/node_modules`.
// That was correct for the CLI/`dsh web` installs the guards were written
// against, and it silently turned both of them into no-ops (SKIP + exit 0) the
// moment the host moved: the Electron **desktop** app ships every
// `@deepseek-ai/*` package inside its `app.asar`, and the profile keeps only
// `cordis`/`cosmokit`. A guard that can no longer run is worse than no guard —
// it reports green for a host release it never looked at. This module is the
// fix in one place so the two files cannot drift again.
//
// Resolution order (`hostRoots()`):
//   1. `DSH_GIT_DSH_ROOT` — a deliberate override, and authoritative when set:
//      it does NOT silently fall back to the profiles. Pointing it at an empty
//      directory is still the way to prove the SKIP path works.
//   2. `$DSH_HOME/profiles/<$DSH_PROFILE|web|desktop>/node_modules` and
//      `$DSH_HOME/profiles/node_modules` — the CLI/web layouts.
//   3. The host packages **extracted out of `app.asar`** (desktop layout), into
//      a cache under the OS temp dir keyed by the archive's size+mtime, so the
//      ~9s first extraction is paid once per host build.
//
// `hostInstalled()` is what keeps a resolution failure loud: a machine with a
// dsh install that resolves nothing must FAIL, while a machine with no install
// at all (the repo's ubuntu CI) must SKIP. Only "no install" is a skip.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/** Absolute `$DSH_HOME` (default `~/.dsh`). */
export function dshHomeDir() {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** Package that must exist under a root for it to count as a host tree. */
const HOST_SENTINEL = join("@deepseek-ai", "dsh-client-connection", "package.json");

/** Node_modules roots inside `app.asar` that hold the host packages. */
const ASAR_INNER = "dsh/node_modules";

/** Extensions/directories that are never needed to import the host's JS. */
const NEEDED_FILE = /\.(js|mjs|cjs|json)$/i;
const BULKY_DIR = /(prebuilds|prebuilt|_vendor|sherpa-onnx-win-x64|[a-z0-9-]+-win32-x64)\//i;

/** Profile roots for the running profile first, then the known layouts. */
function profileRoots() {
  const home = dshHomeDir();
  const names = [process.env.DSH_PROFILE, "web", "desktop"].filter((name) => typeof name === "string" && name !== "");
  const roots = names.map((name) => join(home, "profiles", name, "node_modules"));
  roots.push(join(home, "profiles", "node_modules"));
  return [...new Set(roots)];
}

/** The signed-in user's profile directory names under one drive's `Users`. */
function userNamesOn(drive) {
  const usersDir = join(drive, "Users");
  try {
    return readdirSync(usersDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [basename(homedir())];
  }
}

/**
 * A `app.asar` path from the environment or the usual desktop install locations.
 * The install drive is NOT always the drive holding `%LOCALAPPDATA%` — a machine
 * can keep the app on `D:` while AppData lives on `C:` (measured on this very
 * host), so every mounted drive is probed for the per-user install path.
 */
function appAsarPath() {
  const explicit = process.env.DSH_ASAR;
  if (typeof explicit === "string" && explicit !== "") return existsSync(explicit) ? explicit : undefined;
  const tail = ["resources", "app.asar"];
  const candidates = [];
  const bases = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"], join(homedir(), "AppData", "Local")].filter(
    (base) => typeof base === "string" && base !== ""
  );
  for (const base of bases) {
    candidates.push(join(base, "Programs", "DeepSeek Harness", ...tail), join(base, "DeepSeek Harness", ...tail));
  }
  for (let code = 67 /* C */; code <= 90 /* Z */; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (!existsSync(drive)) continue;
    for (const user of userNamesOn(drive)) {
      candidates.push(join(drive, "Users", user, "AppData", "Local", "Programs", "DeepSeek Harness", ...tail));
    }
  }
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return undefined;
}

/** Open an asar archive and parse its header (the format Electron's `asar` writes). */
function openAsar(asarPath) {
  const fd = openSync(asarPath, "r");
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4);
  const jsonLength = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonLength);
  readSync(fd, json, 0, jsonLength, 16);
  return { fd, header: JSON.parse(json.toString("utf8")), dataOffset: 8 + headerSize };
}

/** The header node for a slash path inside the archive. */
function asarNode(header, path) {
  let current = header;
  for (const part of path.split("/").filter(Boolean)) {
    if (current === undefined || current.files === undefined) return undefined;
    current = current.files[part];
    if (current === undefined) return undefined;
  }
  return current;
}

/** Every file entry under a path, as `{ path, node }`. */
function asarFiles(header, prefix) {
  const out = [];
  const walk = (node, path) => {
    if (node.files !== undefined) {
      for (const [name, child] of Object.entries(node.files)) walk(child, `${path}/${name}`);
    } else {
      out.push({ path, node });
    }
  };
  const base = prefix.replace(/\/+$/, "");
  const start = asarNode(header, base);
  if (start === undefined || start.files === undefined) return out;
  for (const [name, child] of Object.entries(start.files)) walk(child, `${base}/${name}`);
  return out;
}

/**
 * Extract the host packages out of an `app.asar` into a cached temp directory.
 * Binary payloads and source maps are skipped: nothing here is imported.
 * @param asarPath - absolute `app.asar` path.
 * @returns the extracted `node_modules` root, or undefined when the archive has no host tree.
 */
function extractHostFromAsar(asarPath) {
  const stat = statSync(asarPath);
  const key = createHash("sha1").update(`${asarPath}|${stat.size}|${Math.round(stat.mtimeMs)}`).digest("hex").slice(0, 12);
  const cacheDir = join(tmpdir(), "dsh-git-host-asar", key);
  const root = join(cacheDir, ASAR_INNER);
  const ready = join(cacheDir, "ready");
  if (existsSync(ready) && existsSync(join(root, HOST_SENTINEL))) return root;

  const { fd, header, dataOffset } = openAsar(asarPath);
  try {
    if (asarNode(header, `${ASAR_INNER}/@deepseek-ai/dsh-client-connection/package.json`) === undefined) return undefined;
    // Only source/config files are needed to *import* the host: native addons
    // (`unpacked`, kept outside the archive) and their bulky platform
    // directories are skipped, and a `link` entry carries no bytes at all.
    const files = asarFiles(header, ASAR_INNER).filter(
      (entry) => NEEDED_FILE.test(entry.path) && !BULKY_DIR.test(entry.path) && entry.node.unpacked !== true && entry.node.link === undefined
    );
    process.stdout.write(`host-root: extracting ${String(files.length)} host files from app.asar (first run for this build)…`);
    for (const entry of files) {
      const size = Number(entry.node.size);
      const buffer = Buffer.alloc(size);
      readSync(fd, buffer, 0, size, dataOffset + Number(entry.node.offset));
      const dest = join(cacheDir, entry.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buffer);
    }
    writeFileSync(ready, `${key}\n`);
    process.stdout.write(" done\n");
    return root;
  } finally {
    closeSync(fd);
  }
}

let cachedAsarRoot;
let cachedAsarError;
let asarResolved = false;

/** The extracted desktop host root, memoized (undefined when there is no asar). */
function asarHostRoot() {
  if (asarResolved) return cachedAsarRoot;
  asarResolved = true;
  const archive = appAsarPath();
  if (archive === undefined) return undefined;
  try {
    cachedAsarRoot = extractHostFromAsar(archive);
  } catch (error) {
    // A read/extract failure is NOT "no host": remember the reason so the
    // caller can fail loudly rather than skip.
    cachedAsarRoot = undefined;
    cachedAsarError = error;
  }
  return cachedAsarRoot;
}

/**
 * Candidate `node_modules` roots that actually contain a host tree, in priority
 * order. An explicitly set `DSH_GIT_DSH_ROOT` is authoritative and returns alone.
 * @returns absolute directory paths.
 */
export function hostRoots() {
  const override = process.env.DSH_GIT_DSH_ROOT;
  if (typeof override === "string" && override !== "") return [override];
  const roots = profileRoots().filter((root) => existsSync(join(root, HOST_SENTINEL)));
  const asar = asarHostRoot();
  if (asar !== undefined && existsSync(join(asar, HOST_SENTINEL))) roots.push(asar);
  return roots;
}

/** Roots that were tried, for a diagnostic message. */
export function triedRoots() {
  const override = process.env.DSH_GIT_DSH_ROOT;
  if (typeof override === "string" && override !== "") return [override];
  const tried = profileRoots();
  const archive = appAsarPath();
  if (archive !== undefined) tried.push(`${archive} (${ASAR_INNER})`);
  return tried;
}

/**
 * Whether this machine has a dsh install at all. `false` is the only case that
 * may SKIP; a machine that has one and still resolves nothing must fail.
 * @returns true when a profile tree, an asar, or an explicit override is present.
 */
export function hostInstalled() {
  const override = process.env.DSH_GIT_DSH_ROOT;
  if (typeof override === "string" && override !== "") return false; // an override that resolves nothing is a deliberate skip
  if (existsSync(join(dshHomeDir(), "profiles"))) return true;
  return appAsarPath() !== undefined;
}

/**
 * The message to print when nothing resolved. Distinguishes "no install"
 * (skip, exit 0) from "installed but unresolvable" (a real failure).
 * @returns `{ skip }` when the caller should skip, or `{ error }` with the reason to fail.
 */
export function unresolvedHost() {
  const tried = triedRoots().join(", ");
  if (hostInstalled()) {
    return {
      error:
        `an installed dsh host was found on this machine but none of its host packages resolved.\n` +
        `  tried: ${tried}\n` +
        `  ${cachedAsarError === undefined ? "" : `app.asar: ${cachedAsarError.message}\n  `}` +
        `This guard exists to catch host-side regressions; a host that cannot be read is a FAILURE, not a skip.\n` +
        `  Set DSH_GIT_DSH_ROOT to a node_modules tree containing @deepseek-ai/* to point it at another install.`
    };
  }
  return { skip: `no installed dsh profile found (tried: ${tried})` };
}
