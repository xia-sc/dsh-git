// End-to-end branch-switch test for @xia-sc/dsh-git (run: node test/checkout.mjs).
//
// This is the regression this file exists for: two remotes carry a branch of the
// same name (`origin/main` and `upstream/main`), the panel offers both as full
// remote-tracking refs, and picking the second one must not silently land on the
// first remote's branch or detach HEAD. `git switch --guess upstream/main` fails
// outright, and `git switch --track` refuses to run while a local `main` exists,
// so the host has to decide between a tracking switch and a diagnosed refusal —
// decisions only real git can confirm.
//
// It also pins the `branches` reply shape the panel depends on: the full ref
// (`origin/main`) AND the branch part (`main`), with the per-remote HEAD symref
// filtered out (it is not a branch anyone can switch to).
//
// It needs to spawn git with piped stdio, so it cannot run inside a sandbox
// that blocks that (EPERM). Run it where git is available.
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const rpcId = `checkout-${++rpcSeq}`;
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

/**
 * The current branch name, or `HEAD` when detached — read the way the host reads
 * it (`status --porcelain=v2 --branch`).
 *
 * Deliberately not `rev-parse --abbrev-ref HEAD`: for a local branch that shares
 * its name with a remote-tracking ref, that command answers `heads/origin/main`
 * while git everywhere else (`branch --show-current`, porcelain v2) says
 * `origin/main` — and the second form is what the host reports to the panel.
 */
const currentBranch = async (repo) => {
  const out = await git(repo, ["status", "--porcelain=v2", "--branch"]);
  const line = out.split(/\r?\n/).find((entry) => entry.startsWith("# branch.head "));
  const head = line === undefined ? "" : line.slice("# branch.head ".length).trim();
  return head === "(detached)" || head === "" ? "HEAD" : head;
};

// ── fixture: one `origin`, one `upstream`, both carrying `main` ──────────────
// The second remote is faked with a local bare repository: the point is that two
// *different* remotes expose the same branch name, and a local path remote is
// the only way to build that without a network.
const repo = await mkdtemp(join(tmpdir(), "dsh-git-checkout-"));
const origin = await mkdtemp(join(tmpdir(), "dsh-git-checkout-origin-"));
const other = await mkdtemp(join(tmpdir(), "dsh-git-checkout-upstream-"));
try {
  await git(origin, ["init", "--bare", "--quiet", "--initial-branch=main"]);
  await git(other, ["init", "--bare", "--quiet", "--initial-branch=main"]);
  await git(repo, ["init", "--quiet", "--initial-branch=main"]);
  await git(repo, ["config", "user.name", "dsh-git test"]);
  await git(repo, ["config", "user.email", "dsh-git@example.invalid"]);
  // Windows checkouts would rewrite line endings; the fixtures compare content.
  await git(repo, ["config", "core.autocrlf", "false"]);
  await writeFile(join(repo, "a.txt"), "first\n", "utf8");
  await git(repo, ["add", "--all"]);
  await git(repo, ["commit", "--quiet", "-m", "first"]);
  // `origin` is the tracking remote; `upstream` gets a LATER commit of the same
  // branch, so landing on the wrong one is visible in HEAD.
  await git(repo, ["remote", "add", "origin", origin]);
  await git(repo, ["remote", "add", "upstream", other]);
  await git(repo, ["push", "--quiet", "-u", "origin", "main"]);
  await git(repo, ["push", "--quiet", "upstream", "main"]);
  await writeFile(join(repo, "b.txt"), "second\n", "utf8");
  await git(repo, ["add", "--all"]);
  await git(repo, ["commit", "--quiet", "-m", "second"]);
  await git(repo, ["push", "--quiet", "upstream", "main"]);
  // Fetch both, so `refs/remotes/{origin,upstream}/main` exist and diverge.
  // `fetch --all` also materialises each remote's HEAD symref
  // (`refs/remotes/upstream/HEAD` → `refs/remotes/upstream/main`), which is
  // exactly the entry the `branches` reply has to filter out: it is not a
  // branch anyone can switch to, and listing it produced a bogus half-broken
  // option labelled with the bare remote name.
  await git(repo, ["fetch", "--quiet", "--all"]);
  // Park the work on a differently named branch so the local name `main` is
  // free: the tracking-switch case below only exists while `main` does not yet
  // exist, and a fixture sitting on `main` would silently test nothing.
  await git(repo, ["branch", "--move", "main", "work"]);
  check("the fixture frees the local name main", (await git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).trim().split(/\r?\n/).includes("main") === false);

  const originMain = (await git(repo, ["rev-parse", "refs/remotes/origin/main"])).trim();
  const upstreamMain = (await git(repo, ["rev-parse", "refs/remotes/upstream/main"])).trim();
  check("the fixture's two remotes diverge", originMain !== upstreamMain, `${originMain} vs ${upstreamMain}`);

  // ── `branches` names both refs, and drops the per-remote HEAD symref ───────
  {
    const res = await call("branches", { cwd: repo });
    check("branches succeeds", res.ok === true, JSON.stringify(res));
    const value = res.ok === true ? res.value : { remote: [] };
    const byName = new Map((value.remote || []).map((entry) => [entry.name, entry]));
    for (const ref of ["origin/main", "upstream/main"]) {
      const entry = byName.get(ref);
      check(`branches lists ${ref}`, entry !== undefined, JSON.stringify(value.remote));
      if (entry === undefined) continue;
      // Both the full ref and the branch part: the panel labels with the former
      // and the host's tracked-branch name derives from the latter.
      check(`${ref} carries its remote`, entry.remote === ref.split("/")[0], JSON.stringify(entry));
      check(`${ref} carries the branch part`, entry.branch === "main" && entry.short === "main", JSON.stringify(entry));
    }
    check(
      "branches offers two distinct main options",
      (value.remote || []).filter((entry) => entry.branch === "main").length === 2,
      JSON.stringify(value.remote)
    );
    // `refs/remotes/origin/HEAD` is a symref, not a branch: listing it produced a
    // bogus half-broken option labelled with the remote name.
    check(
      "branches omits the per-remote HEAD symref",
      (value.remote || []).every((entry) => entry.branch !== "HEAD" && entry.name !== "origin/HEAD" && entry.name !== "origin"),
      JSON.stringify(value.remote)
    );
    check("branches reports the parked local branch", (value.local || []).some((entry) => entry.name === "work" && entry.current === true), JSON.stringify(value.local));
    check("branches does not invent a local main yet", (value.local || []).every((entry) => entry.name !== "main"), JSON.stringify(value.local));
  }

  // ── a remote ref with no local namesake starts a tracking branch ──────────
  {
    const res = await call("checkout", { cwd: repo, branch: "origin/main" });
    check("switching to origin/main succeeds", res.ok === true, JSON.stringify(res));
    check("switching to origin/main creates the local main", (await currentBranch(repo)) === "main");
    check("the new local main points at origin/main", (await git(repo, ["rev-parse", "HEAD"])).trim() === originMain);
    check(
      "the new local main tracks origin/main",
      (await git(repo, ["rev-parse", "--abbrev-ref", "main@{upstream}"])).trim() === "origin/main"
    );
  }

  // ── the collision: local `main` exists, tracking the OTHER remote ─────────
  // `--track upstream/main` cannot run (a branch named 'main' already exists),
  // and detaching or clobbering the existing tracking config is not acceptable
  // silently — so this must fail, name both sides, and leave HEAD alone.
  {
    const headBefore = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const res = await call("checkout", { cwd: repo, branch: "upstream/main" });
    check("switching to the colliding remote ref fails", res.ok !== true, JSON.stringify(res));
    check("the collision is diagnosed as checkout-remote-conflict", pluginCode(res) === "checkout-remote-conflict", JSON.stringify(res));
    const message = res.ok === true ? "" : String(res.error.message);
    for (const needle of ["upstream/main", "origin/main", "HEAD 未改动", "新建分支"]) {
      check(`the conflict message mentions ${needle}`, message.includes(needle), message);
    }
    check("the conflict leaves the branch untouched", (await currentBranch(repo)) === "main", await currentBranch(repo));
    check("the conflict leaves HEAD untouched", (await git(repo, ["rev-parse", "HEAD"])).trim() === headBefore);
    check("the conflict does not detach HEAD", (await git(repo, ["symbolic-ref", "--quiet", "HEAD"])).trim() === "refs/heads/main");
    // The tracking configuration is what a silent clobber would have rewritten.
    check(
      "the conflict leaves the upstream config intact",
      (await git(repo, ["rev-parse", "--abbrev-ref", "main@{upstream}"])).trim() === "origin/main"
    );
    const details = res.ok === true ? {} : res.error.details;
    check("the conflict names the local branch", details.local === "main", JSON.stringify(details));
    check("the conflict reports the full upstream ref", details.upstream === "refs/remotes/origin/main", JSON.stringify(details));
  }

  // ── the offered way out works: a new branch based on the other remote ─────
  {
    const res = await call("createBranch", { cwd: repo, branch: "upstream-main", base: "upstream/main" });
    check("creating a branch from upstream/main succeeds", res.ok === true, JSON.stringify(res));
    check("the new branch is checked out", (await currentBranch(repo)) === "upstream-main", await currentBranch(repo));
    check("the new branch starts at upstream/main", (await git(repo, ["rev-parse", "HEAD"])).trim() === upstreamMain);
    // git's own DWIM: a base that names a remote-tracking ref sets up tracking.
    // The point of the assertion is that it is a NEW branch with its own config,
    // not that `main`'s tracking was repointed.
    check(
      "the new branch tracks the base it was created from",
      (await git(repo, ["config", "--get", "branch.upstream-main.merge"])).trim() === "refs/heads/main",
      await git(repo, ["config", "--get", "branch.upstream-main.merge"]).catch(() => "(unset)")
    );
    check(
      "the existing local main keeps its own upstream",
      (await git(repo, ["rev-parse", "--abbrev-ref", "main@{upstream}"])).trim() === "origin/main"
    );
  }

  // ── back to the already-tracked local branch: a plain switch, no detach ───
  {
    const res = await call("checkout", { cwd: repo, branch: "main" });
    check("switching to the local main succeeds", res.ok === true, JSON.stringify(res));
    check("the local main is checked out again", (await currentBranch(repo)) === "main");
    check("the local main still tracks origin/main", (await git(repo, ["rev-parse", "--abbrev-ref", "main@{upstream}"])).trim() === "origin/main");
  }

  // ── a remote ref whose local branch is a NON-tracking namesake ────────────
  // The local branch exists but tracks nothing: still a collision (git cannot
  // reuse the name) and the message must not claim a wrong upstream.
  {
    await git(repo, ["branch", "--unset-upstream", "main"]);
    const headBefore = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const res = await call("checkout", { cwd: repo, branch: "origin/main" });
    check("a same-name local branch without upstream still collides", res.ok !== true && pluginCode(res) === "checkout-remote-conflict", JSON.stringify(res));
    const message = res.ok === true ? "" : String(res.error.message);
    check("the untracked-namesake message says nothing was tracking", message.includes("未跟踪任何远端"), message);
    check("the untracked-namesake message names the local branch", message.includes("本地分支 main"), message);
    check("the untracked-namesake conflict leaves HEAD untouched", (await git(repo, ["rev-parse", "HEAD"])).trim() === headBefore);
    // Restore the tracking config for any later assertion.
    await git(repo, ["branch", "--set-upstream-to=origin/main", "main"]);
  }

  // ── a local branch whose upstream IS the picked ref: plain switch ─────────
  {
    const res = await call("checkout", { cwd: repo, branch: "origin/main" });
    check("re-selecting the tracked remote ref switches to the local branch", res.ok === true, JSON.stringify(res));
    check("re-selecting it does not detach", (await currentBranch(repo)) === "main", await currentBranch(repo));
    check("re-selecting it lands on origin/main's commit", (await git(repo, ["rev-parse", "HEAD"])).trim() === originMain);
  }

  // ── a local branch literally named like a remote-tracking ref ─────────────
  // The switcher sends a bare name for local picks, so this branch arrives on the
  // wire exactly like the remote ref it shadows. git's own DWIM resolves such a
  // name to the local branch (with a "refname is ambiguous" warning), and the
  // host must do the same — treating it as the remote ref would make the branch
  // unreachable from the panel entirely.
  {
    await git(repo, ["branch", "origin/main"]);
    const res = await call("checkout", { cwd: repo, branch: "origin/main" });
    check("a local branch named like a remote ref still checks out", res.ok === true, JSON.stringify(res));
    check("it is checked out as the local branch", (await currentBranch(repo)) === "origin/main", await currentBranch(repo));
    check("it does not detach", (await git(repo, ["symbolic-ref", "--quiet", "HEAD"])).trim() === "refs/heads/origin/main");
    await git(repo, ["switch", "--quiet", "main"]);
    await git(repo, ["branch", "--quiet", "-D", "origin/main"]);
  }

  // ── the fetch path keeps working with a second remote ─────────────────────
  {
    const res = await call("fetch", { cwd: repo });
    check("fetch still succeeds with two remotes", res.ok === true, JSON.stringify(res));
    const one = await call("fetch", { cwd: repo, remote: "upstream" });
    check("fetch of one remote still succeeds", one.ok === true, JSON.stringify(one));
  }
} finally {
  await rm(repo, { recursive: true, force: true });
  await rm(origin, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} CHECKOUT TEST(S) FAILED`);
  process.exit(1);
}
console.log("CHECKOUT END-TO-END TESTS PASSED (duplicate remote names, tracking switch, conflict refusal, new-branch way out)");
