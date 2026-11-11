// End-to-end push test for @xia-sc/dsh-git (run: node test/push.mjs).
//
// This file really spawns git. It drives the plugin's own `/dsh-git-rpc/push`
// endpoint against throwaway repositories whose `origin` is a local bare
// repository, so the whole round trip stays offline:
//
//   1. a branch with no upstream (the state every freshly created branch is in)
//      must be pushed with `--set-upstream`: the remote branch is created and
//      `branch.<name>.remote` / `.merge` start tracking it. Without that the
//      panel failed with git's own
//      "fatal: The current branch … has no upstream branch";
//   2. a branch that already tracks an upstream still pushes normally;
//   3. detached HEAD, no remote, and several remotes without `origin` each
//      report their own diagnostic code instead of a raw push crash, and the
//      ambiguous case pushes nowhere;
//   4. a repository that sets `remote.pushDefault` gets that remote, exactly
//      like a bare `git push` would.
//
// It needs to spawn git with piped stdio, so it cannot run inside a sandbox
// that blocks that (EPERM). Run it where git is available.
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

/** Run git in a fixture directory and resolve stdout (rejects on failure). */
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
/**
 * The optional host services the push endpoint may use for forge discovery.
 * They are off by default, exactly like an older host that has no
 * forge-session, and swapped in per case below.
 */
let optionalServicesEnabled = false;
const forgeCalls = [];
const forgeSession = {
  discoverBranch(session, remote, branch) {
    forgeCalls.push({ session, remote, branch });
    return Promise.resolve();
  }
};
let sessionsById = new Map();
const ctx = {
  effect(fn) { return fn(); },
  get(name) {
    if (name === "connection") return { requestRejection: () => undefined };
    if (name === "llm") return optionalServicesEnabled ? { listProviders: () => [], listModels: async () => [], stream: async function* () {} } : undefined;
    if (!optionalServicesEnabled) return undefined;
    if (name === "sessions") return { get(id) { return sessionsById.get(id); } };
    if (name === "forgeSession") return forgeSession;
    return undefined;
  },
  webServer: { register(candidate) { route = candidate; return () => { route = null; }; } }
};
apply(ctx);
if (route === null) throw new Error("no route registered");

let rpcSeq = 0;
/** One endpoint call exactly as `connection.rpc.call` performs it. */
async function call(endpoint, args) {
  const rpcId = `push-${++rpcSeq}`;
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
const branchOn = async (cwd) => (await git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])).trim();
const headOf = async (cwd) => (await git(cwd, ["rev-parse", "HEAD"])).trim();
const remoteBranches = async (bare) => (await git(bare, ["for-each-ref", "--format=%(refname)", "refs/heads"])).trim();

// ── fixture builders ─────────────────────────────────────────────────────────
const fixtures = [];
/** One throwaway directory; every bare/work repository below lives inside it. */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "dsh-git-push-"));
  fixtures.push(dir);
  return dir;
}
/** A local bare repository — an offline stand-in for origin. */
async function bareRepo(dir, name) {
  const path = join(dir, `${name}.git`);
  await mkdir(path, { recursive: true });
  await git(dir, ["init", "--bare", "--quiet", path]);
  return path;
}
/**
 * A work repository on branch `work` with one commit and no upstream. git's
 * default branch name differs across versions/configurations, so HEAD is
 * pointed at `work` explicitly before the first commit.
 */
async function workRepo(dir) {
  const work = join(dir, "work");
  await mkdir(work);
  await git(work, ["init", "--quiet"]);
  await git(work, ["symbolic-ref", "HEAD", "refs/heads/work"]);
  await git(work, ["config", "user.name", "dsh-git test"]);
  await git(work, ["config", "user.email", "dsh-git@example.invalid"]);
  await writeFile(join(work, "a.txt"), "one\n", "utf8");
  await git(work, ["add", "--all"]);
  await git(work, ["commit", "--quiet", "-m", "first"]);
  return work;
}

try {
  // ── the regression: the first push of a branch with no upstream ────────────
  {
    const dir = await fixture();
    const origin = await bareRepo(dir, "origin");
    const work = await workRepo(dir);
    await git(work, ["remote", "add", "origin", origin]);

    const before = await branchOn(work).catch(() => "");
    check("fixture starts without an upstream", before === "", before);

    const res = await call("push", { cwd: work });
    check("first push of an untracked branch succeeds", res.ok === true, JSON.stringify(res));
    check("first push records the upstream", (await branchOn(work)) === "origin/work");
    check("first push creates the remote branch at HEAD", (await git(origin, ["rev-parse", "refs/heads/work"])).trim() === (await headOf(work)));
    check("first push keeps the branch checked out", (await git(work, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() === "work");

    // A tracked branch now takes the plain `git push` path and moves the ref.
    await writeFile(join(work, "b.txt"), "two\n", "utf8");
    await git(work, ["add", "--all"]);
    await git(work, ["commit", "--quiet", "-m", "second"]);
    const again = await call("push", { cwd: work });
    check("a tracked branch pushes with plain git push", again.ok === true, JSON.stringify(again));
    check("the second push moves the remote branch", (await git(origin, ["rev-parse", "refs/heads/work"])).trim() === (await headOf(work)));
    check("the second push keeps the recorded upstream", (await branchOn(work)) === "origin/work");
  }

  // ── detached HEAD has no branch name to track, and must say so ─────────────
  {
    const dir = await fixture();
    const origin = await bareRepo(dir, "origin");
    const work = await workRepo(dir);
    await git(work, ["remote", "add", "origin", origin]);
    await git(work, ["checkout", "--quiet", "--detach", "HEAD"]);
    const res = await call("push", { cwd: work });
    check("detached HEAD reports detached-head", res.ok !== true && pluginCode(res) === "detached-head", JSON.stringify(res));
    check("detached HEAD pushes nothing", (await remoteBranches(origin)) === "");
  }

  // ── no remote configured: a clear diagnostic, not git's raw fatal ──────────
  {
    const dir = await fixture();
    const work = await workRepo(dir);
    const res = await call("push", { cwd: work });
    check("no remote reports no-remote", res.ok !== true && pluginCode(res) === "no-remote", JSON.stringify(res));
  }

  // ── several remotes and none named origin: refuse to guess ─────────────────
  {
    const dir = await fixture();
    const a = await bareRepo(dir, "a");
    const b = await bareRepo(dir, "b");
    const work = await workRepo(dir);
    await git(work, ["remote", "add", "a", a]);
    await git(work, ["remote", "add", "b", b]);
    const res = await call("push", { cwd: work });
    check("ambiguous remotes report no-remote", res.ok !== true && pluginCode(res) === "no-remote", JSON.stringify(res));
    check("ambiguous remotes push nowhere (a)", (await remoteBranches(a)) === "");
    check("ambiguous remotes push nowhere (b)", (await remoteBranches(b)) === "");
    check("ambiguous remotes record no upstream", await branchOn(work).then(() => false).catch(() => true));
  }

  // ── remote.pushDefault is honoured, exactly like a bare git push ───────────
  {
    const dir = await fixture();
    const a = await bareRepo(dir, "a");
    const b = await bareRepo(dir, "b");
    const work = await workRepo(dir);
    await git(work, ["remote", "add", "a", a]);
    await git(work, ["remote", "add", "b", b]);
    await git(work, ["config", "remote.pushDefault", "b"]);
    const res = await call("push", { cwd: work });
    check("remote.pushDefault push succeeds", res.ok === true, JSON.stringify(res));
    check("pushDefault push lands on the configured remote", (await git(b, ["rev-parse", "refs/heads/work"])).trim() === (await headOf(work)));
    check("pushDefault push records that upstream", (await branchOn(work)) === "b/work");
    check("the other remote stays untouched", (await remoteBranches(a)) === "");
  }
  // ── forge-session discovery: a panel push is not a shell tool call ────────
  // dsh 0.2.2's forge-session only reads `git push` output from bash/pwsh tool
  // events, so the host asks its optional `forgeSession.discoverBranch(...)`
  // service after a successful push. Every missing piece must stay silent.
  {
    const dir = await fixture();
    const origin = await bareRepo(dir, "origin");
    const work = await workRepo(dir);
    await git(work, ["remote", "add", "origin", origin]);
    optionalServicesEnabled = true;
    sessionsById = new Map([["s1", { id: "s1", header: { cwd: work } }]]);
    forgeCalls.length = 0;

    const res = await call("push", { cwd: work, sessionId: "s1" });
    check("push with a session succeeds", res.ok === true, JSON.stringify(res));
    check("a successful push reports the branch to forge-session", forgeCalls.length === 1, JSON.stringify(forgeCalls));
    const reported = forgeCalls[0];
    check("forge-session receives the remote URL", reported !== undefined && reported.remote === origin, JSON.stringify(reported));
    check("forge-session receives the pushed branch", reported !== undefined && reported.branch === "work", JSON.stringify(reported));
    check("forge-session receives the live session object", reported !== undefined && reported.session !== undefined && reported.session.id === "s1", JSON.stringify(reported));

    // A tracking branch may publish a DIFFERENT remote branch name
    // (`branch.<name>.merge`); that name is what forge-session must look up.
    await git(work, ["update-ref", "refs/remotes/origin/remote-work", (await headOf(work))]);
    await git(work, ["config", "branch.work.merge", "refs/heads/remote-work"]);
    await git(work, ["config", "push.default", "upstream"]);
    forgeCalls.length = 0;
    const merged = await call("push", { cwd: work, sessionId: "s1" });
    check("a tracking branch pushes its merge ref", merged.ok === true, JSON.stringify(merged));
    check("forge-session receives the remote branch name", forgeCalls[0] !== undefined && forgeCalls[0].branch === "remote-work", JSON.stringify(forgeCalls));
    await git(work, ["config", "branch.work.merge", "refs/heads/work"]);
    await git(work, ["config", "--unset", "push.default"]);

    // Every unusable or missing piece is silent and never changes the push result.
    forgeCalls.length = 0;
    const noSession = await call("push", { cwd: work });
    const unknownSession = await call("push", { cwd: work, sessionId: "missing" });
    const longSession = await call("push", { cwd: work, sessionId: "x".repeat(201) });
    const nonStringSession = await call("push", { cwd: work, sessionId: 42 });
    sessionsById = new Map([["s2", { id: "s2", header: { cwd: join(dir, "elsewhere") } }]]);
    const otherWorkspace = await call("push", { cwd: work, sessionId: "s2" });
    for (const [label, result] of [
      ["without a session", noSession],
      ["with an unknown session", unknownSession],
      ["with an unusable session id", longSession],
      ["with a non-string session id", nonStringSession],
      ["from another workspace", otherWorkspace]
    ]) {
      check(`push ${label} still succeeds`, result.ok === true, JSON.stringify(result));
    }
    check("no unusable session triggers a discovery", forgeCalls.length === 0, JSON.stringify(forgeCalls));

    // An older host has no forge-session service at all.
    optionalServicesEnabled = false;
    const noForge = await call("push", { cwd: work, sessionId: "s1" });
    check("push succeeds without a forge-session service", noForge.ok === true, JSON.stringify(noForge));
    optionalServicesEnabled = true;
    sessionsById = new Map([["s1", { id: "s1", header: { cwd: work } }]]);

    // A failed push reports nothing to forge-session.
    forgeCalls.length = 0;
    await git(work, ["remote", "set-url", "origin", join(dir, "missing.git")]);
    const failed = await call("push", { cwd: work, sessionId: "s1" });
    check("a failed push reports push-failed", failed.ok !== true && pluginCode(failed) === "push-failed", JSON.stringify(failed));
    check("a failed push triggers no discovery", forgeCalls.length === 0, JSON.stringify(forgeCalls));
  }
} finally {
  for (const dir of fixtures) await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} PUSH TEST(S) FAILED`);
  process.exit(1);
}
console.log("PUSH END-TO-END TESTS PASSED (upstream setup, tracked push, detached HEAD, remote selection, forge-session discovery hints)");
