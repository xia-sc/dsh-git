// End-to-end commit test for @dsh-plugins/dsh-git (run: node test/commit.mjs).
//
// Unlike test/smoke.mjs, this file really spawns git: it drives the plugin's
// own `/dsh-git-rpc/commit` route against a throwaway repository and reads the
// message back with `git log --format=%B`. That round trip is the only way to
// catch the regression this test exists for — a subject+body message being
// rejected (or mangled by argv quoting) before git ever records it.
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
  const rpcId = `commit-${++rpcSeq}`;
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
const repo = await mkdtemp(join(tmpdir(), "dsh-git-commit-"));
try {
  await git(repo, ["init", "--quiet"]);
  await git(repo, ["config", "user.name", "dsh-git test"]);
  await git(repo, ["config", "user.email", "dsh-git@example.invalid"]);

  /** Stage one new file so the next commit has something to record. */
  async function stageOne(name) {
    await writeFile(join(repo, name), `${name}\n`, "utf8");
    await git(repo, ["add", "--all"]);
  }

  const headMessage = async () => (await git(repo, ["log", "-1", "--format=%B"])).replace(/\n+$/, "");

  // ── the regression: a subject + body message must commit verbatim ──────────
  // This is exactly the shape `generateMessage` asks the model for, and the
  // shape the panel's ✨ button fills in.
  for (const [label, message, expected] of [
    ["single line", "feat: add single line", "feat: add single line"],
    ["subject + body", "feat: add body\n\nIt explains why.\n\nAnd more.", "feat: add body\n\nIt explains why.\n\nAnd more."],
    ["no blank separator", "subject\nbody", "subject\nbody"],
    ["CRLF from a Windows draft", "subject\r\n\r\nbody", "subject\n\nbody"],
    ["extra blank lines collapse", "subject\n\n\n\nbody", "subject\n\nbody"],
    ["leading/trailing blanks stripped", "\n\nsubject\n\nbody\n\n\n", "subject\n\nbody"],
    ["indented body line keeps its tab", "subject\n\n\tindented", "subject\n\n\tindented"],
    ["unicode subject", "feat: 支持多行提交信息\n\n正文说明", "feat: 支持多行提交信息\n\n正文说明"],
    ["leading dash is data, not a flag", "--amend is not run", "--amend is not run"],
    ["message with quotes", 'fix: handle "quoted" and \'single\' text', 'fix: handle "quoted" and \'single\' text'],
    ["message with shell metacharacters", "fix: a && b | c > d ; rm -rf /", "fix: a && b | c > d ; rm -rf /"],
    ["message with a percent sign", "fix: 100% done", "fix: 100% done"]
  ]) {
    await stageOne(`${label.replace(/[^a-z0-9]+/gi, "-")}.txt`);
    const res = await call("commit", { cwd: repo, message });
    if (res.ok !== true) {
      check(`commit records ${label}`, false, JSON.stringify(res));
      continue;
    }
    const recorded = await headMessage();
    check(`commit records ${label} byte-for-byte`, recorded === expected, `expected ${JSON.stringify(expected)}, recorded ${JSON.stringify(recorded)}`);
  }

  // ── rejected messages never create a commit ────────────────────────────────
  for (const [label, message] of [
    ["empty", ""],
    ["whitespace only", "   \n  "],
    ["NUL", "a\u0000b"],
    ["escape", "a\u001bb"],
    ["DEL", "a\u007fb"],
    ["over-long", "x".repeat(10001)],
    ["not a string", 42]
  ]) {
    const before = await git(repo, ["rev-parse", "HEAD"]);
    const res = await call("commit", { cwd: repo, message });
    check(`reject ${label}`, res.ok !== true && pluginCode(res) === "invalid-message", JSON.stringify(res));
    const after = await git(repo, ["rev-parse", "HEAD"]);
    check(`reject ${label} creates no commit`, before === after);
  }

  // ── a commit with nothing staged fails cleanly, keeping git's own words ────
  {
    const res = await call("commit", { cwd: repo, message: "nothing staged" });
    check("clean tree reports commit-failed", res.ok !== true && pluginCode(res) === "commit-failed", JSON.stringify(res));
  }
} finally {
  await rm(repo, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} COMMIT TEST(S) FAILED`);
  process.exit(1);
}
console.log("COMMIT END-TO-END TESTS PASSED (message shapes, rejection, clean-tree failure)");
