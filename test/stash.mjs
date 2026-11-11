// End-to-end stash test for @xia-sc/dsh-git (run: node test/stash.mjs).
//
// Drives the plugin's own `/dsh-git-rpc/stash`, `/stashPop` and `/status`
// routes against a throwaway repository. The interesting behaviours cannot be
// checked by a fake: `git stash push` reports "nothing to stash" as SUCCESS, an
// untracked-only tree is not stashable without `-u`, and a conflicting pop
// keeps the stash entry on purpose. Only real git answers those.
//
// It needs to spawn git with piped stdio, so it cannot run inside a sandbox
// that blocks that (EPERM). Run it where git is available.
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const rpcId = `stash-${++rpcSeq}`;
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
const repo = await mkdtemp(join(tmpdir(), "dsh-git-stash-"));
const read = (name) => readFile(join(repo, name), "utf8");
try {
  await git(repo, ["init", "--quiet"]);
  await git(repo, ["config", "user.name", "dsh-git test"]);
  await git(repo, ["config", "user.email", "dsh-git@example.invalid"]);
  await git(repo, ["config", "core.autocrlf", "false"]);
  await writeFile(join(repo, "tracked.txt"), "base\n", "utf8");
  await git(repo, ["add", "--all"]);
  await git(repo, ["commit", "--quiet", "-m", "init"]);

  const status = async () => (await call("status", { cwd: repo })).value;

  // ── nothing to stash is a stable code, not a fake success ──────────────────
  {
    const res = await call("stash", { cwd: repo, message: "nothing" });
    check("stash with no changes reports no-changes", res.ok !== true && pluginCode(res) === "no-changes", JSON.stringify(res));
  }

  // ── tracked change → stash → status → pop ─────────────────────────────────
  {
    await writeFile(join(repo, "tracked.txt"), "changed\n", "utf8");
    const stashed = await call("stash", { cwd: repo, message: "work one" });
    check("stash with a tracked change succeeds", stashed.ok === true, JSON.stringify(stashed));
    const afterStash = await status();
    check("stash leaves the worktree clean", afterStash.dirty === 0, JSON.stringify(afterStash.dirty));
    check("status lists the stash entry", afterStash.stashes.length === 1, JSON.stringify(afterStash.stashes));
    check("the stash ref is the exact shape", afterStash.stashes[0].ref === "stash@{0}", JSON.stringify(afterStash.stashes));
    check("the message reached the subject", /work one/.test(afterStash.stashes[0].subject), afterStash.stashes[0].subject);

    const popped = await call("stashPop", { cwd: repo, ref: afterStash.stashes[0].ref });
    check("stashPop restores the entry", popped.ok === true, JSON.stringify(popped));
    const restored = await status();
    check("the restored entry is gone", restored.stashes.length === 0, JSON.stringify(restored.stashes));
    check("the tracked change came back", (await read("tracked.txt")) === "changed\n");
    await git(repo, ["checkout", "--", "tracked.txt"]);
  }

  // ── an untracked-only tree is not stashable without -u ────────────────────
  {
    await writeFile(join(repo, "untracked.txt"), "u\n", "utf8");
    const res = await call("stash", { cwd: repo, message: "only untracked" });
    check("untracked-only tree reports no-changes", res.ok !== true && pluginCode(res) === "no-changes", JSON.stringify(res));
    check("the untracked file stays", existsSync(join(repo, "untracked.txt")));

    const withUntracked = await call("stash", { cwd: repo, message: "with untracked", includeUntracked: true });
    check("includeUntracked stashes the untracked file", withUntracked.ok === true, JSON.stringify(withUntracked));
    check("the untracked file is gone after stash -u", !existsSync(join(repo, "untracked.txt")));
    const listed = await status();
    check("the -u stash is listed", listed.stashes.length === 1, JSON.stringify(listed.stashes));
    const popped = await call("stashPop", { cwd: repo, ref: listed.stashes[0].ref });
    check("popping an untracked stash restores it", popped.ok === true && existsSync(join(repo, "untracked.txt")), JSON.stringify(popped));
    await rm(join(repo, "untracked.txt"), { force: true });
  }

  // ── a missing entry is reported as missing, not as a git failure ──────────
  {
    const res = await call("stashPop", { cwd: repo, ref: "stash@{9}" });
    check("a missing stash reports stash-missing", res.ok !== true && pluginCode(res) === "stash-missing", JSON.stringify(res));
  }

  // ── a dirty worktree blocks the pop before anything is touched ───────────
  // git refuses to replay a stash over uncommitted changes and aborts; the entry
  // stays and nothing in the tree changes. A plain "git failed" would make the
  // user think the stash was consumed, so this has its own code and wording.
  {
    await writeFile(join(repo, "tracked.txt"), "stash-side\n", "utf8");
    const stashed = await call("stash", { cwd: repo, message: "blocked by dirt" });
    check("the stash for the blocked case is created", stashed.ok === true, JSON.stringify(stashed));
    await writeFile(join(repo, "tracked.txt"), "worktree-side\n", "utf8");
    const res = await call("stashPop", { cwd: repo, ref: "stash@{0}" });
    check("a dirty worktree reports stash-blocked", res.ok !== true && pluginCode(res) === "stash-blocked", JSON.stringify(res));
    check("the blocked stash is kept", (await status()).stashes.length === 1);
    check("the worktree change is untouched", (await read("tracked.txt")) === "worktree-side\n");
    await git(repo, ["checkout", "--", "tracked.txt"]);
    await git(repo, ["stash", "drop", "stash@{0}"]);
  }

  // ── a real conflict keeps the stash and leaves the conflict behind ───────
  // A conflicting pop needs the OTHER side to be a commit: with only dirty
  // working-tree changes git aborts before merging (the case above).
  {
    await writeFile(join(repo, "tracked.txt"), "stash-side\n", "utf8");
    const stashed = await call("stash", { cwd: repo, message: "conflicting" });
    check("the conflicting stash is created", stashed.ok === true, JSON.stringify(stashed));
    await writeFile(join(repo, "tracked.txt"), "committed-side\n", "utf8");
    await git(repo, ["add", "tracked.txt"]);
    await git(repo, ["commit", "--quiet", "-m", "change after stash"]);
    const res = await call("stashPop", { cwd: repo, ref: "stash@{0}" });
    check("a conflicting pop reports stash-conflict", res.ok !== true && pluginCode(res) === "stash-conflict", JSON.stringify(res));
    const after = await status();
    check("a conflicting pop keeps the stash entry", after.stashes.length === 1, JSON.stringify(after.stashes));
    const text = await read("tracked.txt");
    check("the conflict is left in the working tree", text.includes("<<<<<<<"), text.slice(0, 120));
    await git(repo, ["reset", "--hard", "HEAD"]);
    await git(repo, ["stash", "drop", "stash@{0}"]);
  }

  // ── outside a work tree ───────────────────────────────────────────────────
  {
    const plain = await mkdtemp(join(tmpdir(), "dsh-git-stash-plain-"));
    try {
      const res = await call("stash", { cwd: plain, message: "x" });
      check("stash outside a repository reports not-a-repo", res.ok !== true && pluginCode(res) === "not-a-repo", JSON.stringify(res));
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  }
} finally {
  await rm(repo, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} STASH TEST(S) FAILED`);
  process.exit(1);
}
console.log("STASH END-TO-END TESTS PASSED (push -m, status list, untracked policy, pop, missing ref, conflict keeps the entry)");
