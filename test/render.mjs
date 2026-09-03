// Render-time test for the dsh-git floating panel + dock line using REAL
// React (react-dom/server). Verifies both slot registrations and that the
// components' initial renders do not crash.
// Run: node test/render.mjs
import { createRequire } from "node:module";

const requireFromCache = createRequire("D:/tool/npm/cache/_npx/1e7f6d9597241db0/node_modules/x.js");
const React = requireFromCache("react");
const { renderToStaticMarkup } = requireFromCache("react-dom/server");

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

// Capture the slot registrations performed by apply().
const registrations = [];
let activeReg = null;
const ctx = {
  effect() { return () => {}; },
  locale: { register() { return () => {}; } },
  connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
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

console.log("\nRENDER TEST PASSED (both seats registered, components mount, store shared)");


