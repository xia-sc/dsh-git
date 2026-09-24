// Slot-mount test: drive the REAL browser slot runtime (a real Cordis context +
// the REAL `@deepseek-ai/dsh-client-ui-renderer` SlotRegistry, loaded from the
// installed dsh profile) and check that the hand-written bundle in lib/client.js
// still lands in both seats the host declares.
//
// Run: node test/slot-mount.mjs
//
// Why this file exists
// --------------------
// `test/render.mjs` registers the two seats against a HAND-ROLLED stub `ctx`
// (its own `slots.inject`/`slots.register`) and hands the components synthetic
// props. A host change that removes or renames a seat, changes `register()`'s
// option shape, or stops synthesizing the session-scoped standard props
// (`sessionId`, `useSessions`, `t`) therefore ships GREEN — the stub happily
// accepts whatever the bundle asks for. This test replaces the stub with the
// real thing:
//
//   real Cordis Context  →  renderer.apply() installs the real SlotRegistry
//   real SlotCore ledger →  a real root entry DECLARES the two seats with the
//                           same kind/scope the host declares
//                           (shell.overlay list/root, conversation.input.dock
//                           list/session — see dsh-client-ui-layout and
//                           dsh-client-ui-conversation)
//   lib/client.js        →  its real apply() calls ctx.slots.inject/register
//   react-dom/server     →  renderSlot("root", {}) becomes static markup
//
// What it pins down (each one is something the stub ctx could not see):
//   * both entries register under `shell.overlay` / `conversation.input.dock`
//     with ids `dsh-git-panel` / `dsh-git-pill` and orders 10 / 20;
//   * `shell.overlay` is still declared `list`/`root` and
//     `conversation.input.dock` `list`/`session` — a scope flip (which the host
//     made once, silently killing the pill: see COMPAT.md §1) changes what the
//     renderer hands the component;
//   * the session-scoped seat really receives `sessionId` plus a working
//     `useSessions` selector hook, so the pill can resolve
//     `byId[sessionId].cwd` and render it as its `title`;
//   * the renderer's `retainedBy.mainView` gate still suppresses the pill for an
//     embedded (non-main-view) Conversation;
//   * the `locale` seat delivers `t` (the pill's `aria-label` is the localized
//     `dock.aria`);
//   * neither seat raises `data-slot-error` (the renderer's crash face), which
//     is how a broken `register()` option shape or a missing framework prop
//     would show up here instead of in the browser.
//
// SKIP contract
// -------------
// The DSH client packages and React are NOT dependencies of this plugin (the
// bundle borrows the shell's `react` seed word). On a machine without a dsh
// profile — the repo's CI is `ubuntu-latest` with none installed — every
// assertion here is unobservable, so this file prints `SKIP: …` and exits 0.
// It never fails for a missing profile.
//
// SKIP covers "no profile" ONLY — never "the profile is there but a piece of
// the host could not be resolved". That distinction matters: this file exists
// to catch silent host-side regressions, so a resolution failure on a machine
// that DOES have a profile must stay loud. Concretely, the cosmetic
// `dsh-client-ui-slots` version probe is optional (prints `slots@?`), and the
// renderer's own `require("@deepseek-ai/dsh-client-ui-slots")` then fails the
// run if the package really is gone. See the probe's comment below.
//
// SSR is not a browser
// --------------------
// `react-dom/server` runs no effects, so the pill's own `useEffect(() =>
// store.bindSession(sessionId, cwd))` never fires. To still exercise the real
// chain (real `sessionId` standard prop + real `useSessions` source + real
// `mainView` gate + real shared store, without reimplementing the plugin's
// registration), the test performs the SAME decision that effect performs, read
// off the SAME observable source the framework hands the component, and only
// then re-renders. Every assertion stays unconditional — the binder is a
// faithful stand-in for the skipped effect, not an escape hatch — which is what
// makes the file a guard: see the falsification recipes below.
//
// Falsification recipes (both verified; neither needs lib/ touched)
// ----------------------------------------------------------------
//   1. assertion input — `DSH_GIT_SLOT_FIXTURE=embedded node test/slot-mount.mjs`
//      spoofs `retainedBy: { gateway: 1 }`. The mainView gate then refuses to
//      bind, and 9 checks fail (dock markup / title / aria-label / locale key /
//      store binding / rpc read / panel markup / …).
//   2. seat key — copy the file inside test/ with
//      `conversation.input.dock` → `conversation.input.docs`. The declaration
//      name follows the copy, so `slots.inject` for the real seat never fires:
//      8 checks fail ("… has exactly one entry — got 0", "dock markup rendered",
//      the title check, …). Delete the copy afterwards.
//
// Assumption a future dsh version could break: this file drives the renderer
// through its PUBLIC seams only (`renderer.apply`, `ctx.slots.register/
// provideRoot/installLocale/installScope/renderSlot`, `entry.options`,
// `entry.inject`) and does not touch renderer internals. One deliberate
// patching exception is documented at `patchSyncExternalStore` below.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// ── package resolution ──────────────────────────────────────────────────────
// Profile-first, like test/host-mount.mjs and test/render.mjs:
//   $DSH_HOME/profiles/web/node_modules → $DSH_HOME/profiles/node_modules
//   (default DSH_HOME = ~/.dsh) → the repo's own node_modules (where the local
//   react/react-dom live) → roots discovered by walking up from a resolved
//   @deepseek-ai package (see addVendoredRoots — the dsh bundle vendors its
//   client packages as nested deps, and a profile can hold a DANGLING junction
//   for one of them) → anchors at this file's directory and the repo root.
//
// DSH_GIT_DSH_ROOT is a deliberate OVERRIDE and is authoritative when set: it
// does not silently fall back to the profiles. That is what makes the SKIP path
// reachable on a machine that DOES have a profile (point it at an empty temp dir
// to prove this file skips instead of failing).
const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const overridden = typeof process.env.DSH_GIT_DSH_ROOT === "string" && process.env.DSH_GIT_DSH_ROOT !== "";
const roots = [
  ...(overridden
    ? [process.env.DSH_GIT_DSH_ROOT]
    : [
      join(dshHome, "profiles", "web", "node_modules"),
      join(dshHome, "profiles", "node_modules")
    ]),
  join(import.meta.dirname, "..", "node_modules")
].filter((root) => typeof root === "string" && root !== "");

/** Package directory holding a resolved entry file (walks up to its package.json). */
function packageRootOf(entryFile) {
  let dir = dirname(entryFile);
  for (let step = 0; step < 6; step += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

/**
 * Resolve one specifier out of the first import root that has it.
 * @param spec - bare package specifier (or subpath).
 * @returns the absolute entry file plus its package root.
 */
function locate(spec) {
  const failures = [];
  // Anchor node resolution at THIS file's directory (not the cwd) so the run is
  // reproducible from any working directory — the property test/render.mjs gets
  // from `createRequire(import.meta.url)`.
  const anchors = [...roots, import.meta.dirname, join(import.meta.dirname, "..")];
  for (const root of anchors) {
    try {
      const req = createRequire(join(root, "dsh-git-slot-resolve.cjs"));
      const file = req.resolve(spec);
      return { file, root: packageRootOf(file) ?? root };
    } catch (error) {
      failures.push(`${root} (${error.code ?? error.message})`);
    }
  }
  const reason = `cannot resolve "${spec}" — tried ${failures.join(", ")}`;
  throw new Error(reason);
}

/**
 * Append every `…/@deepseek-ai` node_modules directory on the way up from one
 * resolved entry file. The dsh bundle vendors its own client packages as nested
 * dependencies, and a profile can hold a DANGLING junction for one of them
 * (a `link:` install whose target moved), so the bundle's own node_modules is a
 * legitimate fallback root — reached through the packages that DO resolve.
 * @param entryFile - absolute file inside a resolved `@deepseek-ai/*` package.
 */
function addVendoredRoots(entryFile) {
  const extra = [];
  let dir = dirname(entryFile);
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(dir, "@deepseek-ai", "dsh-client-ui-renderer", "package.json"))) extra.push(dir);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const root of extra) if (!roots.includes(root)) roots.push(root);
  return extra.length > 0;
}

/** Print the SKIP banner and leave with success (missing profile is not a failure). */
function skip(reason) {
  console.log(`SKIP: ${reason}`);
  console.log("  this test needs an installed dsh profile (set DSH_HOME or DSH_GIT_DSH_ROOT to a node_modules with @deepseek-ai/dsh-client-ui-renderer).");
  process.exit(0);
}

// Everything the harness needs, resolved before a single line runs. A missing
// piece is a SKIP, never a failure.
let cordisEntry;
let rendererEntry;
let pluginEntry;
let react;
let reactDom;
let reactDomServer;
const dshVersion = { renderer: undefined, slots: undefined };
try {
  cordisEntry = locate("@deepseek-ai/cordis").file;
  rendererEntry = locate("@deepseek-ai/dsh-client-ui-renderer/client").file;
  // `@deepseek-ai/dsh-client-ui-slots` is a nested dependency of the bundle; its
  // profile junction can dangle, so widen the roots through the renderer that
  // DID resolve before asking for it.
  try {
    locate("@deepseek-ai/dsh-client-ui-slots/package.json");
  } catch {
    addVendoredRoots(rendererEntry);
  }
  pluginEntry = pathToFileURL(join(import.meta.dirname, "..", "lib", "client.js")).href;
  react = locate("react");
  reactDom = locate("react-dom");
  reactDomServer = locate("react-dom/server");
  dshVersion.renderer = JSON.parse(readFileSync(locate("@deepseek-ai/dsh-client-ui-renderer/package.json").file, "utf8")).version;
} catch (error) {
  skip(error.message);
}

// The slots VERSION is cosmetic — it rides only the banner printed at the end of
// this file — so it must never gate the run. It used to sit inside the `try`
// above, which made a host packaging change that stopped vendoring
// `@deepseek-ai/dsh-client-ui-slots` (it moved from a top-level profile link to
// a nested dependency of the dsh CLI in 0.1.7-rc.1, reached here only through
// the `addVendoredRoots` fallback above) collapse into `SKIP` + exit 0 — a guard
// against silent failure failing silently. Verified before the change: forcing
// `locate()` to refuse that one spec printed `SKIP: …` and exited 0. Now the
// version merely prints as `?` and the run continues; if the package is
// genuinely absent, the renderer's own
// `require("@deepseek-ai/dsh-client-ui-slots")` fails loudly instead.
try {
  dshVersion.slots = JSON.parse(readFileSync(locate("@deepseek-ai/dsh-client-ui-slots/package.json").file, "utf8")).version;
} catch {
  dshVersion.slots = "?";
}

if (!existsSync(react.file) || !existsSync(reactDom.file)) {
  skip("react/react-dom are not installed for this checkout");
}

const React = createRequire(join(dirname(react.file), "anchor.cjs"))("react");
const { renderToStaticMarkup } = createRequire(join(dirname(reactDomServer.file), "anchor.cjs"))("react-dom/server");

// ── the one deliberate patch ────────────────────────────────────────────────
// The renderer binds its internal observable sources with
// `useSyncExternalStoreWithSelector(subscribe, getSnapshot, void 0, …)` — no
// `getServerSnapshot`. React's own `useSyncExternalStore` accepts that (the
// argument is optional; it falls back to getSnapshot), but the copy of
// use-sync-external-store BUNDLED INSIDE the renderer passes the missing
// argument straight through and react-dom/server then refuses to render
// ("Missing getServerSnapshot"). Restoring the public fallback is the smallest
// honest seam that lets the real renderer run without a DOM; it patches React,
// not the renderer, and it is a no-op for the two-argument call sites.
function patchSyncExternalStore() {
  const original = React.useSyncExternalStore;
  if (typeof original !== "function") return;
  const patched = function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
    return original(subscribe, getSnapshot, getServerSnapshot === undefined ? getSnapshot : getServerSnapshot);
  };
  try {
    Object.defineProperty(patched, "name", { value: "useSyncExternalStore" });
  } catch { /* older engines: the name is cosmetic */ }
  React.useSyncExternalStore = patched;
}

// ── module-loader seam ──────────────────────────────────────────────────────
// Both bundles self-register through `window.__ModuleLoader__.load({id, factory})`
// and the factory's `require` is the shell's module table. The facade below is
// the smallest thing that satisfies that contract: it records the factories and
// then serves the real installs (react/react-dom/use-sync-external-store from
// the resolved package roots, @deepseek-ai/* from the profile).
patchSyncExternalStore();
globalThis.window = globalThis;

const factories = new Map();
globalThis.__ModuleLoader__ = {
  load(handoff) {
    if (typeof handoff?.id !== "string" || typeof handoff?.factory !== "function") {
      throw new Error("__ModuleLoader__.load() needs { id, factory }");
    }
    factories.set(handoff.id, handoff.factory);
  }
};

// The shell's module table seed words, mapped onto the real installs. The
// `use-sync-external-store/*` aliases keep the renderer's inlined shim on the
// SAME React instance as the server renderer (two React copies would break
// hooks outright).
const seedWords = new Map([
  ["react", () => createRequire(join(dirname(react.file), "anchor.cjs"))("react")],
  ["react-dom", () => createRequire(join(dirname(reactDom.file), "anchor.cjs"))("react-dom")],
  ["react-dom/client", () => createRequire(join(dirname(reactDom.file), "anchor.cjs"))("react-dom/client")],
  ["react/jsx-runtime", () => createRequire(join(dirname(react.file), "anchor.cjs"))("react/jsx-runtime")],
  ["react/jsx-dev-runtime", () => createRequire(join(dirname(react.file), "anchor.cjs"))("react/jsx-dev-runtime")],
  ["use-sync-external-store", () => React],
  ["use-sync-external-store/shim", () => React],
  ["use-sync-external-store/shim/with-selector", () => React]
]);
const seedCache = new Map();
function moduleTable(spec) {
  if (seedCache.has(spec)) return seedCache.get(spec);
  let value;
  if (seedWords.has(spec)) {
    value = seedWords.get(spec)();
  } else {
    // Everything else the shell seeds (`@deepseek-ai/*` runtime packages,
    // `use-sync-external-store/…`) comes from the same roots.
    const located = locate(spec);
    value = createRequire(join(located.root, "anchor.cjs"))(spec);
  }
  seedCache.set(spec, value);
  return value;
}

// Load the real renderer and the real plugin bundle. Their ids come from the
// bundles themselves, so a renamed self-registration is caught here too.
await import(pathToFileURL(rendererEntry).href);
await import(pluginEntry);
const RENDERER_ID = "@deepseek-ai/dsh-client-ui-renderer";
const PLUGIN_ID = "@xia-sc/dsh-git";
for (const id of [RENDERER_ID, PLUGIN_ID]) {
  if (!factories.has(id)) throw new Error(`bundle did not self-register under ${JSON.stringify(id)} (saw: ${[...factories.keys()].join(", ")})`);
}
const renderer = factories.get(RENDERER_ID)(moduleTable);
const plugin = factories.get(PLUGIN_ID)(moduleTable);

// ── the fixture ─────────────────────────────────────────────────────────────
// One main-view Session (`retainedBy.mainView`) whose workspace is a git repo,
// plus the RPC stub the store reads through.
//
// FALSIFICATION HOOK: `DSH_GIT_SLOT_FIXTURE=embedded` spoofs the retain counts
// of an embedded (non-main-view) Conversation. That is the documented
// "temporarily break one assertion input" recipe for this file: with the gate
// corrupted the pill must NOT render, so the positive assertions below fail and
// the run exits non-zero. Nothing is skipped or branched on the flag — the
// checks are unconditional, which is exactly what makes it a guard.
const FIXTURE_SESSION = "s1";
const FIXTURE_CWD = "C:/repo";
const sessionSummary = {
  cwd: FIXTURE_CWD,
  retainedBy: process.env.DSH_GIT_SLOT_FIXTURE === "embedded" ? { gateway: 1 } : { mainView: 1 }
};
const sessionsSnapshot = () => ({
  phase: "ready",
  ids: [FIXTURE_SESSION],
  byId: { [FIXTURE_SESSION]: sessionSummary }
});
const STATUS = {
  repo: true,
  branch: "main",
  detached: false,
  oid: "abc1234",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  dirty: 0,
  changes: []
};
const rpcCalls = [];
const connection = {
  rpc: {
    call: async (channel, endpoint) => {
      rpcCalls.push(`${channel}/${endpoint}`);
      if (endpoint === "status") return { ok: true, value: STATUS };
      if (endpoint === "branches") return { ok: true, value: { repo: true, current: "main", local: [{ name: "main", current: true, sha: "abc1234", upstream: "origin/main" }], remote: [] } };
      if (endpoint === "log") return { ok: true, value: { repo: true, commits: [] } };
      return { ok: true, value: {} };
    }
  }
};
// The locale stub echoes `<namespace>:<key>` and records every key the seats ask
// for, so the `t` seat is observable without shipping the host's dictionaries.
const localeKeys = [];
const locale = { register: () => () => {} };
const localeFace = {
  getSnapshot: () => ({ revision: 1, locale: "en" }),
  subscribe: () => () => {},
  bind: (namespace) => (key, params) => {
    localeKeys.push(`${namespace}:${key}`);
    return params === undefined ? `${namespace}:${key}` : `${namespace}:${key} ${JSON.stringify(params)}`;
  }
};

/** A bare observable source, the shape every framework-provided hook prop takes. */
function source(value) {
  return { getSnapshot: () => value, subscribe: () => () => {} };
}

// ── real Cordis context + real renderer ─────────────────────────────────────
const { Context } = await import(pathToFileURL(cordisEntry).href);
const app = new Context();

await app.plugin({
  name: "slot-mount:stubs",
  apply(ctx) {
    ctx.provide("connection", connection);
    ctx.provide("locale", locale);
  }
}).await();
await app.plugin({ name: "slot-mount:renderer", apply: renderer.apply }).await();
if (app.slots === undefined) throw new Error("renderer.apply() did not provide `ctx.slots`");

// The standard-source providers the shell installs. `sessions` is the source the
// renderer turns into the `useSessions` prop; `sessionId` is the standard session
// prop, injected through the real session-scope adapter.
app.slots.provideRoot({ hooks: { sessions: source(sessionsSnapshot()) } });
app.slots.installLocale(localeFace);
const sessionBinding = {
  key: FIXTURE_SESSION,
  ctx: app,
  hooks: {},
  keyedHooks: {},
  props: { sessionId: FIXTURE_SESSION }
};
const sessionScope = {
  current: source(sessionBinding),
  bindingSource: () => source(sessionBinding),
  renderArea: (_binding, props) => React.createElement(React.Fragment, null, props.children)
};
app.slots.installScope("session", sessionScope);

// The root entry: the host's own `root` registration (dsh-client-ui-layout) is
// where both seats are DECLARED, and the component is what renders them. Using
// the public `register()`/`renderSlot` face keeps `ctx.slots.inject` honest —
// the callbacks stay pending until the declarations land.
const SEATS = {
  "shell.overlay": { kind: "list", scope: "root" },
  "conversation.input.dock": { kind: "list", scope: "session" }
};
function RootFrame(props) {
  return React.createElement(
    React.Fragment,
    null,
    props.renderSlot("shell.overlay", {}),
    props.renderSlot("conversation.input.dock", {})
  );
}
app.slots.register({ name: "root", children: SEATS }, RootFrame);

// ── mount the plugin's real apply() ─────────────────────────────────────────
await app.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply }).await();

const panelEntries = app.slots.entries("shell.overlay");
const dockEntries = app.slots.entries("conversation.input.dock");
const panelEntry = panelEntries[0];
const dockEntry = dockEntries[0];
// The store is authored inside apply() and shared by both seats through their
// `inject` face — the one handle the test needs to reach the load promise.
const store = typeof panelEntry?.inject === "function" ? panelEntry.inject().store : undefined;

// ── assertions ──────────────────────────────────────────────────────────────
const failures = [];
/** Record one check; never throws, so a run reports every problem at once. */
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

const render = () => renderToStaticMarkup(app.slots.renderSlot("root", {}));

console.log(`slot-mount against @deepseek-ai/dsh-client-ui-renderer@${dshVersion.renderer} + dsh-client-ui-slots@${dshVersion.slots}`);

// 1. Both seats are declared with the kind/scope the host declares. A scope flip
//    on the dock (root instead of session) is what silently killed the pill in
//    dsh 0.1.6 (COMPAT.md §1) — assert the declaration, not just the entry.
check("shell.overlay is declared list/root", JSON.stringify(app.slots.spec("shell.overlay")) === JSON.stringify({ kind: "list", scope: "root" }), JSON.stringify(app.slots.spec("shell.overlay")));
check("conversation.input.dock is declared list/session", JSON.stringify(app.slots.spec("conversation.input.dock")) === JSON.stringify({ kind: "list", scope: "session" }), JSON.stringify(app.slots.spec("conversation.input.dock")));

// 2. Both entries registered, under the expected ids and orders.
check("shell.overlay has exactly one entry", panelEntries.length === 1, `got ${panelEntries.length}`);
check("shell.overlay entry id is dsh-git-panel", panelEntry?.options?.id === "dsh-git-panel", JSON.stringify(panelEntry?.options));
check("shell.overlay entry order is 10", panelEntry?.options?.order === 10, JSON.stringify(panelEntry?.options));
check("conversation.input.dock has exactly one entry", dockEntries.length === 1, `got ${dockEntries.length}`);
check("conversation.input.dock entry id is dsh-git-pill", dockEntry?.options?.id === "dsh-git-pill", JSON.stringify(dockEntry?.options));
check("conversation.input.dock entry order is 20", dockEntry?.options?.order === 20, JSON.stringify(dockEntry?.options));

// 3. Unbound (SSR runs no effects): neither seat may render anything, and — the
//    point of a real renderer — neither may raise the crash face.
{
  const html = await render();
  check("unbound: no dock markup", !html.includes('data-dsh-git="dock"'), html);
  check("unbound: no panel markup", !html.includes('data-dsh-git="panel"'), html);
  check("unbound: no data-slot-error", !html.includes("data-slot-error"), html);
}

// 4. Bind the way the pill's own effect does: read the Session's cwd off the
//    `useSessions` snapshot the renderer handed the component, honour the
//    `retainedBy.mainView` gate, then let the store load. An embedded
//    Conversation (spoofed by DSH_GIT_SLOT_FIXTURE=embedded) fails the gate,
//    never binds, and therefore fails every positive check in step 5.
if (store === undefined) {
  check("both seats share one store handle", false, "panel entry inject() exposed no store");
} else {
  check("both seats share one store handle", panelEntry?.inject?.().store !== undefined && panelEntry.inject().store === dockEntry?.inject?.().store);
  const summary = sessionsSnapshot().byId[FIXTURE_SESSION];
  const mainView = summary.retainedBy === undefined || summary.retainedBy === null ? true : (summary.retainedBy.mainView ?? 0) > 0;
  if (mainView) {
    await store.bindSession(FIXTURE_SESSION, summary.cwd);
  }
}

// 5. The session-scoped seat's render: `title` is the Session's cwd, which can
//    only be true if the framework delivered `sessionId` AND a working
//    `useSessions` selector, and if `retainedBy.mainView` let the pill bind.
{
  const html = await render();
  check("dock markup rendered", html.includes('data-dsh-git="dock"'), html);
  check(`dock title is the session cwd (${FIXTURE_CWD})`, html.includes(`title="${FIXTURE_CWD}"`), html.slice(0, 400));
  check("dock aria-label is the localized dock.aria (locale seat delivered t)", html.includes('aria-label="dshGit:dock.aria"'), html.slice(0, 400));
  check("locale seat was asked for a dshGit key", localeKeys.some((key) => key.startsWith("dshGit:")), JSON.stringify(localeKeys.slice(0, 8)));
  check("store bound to the session", store?.getSnapshot().sessionId === FIXTURE_SESSION, JSON.stringify(store?.getSnapshot().sessionId));
  check("store loaded the fixture workspace", store?.getSnapshot().cwd === FIXTURE_CWD, JSON.stringify(store?.getSnapshot()));
  check("store read the repo through /dsh-git-rpc", rpcCalls.includes("/dsh-git-rpc/status"), JSON.stringify(rpcCalls));
  check("no data-slot-error after binding", !html.includes("data-slot-error"), html);
}

// 6. The root-scoped panel reads the shared store and renders once opened.
if (store !== undefined) {
  store.setPanelOpen(true);
  const html = await render();
  check("open panel markup rendered", html.includes('data-dsh-git="panel"'), html.slice(0, 400));
  check("panel renders the bound branch", html.includes("main"), html.slice(0, 600));
  check("open panel: no data-slot-error", !html.includes("data-slot-error"), html);
}

// ── banner ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.log(`\n${failures.length} SLOT CHECK(S) FAILED`);
  for (const label of failures) console.log(`  - ${label}`);
  process.exit(1);
}
console.log(`\nSLOT MOUNT TEST PASSED (real SlotRegistry ${dshVersion.renderer}: both seats registered 10/20, session props + locale seat delivered, no slot errors)`);
