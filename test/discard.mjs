// End-to-end discard test for @xia-sc/dsh-git (run: node test/discard.mjs).
//
// The one endpoint that deletes working-tree data. Real git is the only way to
// prove its decisions: a staged addition has no HEAD version to restore to (it
// must be unstaged and its file removed), an untracked directory collapses to
// one `? dir/` record, a rename needs BOTH pathspecs, and a conflicted path must
// be refused without touching the merge state.
//
// It needs to spawn git with piped stdio, so it cannot run inside a sandbox
// that blocks that (EPERM). Run it where git is available.
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

/** Run git expecting failure (a conflicting merge is part of the fixture). */
function gitFails(cwd, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf8", windowsHide: true }, () => resolve());
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
  const rpcId = `discard-${++rpcSeq}`;
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
const repo = await mkdtemp(join(tmpdir(), "dsh-git-discard-"));
const read = (name) => readFile(join(repo, name), "utf8");
const status = async () => (await call("status", { cwd: repo })).value;
try {
  await git(repo, ["init", "--quiet"]);
  await git(repo, ["config", "user.name", "dsh-git test"]);
  await git(repo, ["config", "user.email", "dsh-git@example.invalid"]);
  await git(repo, ["config", "core.autocrlf", "false"]);
  await writeFile(join(repo, "a.txt"), "base\n", "utf8");
  await git(repo, ["add", "--all"]);
  await git(repo, ["commit", "--quiet", "-m", "init"]);
  // The default branch name is a user configuration; the fixture must not
  // assume `master` (init.defaultBranch may be `main`).
  const mainBranch = (await git(repo, ["symbolic-ref", "--short", "HEAD"])).trim();

  // ── a modified tracked file goes back to HEAD ─────────────────────────────
  {
    await writeFile(join(repo, "a.txt"), "changed\n", "utf8");
    const res = await call("discard", { cwd: repo, path: "a.txt" });
    check("discard restores a modified file", res.ok === true, JSON.stringify(res));
    check("the file is back at HEAD", (await read("a.txt")) === "base\n");
    check("the tree is clean", (await status()).dirty === 0);
  }

  // ── staged and unstaged sides both go away ────────────────────────────────
  {
    await writeFile(join(repo, "a.txt"), "staged\n", "utf8");
    await git(repo, ["add", "a.txt"]);
    await writeFile(join(repo, "a.txt"), "staged+unstaged\n", "utf8");
    const res = await call("discard", { cwd: repo, path: "a.txt" });
    check("discard drops both sides of one file", res.ok === true, JSON.stringify(res));
    check("both sides are back at HEAD", (await read("a.txt")) === "base\n");
    check("the index is clean too", (await status()).dirty === 0);
  }

  // ── a deleted tracked file comes back ─────────────────────────────────────
  {
    await rm(join(repo, "a.txt"));
    check("the file is really gone", !existsSync(join(repo, "a.txt")));
    const res = await call("discard", { cwd: repo, path: "a.txt" });
    check("discard restores a deleted file", res.ok === true, JSON.stringify(res));
    check("the deleted file is back", existsSync(join(repo, "a.txt")) && (await read("a.txt")) === "base\n");
  }

  // ── an untracked file is removed, not restored ────────────────────────────
  {
    await writeFile(join(repo, "new.txt"), "n\n", "utf8");
    const res = await call("discard", { cwd: repo, path: "new.txt" });
    check("discard removes an untracked file", res.ok === true, JSON.stringify(res));
    check("the untracked file is gone", !existsSync(join(repo, "new.txt")));
  }

  // ── an untracked DIRECTORY is dropped with clean -d ──────────────────────
  {
    await mkdir(join(repo, "dir", "sub"), { recursive: true });
    await writeFile(join(repo, "dir", "one.txt"), "1\n", "utf8");
    await writeFile(join(repo, "dir", "sub", "two.txt"), "2\n", "utf8");
    const dirStatus = await status();
    const entry = dirStatus.changes.find((change) => change.file === "dir/" || change.path === "dir/");
    check("status collapses the untracked directory", entry !== undefined, JSON.stringify(dirStatus.changes));
    const res = await call("discard", { cwd: repo, path: "dir/" });
    check("discard removes an untracked directory", res.ok === true, JSON.stringify(res));
    check("the directory is gone", !existsSync(join(repo, "dir")));
  }

  // ── a staged addition is unstaged and its file deleted ───────────────────
  {
    await writeFile(join(repo, "added.txt"), "a\n", "utf8");
    await git(repo, ["add", "added.txt"]);
    const before = await status();
    check("status reports the staged addition", before.changes.some((change) => change.status === "added"), JSON.stringify(before.changes));
    const res = await call("discard", { cwd: repo, path: "added.txt" });
    check("discard drops a staged addition", res.ok === true, JSON.stringify(res));
    check("the added file is gone", !existsSync(join(repo, "added.txt")));
    check("the index has no leftover", (await status()).dirty === 0);
  }

  // ── a staged rename is undone on BOTH sides ──────────────────────────────
  {
    await git(repo, ["mv", "a.txt", "renamed.txt"]);
    const before = await status();
    const renamed = before.changes.find((change) => change.status === "renamed");
    check("status reports the rename", renamed !== undefined, JSON.stringify(before.changes));
    const res = await call("discard", { cwd: repo, path: renamed.file, origPath: renamed.origFile });
    check("discard undoes a rename", res.ok === true, JSON.stringify(res));
    check("the original path is back", existsSync(join(repo, "a.txt")) && (await read("a.txt")) === "base\n");
    check("the renamed path is gone", !existsSync(join(repo, "renamed.txt")));
    check("the tree is clean after the rename discard", (await status()).dirty === 0);
  }

  // ── a conflicted path is refused and left untouched ──────────────────────
  {
    await git(repo, ["switch", "--quiet", "-c", "other"]);
    await writeFile(join(repo, "a.txt"), "other-side\n", "utf8");
    await git(repo, ["add", "a.txt"]);
    await git(repo, ["commit", "--quiet", "-m", "other"]);
    await git(repo, ["switch", "--quiet", mainBranch]);
    await writeFile(join(repo, "a.txt"), "main-side\n", "utf8");
    await git(repo, ["add", "a.txt"]);
    await git(repo, ["commit", "--quiet", "-m", "main"]);
    await gitFails(repo, ["merge", "other"]);
    const conflicted = await status();
    check("the fixture produced a conflict", conflicted.changes.some((change) => change.status === "conflict"), JSON.stringify(conflicted.changes));
    const conflictPath = conflicted.changes.find((change) => change.status === "conflict").file;
    const beforeText = await read(conflictPath);
    const res = await call("discard", { cwd: repo, path: conflictPath });
    check("a conflicted path is refused", res.ok !== true && pluginCode(res) === "discard-conflict", JSON.stringify(res));
    check("the conflict is untouched", (await read(conflictPath)) === beforeText);
    await git(repo, ["reset", "--hard", "HEAD"]);
    await git(repo, ["branch", "-D", "other"]);
  }

  // ── nothing to discard ────────────────────────────────────────────────────
  {
    const res = await call("discard", { cwd: repo, path: "a.txt" });
    check("a clean path reports no-changes", res.ok !== true && pluginCode(res) === "no-changes", JSON.stringify(res));
  }

  // ── outside a work tree ───────────────────────────────────────────────────
  {
    const plain = await mkdtemp(join(tmpdir(), "dsh-git-discard-plain-"));
    try {
      const res = await call("discard", { cwd: plain, path: "a.txt" });
      check("discard outside a repository reports not-a-repo", res.ok !== true && pluginCode(res) === "not-a-repo", JSON.stringify(res));
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  }
} finally {
  await rm(repo, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} DISCARD TEST(S) FAILED`);
  process.exit(1);
}
console.log("DISCARD END-TO-END TESTS PASSED (modified, staged+unstaged, deletion, untracked file/dir, staged addition, rename, conflict refusal, no-changes)");
