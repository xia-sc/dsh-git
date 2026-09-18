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

// One small patch exercising every row kind the parser has to classify: a file
// header, a hunk header, context, a removal, an addition, and — the case a
// naive `line.startsWith("--- ")` check gets wrong — a REMOVED line whose own
// text starts with `--`.
const WORKTREE_DIFF = [
  "diff --git a/src/a.js b/src/a.js",
  "index 1111111..2222222 100644",
  "--- a/src/a.js",
  "+++ b/src/a.js",
  "@@ -1,4 +1,5 @@",
  " keep",
  "-- looks like a file header",
  "-# gone",
  "+// added",
  "+const x = 1;",
  "\\ No newline at end of file"
].join("\n");

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
        if (endpoint === "generateMessage") {
          return { ok: true, value: { message: "feat: generated subject", mode: "staged" } };
        }
        if (endpoint === "diff") {
          return { ok: true, value: {
            repo: true,
            path: "src/a.js",
            origPath: null,
            untracked: false,
            skipped: 0,
            worktree: { diff: WORKTREE_DIFF, binary: false, truncated: false },
            index: { diff: "", binary: false, truncated: false }
          } };
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

const repoSummary = {
  cwd: "C:/repo",
  retainedBy: { mainView: 1 },
  projectionValues: { modelSelection: { lastUsed: null, next: { provider: "alpha", model: "alpha-large" } } }
};
const commonProps = {
  store,
  t: (key, params) => key + (params ? JSON.stringify(params) : ""),
  // The session-scoped seat's own props: dsh >= 0.1.6 hands the current
  // Session identity to the dock (the panel reads the store instead), and the
  // summary's retain counts are the "is this the main-view Session?" signal.
  sessionId: "s1",
  useSessions: () => ({ ids: ["s1"], byId: { s1: repoSummary } })
};

// Unbound store (no session yet): neither seat renders anything.
{
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  if (html !== "") throw new Error(`no-session panel should render nothing, got: ${html}`);
  const dockHtml = renderToStaticMarkup(React.createElement(bySlot["conversation.input.dock"].comp, commonProps));
  if (dockHtml !== "") throw new Error(`no-session dock should render nothing, got: ${dockHtml}`);
}

// The dock owns the store's session binding. SSR runs no effects, so the test
// performs the binding the pill would do in the browser.
await store.bindSession("s1", "C:/repo");
if (store.getSnapshot().sessionId !== "s1") throw new Error("bindSession must publish the session identity");

// Panel: bound session, but store idle/collapsed → renders nothing (no
// floating bubble; the persistent status is the input pill).
{
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  console.log("panel collapsed render:", JSON.stringify(html.slice(0, 120)));
  if (html !== "") throw new Error(`collapsed panel should render nothing, got: ${html}`);
}

// An embedded Conversation (a right-sidebar chat tab) must not show the main
// workbench's pill, and must not rebind the shared store.
{
  const embeddedSummary = { cwd: "C:/other", retainedBy: { gateway: 1 } };
  const html = renderToStaticMarkup(React.createElement(bySlot["conversation.input.dock"].comp, {
    ...commonProps,
    sessionId: "s2",
    useSessions: () => ({ ids: ["s1", "s2"], byId: { s1: repoSummary, s2: embeddedSummary } })
  }));
  if (html !== "") throw new Error(`embedded dock should render nothing, got: ${html}`);
  if (store.getSnapshot().sessionId !== "s1") throw new Error("an embedded seat must not rebind the store");
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
// chip, dirty count, branch switcher, new-branch button, changes, commits, and
// the commit tooling row: stage-all + draft basis + AI draft).
{
  await store.refresh("C:/repo");
  store.setPanelOpen(true);
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  for (const needle of ["main", "src/a.js", "b.txt", "init", "abc1234", "action.stage", "action.generate"]) {
    if (!html.includes(needle)) throw new Error(`expanded panel missing ${JSON.stringify(needle)}`);
  }
  // The draft basis select offers all three modes, defaulting to `staged`
  // (the only basis whose content the commit actually records).
  for (const mode of ["staged", "unstaged", "all"]) {
    if (!html.includes(`value="${mode}"`)) throw new Error(`draft basis select missing mode ${mode}`);
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

// The draft verb routes to the endpoint with the session's own model route.
{
  await store.verbs.generateMessage("C:/repo", "staged", "alpha", "alpha-large");
  if (!calls.includes("/dsh-git-rpc/generateMessage")) throw new Error("generateMessage verb did not call the channel");
}

// The store's act() resolves with the raw result and localizes a coded failure.
{
  const ok = await store.act("generate", () => store.verbs.generateMessage("C:/repo", "staged"), (res) => ({ kind: res.ok ? "ok" : "error", text: res.ok ? "done" : "failed" }));
  if (!ok || ok.ok !== true) throw new Error("act() must resolve with the raw RPC result on success");
  if (store.getSnapshot().lastResult?.text !== "done") {
    throw new Error(`act() describe() must own the wording, got ${JSON.stringify(store.getSnapshot().lastResult)}`);
  }
  const failed = await store.act("generate", () => Promise.resolve({ ok: false, error: { code: "internal", message: "no staged changes", details: { code: "no-changes", mode: "staged" } } }), () => ({ kind: "error", text: "localized" }));
  if (failed?.ok !== false) throw new Error("act() must resolve with the raw RPC result on failure");
  if (store.getSnapshot().lastResult?.text !== "localized") {
    throw new Error(`act() describe() must own the failure wording, got ${JSON.stringify(store.getSnapshot().lastResult)}`);
  }
}

// Every change row is a control, because the change list is the diff viewer's
// navigation (click or Enter/Space opens that file's diff on the right).
{
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  const rows = html.split('data-dsh-git="change-row"').length - 1;
  if (rows !== 2) throw new Error(`expected one change-row control per change, got ${rows}`);
  if (!html.includes('role="button"')) throw new Error("change rows must be focusable controls");
  if (!html.includes('tabindex="0"')) throw new Error("change rows must be reachable by keyboard");
  if (!html.includes('data-dsh-git="change-row"')) throw new Error("change rows must carry the test hook");
  console.log("change rows rendered as controls:", rows);
}

// The diff parser: line numbers per side, kind classification, and the one case
// a naive file-header check gets wrong (a removed line whose text starts `--`).
{
  const { parseUnifiedDiff, parseDiffSide, diffRowView, DIFF_ROW } = mod.__internals;
  if (!parseUnifiedDiff || !parseDiffSide || !diffRowView) throw new Error("client must expose the diff internals for the render test");

  const parsed = parseUnifiedDiff(WORKTREE_DIFF);
  const kinds = parsed.rows.map((row) => row.kind);
  const expected = [
    DIFF_ROW.fileHeader, DIFF_ROW.fileHeader, DIFF_ROW.fileHeader, DIFF_ROW.fileHeader,
    DIFF_ROW.hunk, DIFF_ROW.context, DIFF_ROW.del, DIFF_ROW.del, DIFF_ROW.add, DIFF_ROW.add, DIFF_ROW.noNewline
  ];
  if (JSON.stringify(kinds) !== JSON.stringify(expected)) {
    throw new Error(`unexpected row kinds: ${JSON.stringify(kinds)}`);
  }
  if (parsed.additions !== 2 || parsed.deletions !== 2 || parsed.hunks !== 1) {
    throw new Error(`unexpected counts: ${JSON.stringify({ additions: parsed.additions, deletions: parsed.deletions, hunks: parsed.hunks })}`);
  }
  const context = parsed.rows[5];
  if (context.oldLine !== 1 || context.newLine !== 1 || context.text !== "keep") {
    throw new Error(`context row numbering wrong: ${JSON.stringify(context)}`);
  }
  const removed = parsed.rows[6];
  if (removed.oldLine !== 2 || removed.newLine !== null || removed.text !== "- looks like a file header") {
    throw new Error(`removed row numbering wrong: ${JSON.stringify(removed)}`);
  }
  const added = parsed.rows[8];
  if (added.newLine !== 2 || added.oldLine !== null) {
    throw new Error(`added row numbering wrong: ${JSON.stringify(added)}`);
  }

  // Row markup: gutters carry the two side's numbers and the marker rides the
  // text, so a copied line and a rendered line read the same.
  const addedHtml = renderToStaticMarkup(React.createElement(React.Fragment, null, diffRowView(added, "k", false)));
  if (!addedHtml.includes(">2<") || !addedHtml.includes("+// added")) {
    throw new Error(`added row markup wrong: ${addedHtml}`);
  }
  const removedHtml = renderToStaticMarkup(React.createElement(React.Fragment, null, diffRowView(removed, "k", false)));
  if (!removedHtml.includes("-- looks like a file header") || !/background:/.test(removedHtml)) {
    throw new Error(`removed row markup wrong: ${removedHtml}`);
  }
  const wrapHtml = renderToStaticMarkup(React.createElement(React.Fragment, null, diffRowView(added, "k", true)));
  if (!wrapHtml.includes("pre-wrap")) throw new Error("wrap mode must switch the row to pre-wrap");

  // Side flags: an empty side is "nothing here", a binary side says so.
  if (parseDiffSide({ diff: "", binary: false, truncated: false }).empty !== true) throw new Error("an empty diff must read as empty");
  if (parseDiffSide({ diff: "Binary files a and b differ", binary: true, truncated: false }).binary !== true) throw new Error("binary flag lost");
  if (parseDiffSide({ diff: "x", binary: false, truncated: true }).truncated !== true) throw new Error("truncated flag lost");
  console.log("diff parser rows:", parsed.rows.length, "add/del:", parsed.additions, "/", parsed.deletions);
}

// The diff pane itself, in its initial (loading) state: header, side switch,
// tools, and the test hooks the browser test locates it by.
{
  const { GitDiffPane } = mod.__internals;
  const html = renderToStaticMarkup(React.createElement(GitDiffPane, {
    store,
    t: commonProps.t,
    cwd: "C:/repo",
    change: { file: "src/a.js", origFile: null, status: "modified", path: "src/a.js" },
    dataVersion: "v1",
    onClose: () => {}
  }));
  for (const needle of ['data-dsh-git="diff"', 'data-dsh-git="diff-header"', 'data-dsh-git="diff-body"', 'data-dsh-git="diff-close"', "diff.scope.worktree", "diff.scope.index", "diff.loading", "src/a.js"]) {
    if (!html.includes(needle)) throw new Error(`diff pane missing ${JSON.stringify(needle)}: ${html.slice(0, 400)}`);
  }
  console.log("diff pane render bytes:", html.length);
}

// The diff verb routes to the endpoint with the pathspec pair.
{
  const res = await store.verbs.diff("C:/repo", "src/a.js", null);
  if (res.ok !== true) throw new Error("diff verb failed");
  if (!calls.includes("/dsh-git-rpc/diff")) throw new Error("diff verb did not call the channel");
}

for (const endpoint of ["status", "branches", "log", "checkout", "generateMessage", "diff"]) {
  if (!calls.includes(`/dsh-git-rpc/${endpoint}`)) throw new Error(`client never called ${endpoint}`);
}

console.log(`\nRENDER TEST PASSED (both seats registered, components mount, store shared, draft tooling wired; react from ${reactRoot})`);


