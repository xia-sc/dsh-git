// Smoke test for @dsh-plugins/dsh-git (run: node test/smoke.mjs)
// NOTE: this process runs under the session sandbox, where spawning git with
// piped stdio is blocked (EPERM). The git *command set* is verified separately
// against the live server / via pwsh; this file covers everything that does
// not spawn git: route wiring + Connection RPC envelope, endpoint dispatch,
// argument validation, and the client bundle structure.
import { EventEmitter } from "node:events";
import { apply, inject } from "../lib/index.js";

if (!Array.isArray(inject) || !inject.includes("webServer") || !inject.includes("connection") || !inject.includes("llm")) {
  throw new Error(`host inject must declare webServer + connection + llm: ${JSON.stringify(inject)}`);
}

// ── route capture ────────────────────────────────────────────────────────────
// dsh >= 0.1.5-rc.1: the plugin owns the route on `webServer`; calling
// `connection.rpc.handle` from an outside plugin throws
// `cannot get property "webServer" without inject`. Guard against regression.
let route = null;
let reject = undefined;
let effects = 0;
const llm = {
  listProviders: () => [],
  listModels: async () => [],
  stream: async function* () {}
};
const ctx = {
  effect(fn) { effects += 1; return fn(); },
  get(name) {
    if (name !== "connection") return undefined;
    return { requestRejection: () => reject };
  },
  llm,
  connection: {
    rpc: {
      handle() { throw new Error("connection.rpc.handle must not be used on dsh >= 0.1.5-rc.1"); }
    }
  },
  webServer: {
    register(candidate) { route = candidate; return () => { route = null; }; }
  }
};
apply(ctx);

if (route === null) throw new Error("no route registered");
if (route.kind !== "prefix" || route.path !== "/dsh-git-rpc") {
  throw new Error(`unexpected route: ${JSON.stringify({ kind: route.kind, path: route.path })}`);
}
if (typeof route.handler !== "function") throw new Error("route handler missing");
if (effects !== 1) throw new Error(`expected exactly one ctx.effect, got ${effects}`);

// a host without the connection fence must fail loudly, never serve an
// unfenced channel that runs git on caller-supplied paths
{
  let threw = null;
  try {
    apply({
      effect() { throw new Error("must not register effects before the fence check"); },
      get: () => undefined,
      connection: {},
      webServer: { register() { return () => {}; } }
    });
  } catch (error) {
    threw = error;
  }
  if (threw === null || !/0\.1\.5-rc\.1/.test(threw.message)) {
    throw new Error(`apply must refuse an unfenceable host, got ${threw === null ? "no error" : threw.message}`);
  }
}

// ── the browser's own wire envelope, driven through the route handler ────────
let rpcSeq = 0;
async function post(pathname, body, options = {}) {
  const req = new EventEmitter();
  req.url = pathname;
  req.method = options.method ?? "POST";
  req.headers = { "content-type": options.contentType ?? "application/json" };
  req.resume = () => {};
  const res = new EventEmitter();
  const out = [];
  res.writableEnded = false;
  res.statusCode = 0;
  res.setHeader = () => {};
  res.end = (chunk) => {
    if (chunk !== undefined) out.push(String(chunk));
    res.writableEnded = true;
  };
  const pending = route.handler(req, res);
  const text = options.raw ?? JSON.stringify(body);
  if (text !== undefined) req.emit("data", Buffer.from(text, "utf8"));
  req.emit("end");
  await pending;
  return { status: res.statusCode, text: out.join("") };
}

/** One endpoint call exactly as `connection.rpc.call` performs it. */
async function call(endpoint, args, payloadOverride) {
  const rpcId = `smoke-${++rpcSeq}`;
  const { status, text } = await post(`/dsh-git-rpc/${endpoint}`, {
    type: "client-request",
    rpcId,
    method: endpoint,
    payload: payloadOverride !== undefined ? payloadOverride : { args }
  });
  if (status !== 200) throw new Error(`${endpoint}: unexpected HTTP ${status}`);
  const envelope = JSON.parse(text);
  if (envelope.type !== "server-response" || envelope.rpcId !== rpcId) {
    throw new Error(`${endpoint}: bad envelope ${text}`);
  }
  return envelope.result;
}

// The transport only accepts string codes on the wire (see the fail() comment
// in lib/index.js); the plugin's specific code rides in error.details.code.
const pluginCode = (res) => (res && res.error && res.error.details ? res.error.details.code : null);

// protocol-level rejections
{
  const notFound = await post("/dsh-git-rpc/status/../etc", {});
  if (notFound.status !== 404) throw new Error(`traversal path must 404, got ${notFound.status}`);
  const outside = await post("/other/status", {});
  if (outside.status !== 404) throw new Error(`outside channel must 404, got ${outside.status}`);
  const wrongMethod = await post("/dsh-git-rpc/status", {}, { method: "GET" });
  if (wrongMethod.status !== 405) throw new Error(`GET must be 405, got ${wrongMethod.status}`);
  const wrongType = await post("/dsh-git-rpc/status", {}, { contentType: "text/plain" });
  if (wrongType.status !== 415) throw new Error(`text/plain must be 415, got ${wrongType.status}`);
  const badJson = await post("/dsh-git-rpc/status", {}, { raw: "{not json" });
  if (badJson.status !== 400) throw new Error(`bad JSON must be 400, got ${badJson.status}`);
  const badEnvelope = await post("/dsh-git-rpc/status", { type: "nope" });
  if (badEnvelope.status !== 400) throw new Error(`bad envelope must be 400, got ${badEnvelope.status}`);
  const mismatch = await post("/dsh-git-rpc/status", { type: "client-request", rpcId: "x", method: "log", payload: { args: {} } });
  const mismatchBody = JSON.parse(mismatch.text);
  if (mismatch.status !== 200 || mismatchBody.result.error.code !== "gateway/bad-request") {
    throw new Error(`method mismatch must be a bad-request result: ${mismatch.text}`);
  }
}

// the connection fence still applies
{
  reject = 403;
  const denied = await post("/dsh-git-rpc/status", {});
  reject = undefined;
  if (denied.status !== 403) throw new Error(`fenced request must 403, got ${denied.status}`);
  reject = 401;
  const unauthenticated = await post("/dsh-git-rpc/status", {});
  reject = undefined;
  if (unauthenticated.status !== 401) throw new Error(`unauthenticated request must 401, got ${unauthenticated.status}`);
}

// unknown endpoint
{
  const res = await call("nope", {});
  if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "unknown-endpoint") {
    throw new Error(`expected unknown-endpoint, got ${JSON.stringify(res)}`);
  }
}

// invalid cwd (rejected before any git spawn) for every endpoint
{
  const endpoints = ["status", "branches", "checkout", "createBranch", "fetch", "pull", "stage", "diff", "commit", "push", "log", "generateMessage"];
  for (const ep of endpoints) {
    const res = await call(ep, { cwd: "relative/path" });
    if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "invalid-cwd") {
      throw new Error(`${ep}: expected invalid-cwd, got ${JSON.stringify(res)}`);
    }
  }
}

// diff rejects every path that could escape the work tree or read as an option,
// and does so before spawning git
{
  const evil = ["", "  ", 42, null, undefined, {}, "-flag", "--output=/x", "/etc/passwd", "C:/Windows/win.ini", "../outside.txt", "a/../../b", "./a", "a\u0000b", "a\nb", "x".repeat(4100)];
  for (const path of evil) {
    const res = await call("diff", { cwd: "C:/valid/abs", path });
    if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "invalid-path") {
      throw new Error(`evil diff path not rejected: ${JSON.stringify(path)} -> ${JSON.stringify(res)}`);
    }
  }
  const badOrig = await call("diff", { cwd: "C:/valid/abs", path: "src/a.js", origPath: "../x" });
  if (badOrig.ok || pluginCode(badOrig) !== "invalid-path") {
    throw new Error(`evil origPath not rejected: ${JSON.stringify(badOrig)}`);
  }
  // A usable path dispatches to git instead of failing validation. Whether git
  // runs here or the sandbox refuses the spawn, the answer is never invalid-path.
  const dispatched = await call("diff", { cwd: "C:/definitely/not/a/repo", path: "src/a.js" });
  if (pluginCode(dispatched) === "invalid-path" || pluginCode(dispatched) === "invalid-cwd") {
    throw new Error(`a valid path must dispatch to git: ${JSON.stringify(dispatched)}`);
  }
}

// generateMessage validates its mode before reading any diff or calling a model
{
  for (const mode of ["everything", "STAGED", "", 42, {}]) {
    const res = await call("generateMessage", { cwd: "C:/valid/abs", mode });
    if (res.ok || pluginCode(res) !== "invalid-mode") {
      throw new Error(`bad mode not rejected: ${JSON.stringify(mode)} -> ${JSON.stringify(res)}`);
    }
  }
  // An absent mode is valid (it defaults), so it must reach the git read and
  // fail there rather than on validation.
  const res = await call("generateMessage", { cwd: "C:/definitely/not/a/repo" });
  if (pluginCode(res) === "invalid-mode" || pluginCode(res) === "invalid-cwd") {
    throw new Error(`absent mode must default, not reject: ${JSON.stringify(res)}`);
  }
}

// stage reports the caller's bad cwd, never a repo operation
{
  const res = await call("stage", { cwd: "relative/path" });
  if (res.ok || pluginCode(res) !== "invalid-cwd") {
    throw new Error(`stage must validate cwd: ${JSON.stringify(res)}`);
  }
}

// a missing/absent payload must not throw (args default to {})
{
  const res = await call("status", undefined, { args: undefined });
  if (res.ok || pluginCode(res) !== "invalid-cwd") {
    throw new Error(`absent args must still validate cwd: ${JSON.stringify(res)}`);
  }
}

// invalid branch names (rejected before any git spawn)
{
  const evil = ["--help", "-n", "a..b", "a b", "a@{1}", "a\\b", "a:b", "a~b", "a^b", "", "  ", "a".repeat(300), "a'b", "a\"b", "a`b"];
  for (const name of evil) {
    const res = await call("checkout", { cwd: "C:/valid/abs", branch: name });
    if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "invalid-branch") {
      throw new Error(`evil branch not rejected: ${JSON.stringify(name)} -> ${JSON.stringify(res)}`);
    }
  }
}

// invalid new-branch / base names (rejected before any git spawn)
{
  const evil = ["--help", "-n", "a..b", "a b", "a@{1}", "a\\b", "a:b", "a~b", "a^b", "", "  ", "a".repeat(300), "a'b", "a\"b", "a`b"];
  for (const name of evil) {
    const res = await call("createBranch", { cwd: "C:/valid/abs", branch: name, base: "main" });
    if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "invalid-branch") {
      throw new Error(`evil new-branch not rejected: ${JSON.stringify(name)} -> ${JSON.stringify(res)}`);
    }
  }
  for (const base of evil) {
    const res = await call("createBranch", { cwd: "C:/valid/abs", branch: "good-name", base });
    if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "invalid-branch") {
      throw new Error(`evil base not rejected: ${JSON.stringify(base)} -> ${JSON.stringify(res)}`);
    }
  }
  // HEAD (any case) is not a valid new branch name
  for (const name of ["HEAD", "head", "Head"]) {
    const res = await call("createBranch", { cwd: "C:/valid/abs", branch: name, base: "main" });
    if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "invalid-branch") {
      throw new Error(`HEAD new-branch not rejected: ${JSON.stringify(name)} -> ${JSON.stringify(res)}`);
    }
  }
  // Omitted base means HEAD: valid input, so it dispatches to git (which
  // fails here with not-a-repo or git-error — either is fine, but not
  // invalid-branch / invalid-cwd).
  const res = await call("createBranch", { cwd: "C:/definitely/not/a/repo", branch: "good-name" });
  if (res.ok || pluginCode(res) === "invalid-branch" || pluginCode(res) === "invalid-cwd") {
    throw new Error(`createBranch without base should dispatch to git: ${JSON.stringify(res)}`);
  }
}

// invalid remote names
{
  for (const remote of ["", "a b", "-x", "a/b", "a..b", "x".repeat(200), 42, null]) {
    const res = await call("fetch", { cwd: "C:/valid/abs", remote });
    if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "invalid-remote") {
      throw new Error(`evil remote not rejected: ${JSON.stringify(remote)} -> ${JSON.stringify(res)}`);
    }
  }
  // undefined remote is allowed (validRemote(undefined) === true) but never
  // reaches git here because the call is rejected on cwd first in the loop
  // above; just assert a valid absolute cwd with no remote dispatches to git
  // (which will fail with not-a-repo or git-error — either is fine, but not
  // invalid-remote).
  const res = await call("fetch", { cwd: "C:/definitely/not/a/repo" });
  if (res.ok || pluginCode(res) === "invalid-remote") throw new Error(`fetch without remote should not be invalid-remote: ${JSON.stringify(res)}`);
}

// invalid commit messages: empty, over-long, and messages carrying control
// characters. A line feed and a tab are legal (a message may have a body).
{
  const evil = ["", "   ", "\n\n", "a\u0000b", "a\u000bb", "a\u007fb", "a\u001bb", "x".repeat(10001), 42, null, undefined, {}];
  for (const msg of evil) {
    const res = await call("commit", { cwd: "C:/valid/abs", message: msg });
    if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "invalid-message") {
      throw new Error(`evil message not rejected: ${JSON.stringify(msg)} -> ${JSON.stringify(res)}`);
    }
  }
}

// client bundle structure
{
  const windowStub = { __ModuleLoader__: { load(handoff) { globalThis.__handoff = handoff; } } };
  globalThis.window = windowStub;
  await import("../lib/client.js");
  const handoff = globalThis.__handoff;
  if (!handoff || handoff.id !== "@dsh-plugins/dsh-git") throw new Error("client bundle did not self-register");
  const mod = handoff.factory((spec) => {
    if (spec === "react") return { createElement() {}, useState() { return [undefined, () => {}]; }, useEffect() {}, useSyncExternalStore() { return undefined; } };
    throw new Error(`unexpected require: ${spec}`);
  });
  if (typeof mod.apply !== "function") throw new Error("client exports.apply missing");
  if (!Array.isArray(mod.inject) || !["slots", "connection", "locale"].every((k) => mod.inject.includes(k))) {
    throw new Error(`client exports.inject bad: ${JSON.stringify(mod.inject)}`);
  }
  if (mod.name !== "dsh-git") throw new Error(`client exports.name bad: ${JSON.stringify(mod.name)}`);
  console.log("client exports:", Object.keys(mod), "inject:", JSON.stringify(mod.inject));
}

console.log("host inject:", JSON.stringify(inject), "route:", `${route.kind} ${route.path}`);

console.log("\nALL NON-SPAWN SMOKE TESTS PASSED");
