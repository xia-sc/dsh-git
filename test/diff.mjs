// End-to-end diff test for @dsh-plugins/dsh-git (run: node test/diff.mjs).
//
// Unlike test/smoke.mjs, this file really spawns git: it drives the plugin's own
// `/dsh-git-rpc/diff` route against a throwaway repository and asserts what the
// viewer would render for every shape the change list can produce — a modified
// file, a staged file, an untracked file, an untracked directory, a rename, a
// deletion, a binary blob, and a diff past the truncation cap.
//
// The rename case is the one that cannot be checked any other way: git only
// pairs the two names when BOTH are in the pathspec, and getting that wrong
// turns a one-line rename into a whole-file addition.
//
// It needs to spawn git with piped stdio, so it cannot run inside a sandbox that
// blocks that (EPERM). Run it where git is available.
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";

let failures = 0;
function check(label, condition, detail) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

/** Run git in the fixture repo and resolve stdout (rejects on failure). */
function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`${args.join(" ")}: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// ── mount the plugin's route, capturing the handler ──────────────────────────
let route = null;
const ctx = {
  effect(fn) { return fn(); },
  get(name) { return name === "connection" ? { requestRejection: () => undefined } : undefined; },
  llm: { listProviders: () => [], listModels: async () => [], stream: async function* () {} },
  webServer: { register(candidate) { route = candidate; return () => { route = null; }; } }
};
apply(ctx);
if (route === null) throw new Error("no route registered");

let rpcSeq = 0;
/** One endpoint call exactly as `connection.rpc.call` performs it. */
async function call(endpoint, args) {
  const rpcId = `diff-${++rpcSeq}`;
  const req = new EventEmitter();
  req.url = `/dsh-git-rpc/${endpoint}`;
  req.method = "POST";
  req.headers = { "content-type": "application/json" };
  req.resume = () => {};
  const res = new EventEmitter();
  const out = [];
  res.writableEnded = false;
  res.statusCode = 0;
  res.setHeader = () => {};
  res.end = (chunk) => { if (chunk !== undefined) out.push(String(chunk)); res.writableEnded = true; };
  const pending = route.handler(req, res);
  req.emit("data", Buffer.from(JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload: { args } }), "utf8"));
  req.emit("end");
  await pending;
  const envelope = JSON.parse(out.join(""));
  if (envelope.type !== "server-response" || envelope.rpcId !== rpcId) {
    throw new Error(`${endpoint}: bad envelope ${out.join("")}`);
  }
  return envelope.result;
}

const pluginCode = (res) => (res && res.error && res.error.details ? res.error.details.code : null);

// ── fixture repository ───────────────────────────────────────────────────────
const repo = await mkdtemp(join(tmpdir(), "dsh-git-diff-"));
try {
  await git(repo, ["init", "--quiet"]);
  await git(repo, ["config", "user.name", "dsh-git test"]);
  await git(repo, ["config", "user.email", "dsh-git@example.invalid"]);
  // Keep git from rewriting line endings under the test's feet on Windows.
  await git(repo, ["config", "core.autocrlf", "false"]);

  /** Read one side of the endpoint's value for a path. */
  async function diffOf(path, origPath) {
    const res = await call("diff", origPath === undefined ? { cwd: repo, path } : { cwd: repo, path, origPath });
    if (res.ok !== true) throw new Error(`diff ${path}: ${JSON.stringify(res)}`);
    return res.value;
  }

  // ── a modified tracked file: worktree side only ────────────────────────────
  {
    await writeFile(join(repo, "a.txt"), "line1\nline2\nline3\n", "utf8");
    await git(repo, ["add", "--all"]);
    await git(repo, ["commit", "--quiet", "-m", "init"]);
    await writeFile(join(repo, "a.txt"), "line1\nline2\nline3\nline4\n", "utf8");
    const value = await diffOf("a.txt");
    check("modified: repo flag", value.repo === true, JSON.stringify(value));
    check("modified: worktree has the new line", value.worktree.diff.includes("+line4"), value.worktree.diff);
    check("modified: worktree reports one addition", value.worktree.diff.includes("@@ -1,3 +1,4 @@"), value.worktree.diff);
    check("modified: worktree is not binary", value.worktree.binary === false);
    check("modified: nothing staged", value.index.diff.trim() === "", JSON.stringify(value.index));
    check("modified: not untracked", value.untracked === false);
    check("modified: path echoed", value.path === "a.txt", value.path);
  }

  // ── the same file staged: index side only, worktree empty ──────────────────
  {
    await git(repo, ["add", "--all"]);
    const value = await diffOf("a.txt");
    check("staged: index carries the change", value.index.diff.includes("+line4"), value.index.diff);
    check("staged: worktree is empty", value.worktree.diff.trim() === "", JSON.stringify(value.worktree));
    await git(repo, ["commit", "--quiet", "-m", "add line4"]);
  }

  // ── an untracked file: diffed against the empty blob ──────────────────────
  {
    await writeFile(join(repo, "fresh.txt"), "brand\nnew\n", "utf8");
    const value = await diffOf("fresh.txt");
    check("untracked: flagged", value.untracked === true, JSON.stringify(value));
    check("untracked: reads as a new file", value.worktree.diff.includes("new file mode"), value.worktree.diff);
    check("untracked: content is the addition", value.worktree.diff.includes("+brand"), value.worktree.diff);
    check("untracked: hunk starts at 0,0", value.worktree.diff.includes("@@ -0,0 +1,2 @@"), value.worktree.diff);
    check("untracked: nothing staged", value.index.diff.trim() === "");
  }

  // ── an untracked directory: every file inside it, not just its name ───────
  {
    await mkdir(join(repo, "sub"), { recursive: true });
    await writeFile(join(repo, "sub", "one.txt"), "one\n", "utf8");
    await writeFile(join(repo, "sub", "two.txt"), "two\n", "utf8");
    const value = await diffOf("sub/");
    check("untracked dir: flagged", value.untracked === true, JSON.stringify(value));
    check("untracked dir: expands the first file", value.worktree.diff.includes("b/sub/one.txt"), value.worktree.diff);
    check("untracked dir: expands the second file", value.worktree.diff.includes("b/sub/two.txt"), value.worktree.diff);
    check("untracked dir: nothing skipped", value.skipped === 0, String(value.skipped));
  }

  // ── a rename: both names in the pathspec, or git reports an addition ──────
  {
    await git(repo, ["mv", "a.txt", "renamed.txt"]);
    const withOrig = await diffOf("renamed.txt", "a.txt");
    check("rename: index pairs the two names", /rename from a\.txt/.test(withOrig.index.diff) && /rename to renamed\.txt/.test(withOrig.index.diff), withOrig.index.diff);
    check("rename: origPath echoed", withOrig.origPath === "a.txt", String(withOrig.origPath));
    const withoutOrig = await diffOf("renamed.txt");
    check("rename: the new name alone is not a rename", !/rename from/.test(withoutOrig.index.diff), withoutOrig.index.diff);
    await git(repo, ["commit", "--quiet", "-m", "rename"]);
  }

  // ── a deletion: the worktree side removes lines ───────────────────────────
  {
    await rm(join(repo, "renamed.txt"));
    const value = await diffOf("renamed.txt");
    check("deleted: worktree shows the removal", value.worktree.diff.includes("-line1"), value.worktree.diff);
    check("deleted: reports a deletion header", value.worktree.diff.includes("deleted file mode"), value.worktree.diff);
    await git(repo, ["add", "--all"]);
    await git(repo, ["commit", "--quiet", "-m", "delete"]);
  }

  // ── a binary file: flagged, with git's placeholder text ───────────────────
  {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x00, 0x10]);
    await writeFile(join(repo, "blob.bin"), binary);
    await git(repo, ["add", "--all"]);
    await git(repo, ["commit", "--quiet", "-m", "add blob"]);
    await writeFile(join(repo, "blob.bin"), Buffer.concat([binary, Buffer.from([0x00, 0x20, 0x21])]));
    const value = await diffOf("blob.bin");
    check("binary: worktree flagged", value.worktree.binary === true, JSON.stringify(value.worktree));
    check("binary: git's own placeholder is what is sent", /Binary files .* differ/.test(value.worktree.diff), value.worktree.diff);
    await git(repo, ["checkout", "--", "blob.bin"]);
  }

  // ── a diff past the cap: truncated at a line boundary, never mid-line ─────
  {
    const base = [];
    for (let i = 0; i < 6000; i += 1) base.push(`line-${i}-${"x".repeat(40)}`);
    await writeFile(join(repo, "big.txt"), `${base.join("\n")}\n`, "utf8");
    await git(repo, ["add", "--all"]);
    await git(repo, ["commit", "--quiet", "-m", "add big"]);
    // Rewrite every line AND append as many again, so the patch itself — not
    // just the file — is comfortably past the cap.
    const grown = base.map((line) => `v2-${line}`);
    for (let i = 6000; i < 12000; i += 1) grown.push(`line-${i}-${"y".repeat(40)}`);
    await writeFile(join(repo, "big.txt"), `${grown.join("\n")}\n`, "utf8");
    const value = await diffOf("big.txt");
    check("truncated: flagged", value.worktree.truncated === true, `${value.worktree.diff.length} bytes`);
    check("truncated: bounded near the cap", value.worktree.diff.length <= 400000, String(value.worktree.diff.length));
    const lastLine = value.worktree.diff.slice(value.worktree.diff.lastIndexOf("\n") + 1);
    check("truncated: cut at a line boundary", /^[ +\-\\@]/.test(lastLine) && lastLine.length > 1, JSON.stringify(lastLine));
    await git(repo, ["checkout", "--", "big.txt"]);
  }

  // ── an unchanged file: both sides empty, and no untracked fallback ────────
  {
    const value = await diffOf("big.txt");
    check("clean file: worktree empty", value.worktree.diff.trim() === "");
    check("clean file: index empty", value.index.diff.trim() === "");
    check("clean file: not untracked", value.untracked === false);
  }

  // ── validation happens before any git spawn ───────────────────────────────
  {
    for (const path of ["", "   ", 42, null, undefined, "-flag", "/etc/passwd", "C:/Windows/win.ini", "../outside.txt", "a/../../b", "a\u0000b"]) {
      const res = await call("diff", { cwd: repo, path });
      check(`evil path rejected: ${JSON.stringify(path)}`, res.ok !== true && pluginCode(res) === "invalid-path", JSON.stringify(res));
    }
    const badOrig = await call("diff", { cwd: repo, path: "a.txt", origPath: "../x" });
    check("evil origPath rejected", badOrig.ok !== true && pluginCode(badOrig) === "invalid-path", JSON.stringify(badOrig));
    const badCwd = await call("diff", { cwd: "relative/path", path: "a.txt" });
    check("bad cwd rejected", badCwd.ok !== true && pluginCode(badCwd) === "invalid-cwd", JSON.stringify(badCwd));
  }

  // ── outside a work tree: repo:false, not an error ─────────────────────────
  {
    const outside = await mkdtemp(join(tmpdir(), "dsh-git-norepo-"));
    try {
      const res = await call("diff", { cwd: outside, path: "a.txt" });
      check("outside a work tree reports repo:false", res.ok === true && res.value.repo === false, JSON.stringify(res));
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }
} finally {
  await rm(repo, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} DIFF TEST(S) FAILED`);
  process.exit(1);
}
console.log("DIFF END-TO-END TESTS PASSED (worktree/index sides, untracked file + directory, rename pairing, deletion, binary, truncation, validation)");
