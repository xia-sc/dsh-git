// Smoke test for @dsh-plugins/dsh-git (run: node test/smoke.mjs)
// NOTE: this process runs under the session sandbox, where spawning git with
// piped stdio is blocked (EPERM). The git *command set* is verified separately
// against the live server / via pwsh; this file covers everything that does
// not spawn git: channel wiring, endpoint dispatch, argument validation, and
// the client bundle structure.
import { apply } from "../lib/index.js";

let channel = null, handler = null, options = null;
const ctx = {
  connection: {
    rpc: {
      handle(ch, h, o) {
        channel = ch; handler = h; options = o;
        return () => {};
      }
    }
  }
};
apply(ctx);

if (channel !== "/dsh-git-rpc") throw new Error(`channel mismatch: ${channel}`);
if (options?.authority !== "trusted-host") throw new Error(`authority mismatch: ${JSON.stringify(options)}`);
if (typeof handler !== "function") throw new Error("handler not registered");

const call = (endpoint, args) => handler(endpoint, { args }, undefined);

// The transport only accepts protocol enum codes on the wire (see the fail()
// comment in lib/index.js); the plugin's specific code rides in
// error.details.code. Extract it for assertions.
const pluginCode = (res) => (res && res.error && res.error.details ? res.error.details.code : null);

// unknown endpoint
{
  const res = await call("nope", {});
  if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "unknown-endpoint") {
    throw new Error(`expected unknown-endpoint, got ${JSON.stringify(res)}`);
  }
}

// invalid cwd (rejected before any git spawn) for every endpoint
{
  const endpoints = ["status", "branches", "checkout", "createBranch", "fetch", "pull", "commit", "push", "log"];
  for (const ep of endpoints) {
    const res = await call(ep, { cwd: "relative/path" });
    if (res.ok || res.error.code !== "internal" || pluginCode(res) !== "invalid-cwd") {
      throw new Error(`${ep}: expected invalid-cwd, got ${JSON.stringify(res)}`);
    }
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

// invalid commit messages
{
  const evil = ["", "   ", "a\u0000b", "a\nb", "a\tb", "x".repeat(10001)];
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
  console.log("client exports:", Object.keys(mod), "inject:", JSON.stringify(mod.inject));
}

console.log("\nALL NON-SPAWN SMOKE TESTS PASSED");
