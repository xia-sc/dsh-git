// Render-time test for the dsh-git floating panel + dock line using REAL
// React (react-dom/server). Verifies both slot registrations and that the
// components' initial renders do not crash.
// Run: node test/render.mjs
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// React is not a dependency of this plugin: the browser bundle borrows the
// shell's own `react` seed word. The test therefore loads a copy from an
// explicit DSH_GIT_REACT_ROOT, the installed DSH profile, or an npx cache; when
// none is present it reports SKIP instead of failing the checkout.
function loadReact() {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const roots = [
    process.env.DSH_GIT_REACT_ROOT,
    join(dshHome, "profiles", "web", "node_modules"),
    join(dshHome, "profiles", "node_modules"),
    "D:/tool/npm/cache/_npx/1e7f6d9597241db0/node_modules"
  ].filter((root) => typeof root === "string" && root !== "");
  const failures = [];
  for (const root of roots) {
    if (!existsSync(join(root, "react", "package.json"))) continue;
    try {
      const req = createRequire(join(root, "resolve-anchor.js"));
      return { React: req("react"), server: req("react-dom/server"), root };
    } catch (error) {
      failures.push(`${root}: ${error.message}`);
    }
  }
  try {
    const req = createRequire(import.meta.url);
    return { React: req("react"), server: req("react-dom/server"), root: "(node resolution)" };
  } catch (error) {
    failures.push(`node resolution: ${error.message}`);
  }
  return { skip: failures };
}

const reactResolution = loadReact();
if (reactResolution.skip !== undefined) {
  console.log("SKIP: react/react-dom not found for the render test; set DSH_GIT_REACT_ROOT to a node_modules that has them.");
  for (const failure of reactResolution.skip) console.log(`  tried ${failure}`);
  process.exit(0);
}
const { React, server: ReactDOMServer, root: reactRoot } = reactResolution;
const { renderToStaticMarkup } = ReactDOMServer;

// Load the client bundle through the module-loader handoff.
globalThis.window = {
  __ModuleLoader__: { load(handoff) { globalThis.__handoff = handoff; } }
};
await import("../lib/client.js");
const handoff = globalThis.__handoff;
if (!handoff) throw new Error("no handoff");

// The factory's require must return the real React (module-table seed word).
const mod = handoff.factory((spec) => {
  if (spec === "react") return React;
  throw new Error(`unexpected require: ${spec}`);
});

// Capture the slot registrations performed by apply(). The rpc stub answers
// the three load endpoints so the expanded seats render real content.
const calls = [];
const registrations = [];
let activeReg = null;
const ctx = {
  effect() { return () => {}; },
  locale: { register() { return () => {}; } },
  connection: {
    rpc: {
      call: async (channel, endpoint) => {
        calls.push(`${channel}/${endpoint}`);
        if (endpoint === "status") {
          return { ok: true, value: { repo: true, branch: "main", detached: false, oid: "abc1234", upstream: "origin/main", ahead: 1, behind: 0, dirty: 2, changes: [{ status: "modified", path: "src/a.js" }, { status: "untracked", path: "b.txt" }] } };
        }
        if (endpoint === "branches") {
          return { ok: true, value: { repo: true, current: "main", local: [{ name: "main", current: true, sha: "abc1234", upstream: "origin/main" }, { name: "dev", current: false, sha: "def5678", upstream: null }], remote: [{ name: "origin/main", short: "main" }] } };
        }
        if (endpoint === "log") {
          return { ok: true, value: { repo: true, commits: [{ sha: "abc1234", author: "me", subject: "init", refs: "HEAD -> main" }] } };
        }
        return { ok: true, value: { message: `${endpoint} ok` } };
      }
    }
  },
  slots: {
    inject(name, cb) { registrations.push({ slot: name, cb }); },
    register(opts, comp) {
      if (!activeReg) throw new Error("register called outside an inject callback");
      activeReg.opts = opts; activeReg.comp = comp;
      return () => {};
    }
  }
};
mod.apply(ctx);

const bySlot = Object.fromEntries(registrations.map((r) => [r.slot, r]));
for (const slot of ["shell.overlay", "conversation.input.dock"]) {
  if (!bySlot[slot]) throw new Error(`missing registration for ${slot}`);
}
// Run each slot-inject callback so the register() call lands (captured opts/comp).
for (const registration of registrations) {
  activeReg = registration;
  registration.cb();
  activeReg = null;
}
if (bySlot["shell.overlay"].opts.id !== "dsh-git-panel") throw new Error("bad panel id");
if (bySlot["conversation.input.dock"].opts.id !== "dsh-git-pill") throw new Error("bad pill id");

// Build a store through the panel's inject face (shared by both seats).
const panelInjected = bySlot["shell.overlay"].opts.inject();
const store = panelInjected.store;
if (!store || typeof store.subscribe !== "function" || typeof store.getSnapshot !== "function") {
  throw new Error("store face missing");
}

const commonProps = {
  store,
  t: (key, params) => key + (params ? JSON.stringify(params) : ""),
  useSessions: () => ({ current: "s1", byId: { s1: { cwd: "C:/repo" } } })
};

// Panel: initial render with no session (current undefined) → renders null.
{
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, {
    ...commonProps,
    useSessions: () => ({ current: undefined, byId: {} })
  }));
  if (html !== "") throw new Error(`no-session panel should render nothing, got: ${html}`);
}

// Panel: with a session but store idle/collapsed → renders nothing (no
// floating bubble; the persistent status is the input.left pill).
{
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  console.log("panel collapsed render:", JSON.stringify(html.slice(0, 120)));
  if (html !== "") throw new Error(`collapsed panel should render nothing, got: ${html}`);
}

// Dock: initial render with a session → dock line (or null while rebinding).
{
  const html = renderToStaticMarkup(React.createElement(bySlot["conversation.input.dock"].comp, commonProps));
  console.log("dock initial render:", JSON.stringify(html.slice(0, 120)));
}

// Verbs are wired to the /dsh-git-rpc channel.
{
  const res = await store.verbs.checkout("C:/repo", "main");
  if (res.ok !== true) throw new Error("checkout verb failed");
}

// Panel: expanded with loaded repo state → the full workbench renders (branch
// chip, dirty count, branch switcher, new-branch button, changes, commits).
{
  await store.refresh("C:/repo");
  store.setPanelOpen(true);
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  for (const needle of ["main", "src/a.js", "b.txt", "init", "abc1234"]) {
    if (!html.includes(needle)) throw new Error(`expanded panel missing ${JSON.stringify(needle)}`);
  }
  console.log("panel expanded render bytes:", html.length);
}

// Dock: loaded repo state → the branch summary pill.
{
  const html = renderToStaticMarkup(React.createElement(bySlot["conversation.input.dock"].comp, commonProps));
  if (!html.includes("main") || !html.includes("●2")) {
    throw new Error(`dock pill missing the branch summary: ${html}`);
  }
  console.log("dock loaded render bytes:", html.length);
}

for (const endpoint of ["status", "branches", "log", "checkout"]) {
  if (!calls.includes(`/dsh-git-rpc/${endpoint}`)) throw new Error(`client never called ${endpoint}`);
}

console.log(`\nRENDER TEST PASSED (both seats registered, components mount, store shared; react from ${reactRoot})`);


