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
/** Every RPC the client made, with its payload (the wire-level assertions). */
const sent = [];
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

// The status fixture is mutable so tests can put the workbench into the states
// the network button has to tell apart (a dirty tree vs only unpushed commits).
// Any test that changes it restores the default afterwards.
let statusValue = {
  repo: true,
  branch: "main",
  detached: false,
  oid: "abc1234",
  upstream: "origin/main",
  ahead: 1,
  behind: 0,
  dirty: 2,
  changes: [{ status: "modified", path: "src/a.js" }, { status: "untracked", path: "b.txt" }],
  stashes: [{ ref: "stash@{0}", subject: "On main: WIP on main" }]
};

const ctx = {
  effect() { return () => {}; },
  locale: { register() { return () => {}; } },
  connection: {
    rpc: {
      call: async (channel, endpoint, payload) => {
        calls.push(`${channel}/${endpoint}`);
        sent.push({ endpoint, payload });
        if (endpoint === "status") {
          return { ok: true, value: statusValue };
        }
        if (endpoint === "branches") {
          return { ok: true, value: { repo: true, current: "main", local: [{ name: "main", current: true, sha: "abc1234", upstream: "origin/main" }, { name: "dev", current: false, sha: "def5678", upstream: null }], remote: [{ remote: "origin", branch: "main", name: "origin/main", short: "main" }, { remote: "upstream", branch: "main", name: "upstream/main", short: "main" }] } };
        }
        if (endpoint === "log") {
          return { ok: true, value: { repo: true, commits: [{ sha: "abc1234", author: "me", subject: "init", refs: "HEAD -> main" }] } };
        }
        if (endpoint === "generateMessage") {
          return { ok: true, value: { message: "feat: generated subject", mode: "staged" } };
        }
        if (endpoint === "push") {
          // Exactly what a Gitee push returns through the sideband: SGR colour
          // codes, and a truncated `ESC[0` right before a complete sequence.
          return { ok: true, value: { message: "remote: Powered by \u001B[0\u001B[01;33mGITEE.COM \u001B[0\u001B[m[1.1.23]\nTo gitee.com:x/y.git\n   abc1234..def5678  main -> main" } };
        }
        if (endpoint === "stage") {
          // `git add` on a CRLF checkout: three lines of advice, no news.
          return { ok: true, value: { message: [
            "warning: in the working copy of 'docs/statistical-api.md', LF will be replaced by CRLF the next time Git touches it",
            "warning: in the working copy of 'docs/statistical-students-api.md', LF will be replaced by CRLF the next time Git touches it",
            "warning: in the working copy of 'docs/statistical-user-api.md', LF will be replaced by CRLF the next time Git touches it"
          ].join("\n") } };
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

// Drafting capability: a host without the optional `llm` service reports
// generate:false, so the panel disables the draft button with a visible reason
// instead of letting the click reach an endpoint that would answer
// `llm-unavailable`.
{
  statusValue.generate = false;
  await store.refresh("C:/repo");
  store.setPanelOpen(true);
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  if (!html.includes('data-dsh-git="generate-unavailable"')) throw new Error("a host without llm must explain why drafting is disabled");
  if (!/data-dsh-git="generate"[^>]*disabled/.test(html)) throw new Error("the draft button must be disabled without llm");
  if (!html.includes('title="generate.unavailable"')) throw new Error("the disabled draft button must carry the reason");
  statusValue.generate = true;
  await store.refresh("C:/repo");
  const restored = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  if (restored.includes('data-dsh-git="generate-unavailable"')) throw new Error("the hint must disappear once llm is available");
  console.log("draft capability: disabled + explained without llm, restored with it");
}

// The branch switcher's remote options carry the FULL remote-tracking ref.
// Two remotes often carry a branch of the same name; labelling both with the
// bare branch part (`main`, `main`) is exactly the ambiguity this asserts
// against. The start-point list ("new branch from…") has always sent full refs
// and must keep doing so.
{
  const { branchOptions, baseOptions } = mod.__internals;
  if (typeof branchOptions !== "function" || typeof baseOptions !== "function") {
    throw new Error("client must expose branchOptions/baseOptions for the render test");
  }
  const state = store.getSnapshot();
  const t = commonProps.t;
  const switcher = renderToStaticMarkup(React.createElement("select", null, branchOptions(state, t)));
  for (const ref of ["origin/main", "upstream/main"]) {
    if (!switcher.includes(`value="${ref}"`)) throw new Error(`switcher must offer the full ref ${ref}: ${switcher}`);
    if (!switcher.includes(`>${ref}<`)) throw new Error(`switcher must LABEL the full ref ${ref}: ${switcher}`);
  }
  // The two entries are still distinct options, not one ref listed twice.
  if (switcher.split(`value="upstream/main"`).length !== 2) throw new Error(`the duplicate-name remotes must stay distinguishable: ${switcher}`);
  const bases = renderToStaticMarkup(React.createElement("select", null, baseOptions(state, t)));
  for (const ref of ["origin/main", "upstream/main"]) {
    if (!bases.includes(`value="${ref}"`) || !bases.includes(`>${ref}<`)) throw new Error(`start-point list must offer ${ref} as value and label: ${bases}`);
  }
  // The local branch stays a plain name (it is what the switcher pre-selects).
  if (!switcher.includes('value="main"') || !switcher.includes(">main ✓<")) throw new Error(`local branches must keep plain names: ${switcher}`);
  // Nothing renders an entry for the per-remote HEAD symref: it is not pickable.
  if (switcher.includes("origin/HEAD")) throw new Error(`the remote HEAD symref must not be offered: ${switcher}`);
  console.log("branch option lists:", JSON.stringify(switcher.slice(0, 220)));
}

// A refused switch to a second remote's copy of a branch must be worded as the
// collision it is, in the panel's own language rather than git's ("a branch
// named 'main' already exists" says nothing about what to do).
{
  const { outputView, checkoutResult } = mod.__internals;
  if (typeof checkoutResult !== "function") throw new Error("client must expose checkoutResult for the render test");
  const conflict = {
    ok: false,
    error: {
      code: "internal",
      message: "本地分支 main 跟踪的是 origin/main，无法再把它关联到 upstream/main 上（git 不允许两个分支同名）。HEAD 未改动；请用「新建分支」以 upstream/main 为起点另建一个名字不同的分支。",
      details: { code: "checkout-remote-conflict", branch: "upstream/main", local: "main", upstream: "refs/remotes/origin/main" }
    }
  };
  // A translator that interpolates like the real one, so the assertion proves
  // the placeholders are filled rather than that the key survived.
  const text = (key, params) => {
    const sink = {
      "checkout.conflict": "本地分支 {local} 跟踪的是 {tracks}，无法再切换到 {branch}（git 不允许两个同名分支）。HEAD 未改动，请点「新建分支」以 {branch} 为起点另建一个分支",
      "checkout.conflictNoTrack": "本地已有同名分支 {local}，无法切换到 {branch}（git 不允许两个同名分支）。HEAD 未改动，请点「新建分支」以 {branch} 为起点另建一个分支"
    }[key] || key;
    return Object.keys(params || {}).reduce((out, name) => out.split(`{${name}}`).join(String(params[name])), sink);
  };
  const result = checkoutResult(conflict, { branch: "upstream/main" }, text);
  if (result.kind !== "error") throw new Error(`a refused switch must surface as a failure: ${JSON.stringify(result)}`);
  const card = renderToStaticMarkup(outputView(result, text, true, () => {}));
  for (const needle of ["upstream/main", "origin/main", "新建分支", "HEAD 未改动"]) {
    if (!card.includes(needle)) throw new Error(`the conflict card must mention ${JSON.stringify(needle)}: ${card}`);
  }
  // The full host diagnostic stays reachable behind the toggle.
  if (!card.includes('data-dsh-git="output-toggle"') || !card.includes('data-dsh-git="output-detail"')) {
    throw new Error(`the conflict card must keep git's own words one click away: ${card}`);
  }
  // A plain failure keeps the default wording (git's own words as the summary),
  // and an ordinary switch still confirms the branch it landed on.
  const plain = checkoutResult({ ok: false, error: { message: "fatal: not a git repository", details: { code: "not-a-repo" } } }, { branch: "dev" }, text);
  if (plain.text !== "fatal: not a git repository") throw new Error(`an unrecognized failure must keep the host message: ${JSON.stringify(plain)}`);
  const tracked = checkoutResult({ ok: true, value: { branch: "main", message: "branch 'main' set up to track 'upstream/main'." } }, { branch: "upstream/main" }, text);
  if (tracked.params.branch !== "main") throw new Error(`a tracking switch must report the local branch it created: ${JSON.stringify(tracked)}`);
  const same = checkoutResult({ ok: true, value: { branch: "dev", message: null } }, { branch: "dev" }, text);
  if (same.params.branch !== "dev" || same.text !== null) throw new Error(`a plain switch must keep its own summary key: ${JSON.stringify(same)}`);
  console.log("conflict card:", JSON.stringify(card.slice(0, 200)));
}

// Dock: loaded repo state → the branch summary pill.
{
  const html = renderToStaticMarkup(React.createElement(bySlot["conversation.input.dock"].comp, commonProps));
  if (!html.includes("main") || !html.includes("●2")) {
    throw new Error(`dock pill missing the branch summary: ${html}`);
  }
  console.log("dock loaded render bytes:", html.length);
}

// The draft verb routes to the endpoint with the session's own model route AND
// with the session id: a session-affine gateway rejects an unidentified call.
{
  await store.verbs.generateMessage("C:/repo", "staged", "alpha", "alpha-large", "s1");
  if (!calls.includes("/dsh-git-rpc/generateMessage")) throw new Error("generateMessage verb did not call the channel");
  const drafted = sent.filter((entry) => entry.endpoint === "generateMessage");
  const last = drafted[drafted.length - 1];
  if (last?.payload?.args?.sessionId !== "s1") throw new Error(`the draft verb must forward its session id: ${JSON.stringify(last)}`);
  if (last?.payload?.args?.provider !== "alpha" || last?.payload?.args?.model !== "alpha-large") {
    throw new Error(`the draft verb must forward the session's model route: ${JSON.stringify(last)}`);
  }
  // A caller with no session (a host-side call) keeps sessionId absent rather
  // than sending null/empty, which the endpoint would reject.
  await store.verbs.generateMessage("C:/repo", "staged");
  const unbound = sent.filter((entry) => entry.endpoint === "generateMessage").pop();
  if (unbound?.payload?.args?.sessionId !== undefined) throw new Error(`an unbound draft must omit sessionId: ${JSON.stringify(unbound)}`);
}

// The commit-message language setting: the gear sits in the header, the popover
// is closed until it is pressed, the store is the single source of truth, and
// only a language NAME ever reaches the endpoint.
{
  const { settingsView, LANGUAGE_PRESETS: presets, LANGUAGE_CUSTOM_ID: customId, LANGUAGE_STORAGE_KEY: storageKey } = mod.__internals;
  if (typeof settingsView !== "function") throw new Error("client must expose settingsView for the render test");
  if (storageKey !== "dsh-git.commitLanguage") throw new Error(`unexpected storage key: ${storageKey}`);
  if (presets[0].id !== "auto" || presets[0].directive !== undefined) throw new Error("the first language entry must be auto with no directive");
  if (presets.some((preset) => preset.id === customId)) throw new Error("custom must not be a preset with a fixed directive");

  store.setPanelOpen(true);
  const panelHtml = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  if (!panelHtml.includes('data-dsh-git="settings"')) throw new Error("the panel header must carry the settings button");
  if (panelHtml.includes('data-dsh-git="settings-popover"')) throw new Error("the settings popover must start closed");

  // The popover itself: SSR cannot click the gear, so it is rendered directly
  // (the same reason outputView/sectionView are exported).
  const popover = renderToStaticMarkup(React.createElement(settingsView, {
    t: commonProps.t,
    language: "auto",
    customText: "",
    autoRefresh: true,
    onLanguage: () => {},
    onCustomText: () => {},
    onAutoRefresh: () => {},
    onClose: () => {}
  }));
  for (const needle of ['data-dsh-git="settings-popover"', 'data-dsh-git="settings-language"', 'data-dsh-git="settings-close"', "settings.language.hint"]) {
    if (!popover.includes(needle)) throw new Error(`settings popover missing ${JSON.stringify(needle)}: ${popover.slice(0, 400)}`);
  }
  for (const id of presets.map((preset) => preset.id).concat([customId])) {
    if (!popover.includes(`value="${id}"`)) throw new Error(`settings select missing the ${id} entry`);
    if (!popover.includes(`settings.language.${id}`)) throw new Error(`settings select missing the ${id} label`);
  }
  // The free-form field exists only behind the custom entry.
  if (popover.includes('data-dsh-git="settings-language-text"')) throw new Error("the custom field must be hidden while a preset is selected");
  const customPopover = renderToStaticMarkup(React.createElement(settingsView, {
    t: commonProps.t,
    language: customId,
    customText: "Esperanto",
    autoRefresh: true,
    onLanguage: () => {},
    onCustomText: () => {},
    onAutoRefresh: () => {},
    onClose: () => {}
  }));
  if (!customPopover.includes('data-dsh-git="settings-language-text"')) throw new Error("the custom entry must reveal the text field");
  if (!customPopover.includes('value="Esperanto"')) throw new Error("the custom text must be echoed back into the field");

  // The setting drives the endpoint: a preset sends its language NAME.
  store.setGenerateLanguage("zh-CN");
  if (store.getSnapshot().generateLanguage !== "zh-CN") throw new Error("the setting must be published on the shared state");
  const zhDirective = store.languageDirective();
  if (zhDirective !== "Simplified Chinese (简体中文)") throw new Error(`unexpected directive: ${JSON.stringify(zhDirective)}`);
  await store.verbs.generateMessage("C:/repo", "staged", "alpha", "alpha-large", "s1", zhDirective);
  let lastDraft = sent.filter((entry) => entry.endpoint === "generateMessage").pop();
  if (lastDraft?.payload?.args?.language !== "Simplified Chinese (简体中文)") {
    throw new Error(`the draft must carry the forced language: ${JSON.stringify(lastDraft)}`);
  }

  // `auto` sends no directive at all, so the host keeps its own rule.
  store.setGenerateLanguage("auto");
  if (store.languageDirective() !== undefined) throw new Error("auto must send no directive");
  await store.verbs.generateMessage("C:/repo", "staged", undefined, undefined, undefined, store.languageDirective());
  lastDraft = sent.filter((entry) => entry.endpoint === "generateMessage").pop();
  if (lastDraft?.payload?.args?.language !== undefined) throw new Error(`auto must omit the language: ${JSON.stringify(lastDraft)}`);

  // A custom name is used as typed (trimmed where it is read) and an empty
  // field falls back to auto instead of failing the host's validation.
  store.setGenerateLanguage(customId, "  Esperanto  ");
  if (store.getSnapshot().generateLanguageText !== "  Esperanto  ") throw new Error("the custom text must be echoed verbatim into the field");
  if (store.languageDirective() !== "Esperanto") throw new Error(`unexpected custom directive: ${JSON.stringify(store.languageDirective())}`);
  store.setGenerateLanguage(customId, "   ");
  if (store.languageDirective() !== undefined) throw new Error("an empty custom name must fall back to auto");
  // An unknown id never becomes a directive.
  store.setGenerateLanguage("not-a-language");
  if (store.getSnapshot().generateLanguage !== "auto") throw new Error("an unknown preset id must fall back to auto");

  // The setting is a user preference, not Session state: a full status re-read
  // rebuilds every field from idleState() and must keep it.
  store.setGenerateLanguage("zh-TW");
  await store.refresh("C:/repo");
  if (store.getSnapshot().generateLanguage !== "zh-TW") throw new Error("a re-read must keep the language setting");
  store.setGenerateLanguage("auto");

  // The popover lives inside the panel's own box and goes away with the panel.
  // The open flag is store state (like `panelOpen`), which is what makes the
  // "collapsed panel springs a stale popover back open" case testable at all.
  store.setSettingsOpen(true);
  if (store.getSnapshot().settingsOpen !== true) throw new Error("setSettingsOpen must publish the flag");
  const openHtml = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  const backdropAt = openHtml.indexOf('data-dsh-git="settings-backdrop"');
  const popoverAt = openHtml.indexOf('data-dsh-git="settings-popover"');
  const bodyAt = openHtml.indexOf('data-dsh-git="changes"');
  if (backdropAt === -1 || popoverAt === -1) throw new Error("an open settings popover must render inside the panel");
  if (!(backdropAt < popoverAt && popoverAt < bodyAt)) {
    throw new Error(`unexpected panel order: backdrop=${backdropAt} popover=${popoverAt} body=${bodyAt}`);
  }
  store.setPanelOpen(false);
  if (store.getSnapshot().settingsOpen !== false) throw new Error("closing the panel must close the popover");
  store.setPanelOpen(true);
  const reopened = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  if (reopened.includes('data-dsh-git="settings-popover"')) throw new Error("a reopened panel must not show a stale popover");

  console.log("settings: header entry, popover inside the panel, custom field, and the forced language reaching the endpoint");
}

// ── automatic refresh ───────────────────────────────────────────────────────
// The panel used to read only on demand (↻, a completed action, a session
// switch), so a file changed in an editor or a commit made in a terminal stayed
// invisible. The intervals, the back-off and the "did anything change?" logic
// must not be asserted by waiting real seconds, so they are pure functions or
// run through injectable timers here; the real clicks live in
// test/ui/verify-auto-refresh.mjs.
{
  const {
    autoRefreshDelay,
    createAutoRefresher,
    frameSignature,
    diffValueSignature,
    readStoredAutoRefresh,
    settingsView: settingsComponent,
    AUTO_REFRESH_PANEL_MS: panelMs,
    AUTO_REFRESH_IDLE_MS: idleMs,
    AUTO_REFRESH_STORAGE_KEY: autoKey
  } = mod.__internals;

  for (const fn of [autoRefreshDelay, createAutoRefresher, frameSignature, diffValueSignature, readStoredAutoRefresh]) {
    if (typeof fn !== "function") throw new Error(`the auto-refresh surface must be exported for the render test: ${fn}`);
  }
  if (panelMs !== 4000 || idleMs !== 15000) throw new Error(`unexpected auto-refresh intervals: ${panelMs}/${idleMs}`);
  if (autoKey !== "dsh-git.autoRefresh") throw new Error(`unexpected auto-refresh storage key: ${autoKey}`);
  // No storage in this Node render: the default has to be ON, not undefined.
  if (readStoredAutoRefresh() !== true) throw new Error("without storage, auto refresh must default on");

  // ── the interval decision ────────────────────────────────────────────────
  const off = { enabled: false, cwd: "C:/repo", hidden: false, busy: null, panelOpen: true, failures: 0, lastDurationMs: 0 };
  if (autoRefreshDelay(off) !== null) throw new Error("the switch off must stop scheduling");
  if (autoRefreshDelay({ ...off, enabled: true, cwd: null }) !== null) throw new Error("no workspace must stop scheduling");
  if (autoRefreshDelay({ ...off, enabled: true, hidden: true }) !== null) throw new Error("a hidden page must stop scheduling");
  const openDelay = autoRefreshDelay({ ...off, enabled: true });
  const closedDelay = autoRefreshDelay({ ...off, enabled: true, panelOpen: false });
  if (openDelay !== 4000 || closedDelay !== 15000) throw new Error(`unexpected intervals: open=${openDelay} closed=${closedDelay}`);
  const busyDelay = autoRefreshDelay({ ...off, enabled: true, busy: "push", panelOpen: false });
  if (!(busyDelay !== null && busyDelay <= 2000)) throw new Error(`an action in flight must only pause briefly: ${busyDelay}`);
  if (autoRefreshDelay({ ...off, enabled: true, lastDurationMs: 5000 }) !== 20000) throw new Error("a slow status must widen the interval fourfold");
  const backoff1 = autoRefreshDelay({ ...off, enabled: true, failures: 1 });
  const backoff3 = autoRefreshDelay({ ...off, enabled: true, failures: 3 });
  if (!(backoff1 > openDelay && backoff3 > backoff1 && backoff3 <= 60000)) {
    throw new Error(`back-off must grow and then cap: ${backoff1} -> ${backoff3}`);
  }

  // ── data signatures: UI state must never trigger a re-render ─────────────
  const base = store.getSnapshot();
  if (frameSignature(base) !== frameSignature({ ...base, panelOpen: !base.panelOpen, refreshing: !base.refreshing, autoRefresh: false })) {
    throw new Error("UI state must stay out of the data signature");
  }
  if (frameSignature(base) === frameSignature({ ...base, dirty: base.dirty + 1 })) throw new Error("data must move the signature");
  const diffFixture = {
    repo: true, path: "src/a.js", origPath: null, untracked: false, skipped: 0,
    worktree: { diff: "+x", binary: false, truncated: false },
    index: { diff: "", binary: false, truncated: false }
  };
  if (diffValueSignature(diffFixture) !== diffValueSignature({ ...diffFixture })) throw new Error("the same patch must keep the same signature");
  if (diffValueSignature(diffFixture) === diffValueSignature({ ...diffFixture, worktree: { diff: "+y", binary: false, truncated: false } })) {
    throw new Error("new patch bytes must move the diff signature");
  }

  // ── the scheduler, on a fake clock ───────────────────────────────────────
  let nowMs = 0;
  const queue = [];
  const timers = {
    setTimeout(fn, ms) {
      const handle = { fn, at: nowMs + ms };
      queue.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      const index = queue.indexOf(handle);
      if (index >= 0) queue.splice(index, 1);
    }
  };
  const pollerState = { enabled: true, cwd: "C:/repo", hidden: false, busy: null, panelOpen: true };
  let polls = 0;
  let nextPoll = { ok: true };
  const refresher = createAutoRefresher({
    getState: () => pollerState,
    pollOnce: () => { polls += 1; nowMs += 5; return Promise.resolve(nextPoll); },
    timers,
    now: () => nowMs,
    hidden: () => pollerState.hidden === true,
    doc: null
  });
  const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
  // `fire` plays the fake clock's part: advance to the armed instant, drop the
  // handle (a real timer would be gone), then run it.
  const fire = () => {
    const handle = queue.shift();
    if (handle === undefined) throw new Error("no timer was armed");
    nowMs = Math.max(nowMs, handle.at);
    handle.fn();
  };

  const dispose = refresher.start();
  if (queue.length !== 1 || queue[0].at !== 4000) throw new Error(`start must arm one timer at the panel interval: ${JSON.stringify(queue)}`);
  fire();
  await settle();
  if (polls !== 1) throw new Error(`the timer must poll, got ${polls}`);
  if (queue.length !== 1 || queue[0].at - nowMs < 4000) throw new Error("the poller must re-arm at the panel interval");

  // A hidden page pauses completely; coming back reads at once.
  pollerState.hidden = true;
  fire();
  await settle();
  if (polls !== 1 || queue.length !== 0) throw new Error(`a hidden page must neither poll nor schedule: polls=${polls} queue=${queue.length}`);
  pollerState.hidden = false;
  refresher.wake();
  await settle();
  if (polls !== 2) throw new Error(`wake must read immediately, got ${polls}`);

  // Failures back off (a host restart answers 405 for a while).
  nextPoll = { ok: false };
  fire();
  await settle();
  fire();
  await settle();
  if (refresher.getStats().failures !== 2) throw new Error(`failures must accumulate: ${JSON.stringify(refresher.getStats())}`);
  const backedOff = queue[0].at - nowMs;
  if (!(backedOff > 4000)) throw new Error(`a failing host must back off, got ${backedOff}`);
  nextPoll = { ok: true };
  fire();
  await settle();
  if (refresher.getStats().failures !== 0) throw new Error("a success must clear the failure count");
  dispose();
  if (queue.length !== 0 || refresher.getStats().running !== false) throw new Error("dispose must stop the timer");

  // ── the switch ───────────────────────────────────────────────────────────
  if (store.getSnapshot().autoRefresh !== true) throw new Error("auto refresh must default on in the store");
  store.setAutoRefresh(false);
  if (store.getSnapshot().autoRefresh !== false) throw new Error("the switch must publish on the shared state");
  store.setAutoRefresh(true);
  if (store.getSnapshot().autoRefresh !== true) throw new Error("the switch must turn back on");

  const autoOffView = renderToStaticMarkup(React.createElement(settingsComponent, {
    t: commonProps.t, language: "auto", customText: "", autoRefresh: false,
    onLanguage: () => {}, onCustomText: () => {}, onAutoRefresh: () => {}, onClose: () => {}
  }));
  for (const needle of ['data-dsh-git="settings-auto-refresh"', 'aria-pressed="false"', "settings.autoRefresh.hint", "settings.autoRefresh.off"]) {
    if (!autoOffView.includes(needle)) throw new Error(`the switched-off popover must show ${JSON.stringify(needle)}`);
  }
  const autoOnView = renderToStaticMarkup(React.createElement(settingsComponent, {
    t: commonProps.t, language: "auto", customText: "", autoRefresh: true,
    onLanguage: () => {}, onCustomText: () => {}, onAutoRefresh: () => {}, onClose: () => {}
  }));
  if (!autoOnView.includes('aria-pressed="true"') || !autoOnView.includes("settings.autoRefresh.on")) {
    throw new Error("the on state must be visible in the popover");
  }
  // Both seats share the same state: the pill shows the same dirty count the
  // panel does, and neither owns the switch.
  if (typeof store.startAutoRefresh !== "function" || typeof store.setAutoRefresh !== "function") {
    throw new Error("the store must expose the auto-refresh face used by apply()");
  }

  console.log("auto refresh: intervals, back-off, data signatures, scheduler on a fake clock, switch + popover row");
}

// ── stash / discard / amend ────────────────────────────────────────────────
// The three "take it back" actions. Their decisions are pure, or they live in
// component state that SSR cannot click (the pending discard, the amend switch),
// so every one is asserted through its exported helper; the rendered workbench
// only proves the controls exist and the order of the body.
{
  const {
    stashDraft,
    stashable,
    discardIntent,
    discardConfirmView,
    amendView,
    networkPrimary: net,
    sectionView: sections
  } = mod.__internals;
  for (const fn of [stashDraft, stashable, discardIntent, discardConfirmView, amendView]) {
    if (typeof fn !== "function") throw new Error("the stash/discard/amend helpers must be exported for the render test");
  }

  // Default stash message: git-style wording, never the composer's draft.
  if (stashDraft({ branch: "main" }).message !== "WIP on main") throw new Error("stashDraft must name the branch");
  if (stashDraft({ branch: null }).message !== "WIP") throw new Error("stashDraft must survive a detached HEAD");
  if (stashDraft(null).message !== "WIP") throw new Error("stashDraft must survive an empty snapshot");

  // git stash push (without -u) only stores TRACKED changes: an untracked-only
  // tree must disable the button instead of failing after the click.
  if (stashable({ changes: [{ status: "modified" }] }) !== true) throw new Error("a tracked change is stashable");
  if (stashable({ changes: [{ status: "untracked" }] }) !== false) throw new Error("an untracked-only tree is not stashable");
  if (stashable({ changes: [] }) !== false) throw new Error("a clean tree is not stashable");
  if (stashable(null) !== false) throw new Error("an empty snapshot is not stashable");

  // Discard intent: untracked → clean, conflict → refused, everything else →
  // restore. The host makes the same call again from its own status read.
  if (discardIntent({ status: "untracked" }).clean !== true) throw new Error("untracked paths discard by clean");
  if (discardIntent({ status: "conflict" }).refuse !== true) throw new Error("conflicted paths are refused");
  const trackedIntent = discardIntent({ status: "modified" });
  if (trackedIntent.clean === true || trackedIntent.refuse === true) throw new Error("tracked paths discard by restore");

  // The confirmation strip says DELETE for an untracked path and RESTORE
  // otherwise, carries both buttons, and disables them while busy.
  const trackedConfirm = renderToStaticMarkup(discardConfirmView({
    path: "src/a.js", clean: false, busy: false, onApply: () => {}, onCancel: () => {}
  }, commonProps.t));
  for (const needle of ['data-dsh-git="discard-confirm"', 'data-dsh-git="discard-apply"', 'data-dsh-git="discard-cancel"', "discard.confirm", "discard.apply", "discard.cancel"]) {
    if (!trackedConfirm.includes(needle)) throw new Error(`the discard strip is missing ${JSON.stringify(needle)}`);
  }
  if (trackedConfirm.includes("discard.confirmUntracked")) throw new Error("a tracked path must not be worded as a deletion");
  const untrackedConfirm = renderToStaticMarkup(discardConfirmView({
    path: "b.txt", clean: true, busy: false, onApply: () => {}, onCancel: () => {}
  }, commonProps.t));
  if (!untrackedConfirm.includes("discard.confirmUntracked")) throw new Error("an untracked path must be worded as a deletion");
  const busyConfirm = renderToStaticMarkup(discardConfirmView({
    path: "b.txt", clean: true, busy: true, onApply: () => {}, onCancel: () => {}
  }, commonProps.t));
  if (!/data-dsh-git="discard-apply"[^>]*disabled/.test(busyConfirm)) throw new Error("a busy panel must disable the discard button");

  // The amend row: folded by default (a quiet line under the commit button, not
  // a full-width button beside "stage all"), and while on it explains itself and
  // offers the "load the last message" button; a failed read shows the reason.
  const amendOff = renderToStaticMarkup(amendView({
    on: false, loading: false, error: null, onToggle: () => {}, onLoad: () => {}
  }, commonProps.t));
  if (!amendOff.includes('data-dsh-git="amend-toggle"') || !amendOff.includes('aria-pressed="false"')) throw new Error("the amend toggle must start off");
  if (!amendOff.includes('aria-expanded="false"')) throw new Error("the folded amend line must advertise itself as collapsed");
  if (amendOff.includes("flex:1 1 0")) throw new Error("the amend toggle must not be an equal-width row button any more");
  if (amendOff.includes('data-dsh-git="amend-load"') || amendOff.includes("amend.hint")) throw new Error("the amend row must stay compact while off");
  const amendOn = renderToStaticMarkup(amendView({
    on: true, loading: false, error: null, onToggle: () => {}, onLoad: () => {}
  }, commonProps.t));
  for (const needle of ['aria-pressed="true"', 'aria-expanded="true"', 'data-dsh-git="amend-load"', "amend.hint"]) {
    if (!amendOn.includes(needle)) throw new Error(`the amend row is missing ${JSON.stringify(needle)}`);
  }
  const amendNoCommit = renderToStaticMarkup(amendView({
    on: true, loading: false, error: "amend.noCommit", onToggle: () => {}, onLoad: () => {}
  }, commonProps.t));
  if (!amendNoCommit.includes("amend.noCommit") || amendNoCommit.includes("amend.hint")) {
    throw new Error("an amend read failure must replace the hint with its reason");
  }

  // Pre-amend pre-flight: when the host reports HEAD is already on a remote the
  // panel does NOT enter the mode — it asks first, naming the remote refs, and
  // only "amend anyway" (or a second click) continues. Amending a published
  // commit forces a force push, which this plugin never performs.
  const amendWarn = renderToStaticMarkup(amendView({
    on: false,
    loading: false,
    error: null,
    warning: { refs: ["origin/main", "upstream/main"], upstream: "origin/main" },
    onToggle: () => {}, onLoad: () => {}, onConfirm: () => {}, onCancel: () => {}
  }, commonProps.t));
  for (const needle of [
    'data-dsh-git="amend-warn"',
    'data-dsh-git="amend-warn-confirm"',
    'data-dsh-git="amend-warn-cancel"',
    "amend.pushedWarn",
    "amend.pushedOk",
    "amend.pushedCancel",
    "origin/main, upstream/main"
  ]) {
    if (!amendWarn.includes(needle)) throw new Error(`the pre-amend warning is missing ${JSON.stringify(needle)}`);
  }
  if (!amendWarn.includes('aria-pressed="false"')) throw new Error("the warning must not turn the amend mode on by itself");
  if (amendWarn.includes('data-dsh-git="amend-load"')) throw new Error("the warning must not pre-fill a message before the user confirms");

  // Amend and the network toolbar's composite action cannot both apply: the
  // button disables with a localized reason instead of silently committing.
  const blocked = net({ dirty: 2, ahead: 0, upstream: "origin/main", oid: "abc1234", detached: false }, "feat: x", true);
  if (blocked.action !== null || blocked.reason !== "amend.conflict") throw new Error(`amend must disable commit-and-push: ${JSON.stringify(blocked)}`);
  if (net({ dirty: 2, ahead: 0, upstream: "origin/main", oid: "abc1234", detached: false }, "feat: x").action !== "commitPush") {
    throw new Error("the two-argument call must keep its old behaviour");
  }

  // The rendered workbench carries the three controls; the stash card starts
  // folded, so its rows only appear once expanded (driven through sectionView).
  await store.refresh("C:/repo");
  store.setPanelOpen(true);
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  for (const needle of [
    'data-dsh-git="stash-header"',
    'data-dsh-git="stash-push"',
    'data-dsh-git="stash"',
    'data-dsh-git="amend"',
    'data-dsh-git="amend-toggle"',
    'data-dsh-git="change-discard"'
  ]) {
    if (!html.includes(needle)) throw new Error(`the panel is missing ${JSON.stringify(needle)}`);
  }
  if (html.includes('data-dsh-git="stash-body"')) throw new Error("the stash card must start folded");
  // The frequent controls (stage all / draft basis / generate) own the row; the
  // rare amend line lives below the composer, so no row neighbours it.
  const amendAt = html.indexOf('data-dsh-git="amend"');
  const composerAt = html.indexOf("<textarea");
  if (amendAt < 0) throw new Error("the amend line is missing from the panel");
  if (!(composerAt >= 0 && amendAt > composerAt)) {
    throw new Error("the amend line must sit BELOW the composer, not beside the stage-all row");
  }
  if (html.split('data-dsh-git="change-discard"').length - 1 !== 2) {
    throw new Error("every non-conflicted change row needs a discard control");
  }
  const stashSection = renderToStaticMarkup(sections({
    hook: "stash",
    label: "stash.title",
    count: 1,
    open: true,
    all: true,
    cap: 3,
    empty: "stash.empty",
    rows: [React.createElement("button", { key: "pop", "data-dsh-git": "stash-pop" }, "pop")],
    onToggle: () => {},
    onMore: () => {},
    actions: [React.createElement("button", { key: "push", "data-dsh-git": "stash-push" }, "push")]
  }, commonProps.t));
  for (const needle of ['data-dsh-git="stash-head"', 'data-dsh-git="stash-push"', 'data-dsh-git="stash-pop"']) {
    if (!stashSection.includes(needle)) throw new Error(`an expanded stash card is missing ${JSON.stringify(needle)}`);
  }

  // Verbs and wire payloads: amend travels as `amend: true`, a plain commit does
  // not grow the field, and the four new endpoints carry exactly their args.
  await store.verbs.stash("C:/repo", "WIP on main", false);
  let last = sent[sent.length - 1];
  if (last.endpoint !== "stash" || last.payload.args.message !== "WIP on main" || last.payload.args.includeUntracked !== false) {
    throw new Error(`stash verb payload: ${JSON.stringify(last)}`);
  }
  await store.verbs.stashPop("C:/repo", "stash@{0}");
  last = sent[sent.length - 1];
  if (last.endpoint !== "stashPop" || last.payload.args.ref !== "stash@{0}") throw new Error(`stashPop verb payload: ${JSON.stringify(last)}`);
  await store.verbs.discard("C:/repo", "src/a.js", null);
  last = sent[sent.length - 1];
  if (last.endpoint !== "discard" || last.payload.args.path !== "src/a.js" || last.payload.args.origPath !== null) {
    throw new Error(`discard verb payload: ${JSON.stringify(last)}`);
  }
  await store.verbs.headMessage("C:/repo");
  last = sent[sent.length - 1];
  if (last.endpoint !== "headMessage") throw new Error(`headMessage verb payload: ${JSON.stringify(last)}`);
  await store.verbs.amendCheck("C:/repo");
  last = sent[sent.length - 1];
  if (last.endpoint !== "amendCheck" || last.payload.args.cwd !== "C:/repo") {
    throw new Error(`amendCheck verb payload: ${JSON.stringify(last)}`);
  }
  await store.verbs.commit("C:/repo", "amend: rewrite", true);
  last = sent[sent.length - 1];
  if (last.endpoint !== "commit" || last.payload.args.amend !== true) throw new Error(`amend commit payload: ${JSON.stringify(last)}`);
  await store.verbs.commit("C:/repo", "plain commit");
  last = sent[sent.length - 1];
  if ("amend" in last.payload.args) throw new Error("a plain commit must not send the amend field");

  console.log("stash/discard/amend: pure decisions, confirmation strip, amend row, panel controls and wire payloads");
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

// Operation output: the card is the FIRST thing in the panel body, git's own
// words hide behind a toggle, and escapes are stripped at the transport
// boundary. Previously git's raw text WAS the notification, so a push banner or
// three LF/CRLF warnings were all the user saw.
{
  const CLEAN = "remote: Powered by GITEE.COM [1.1.23]\nTo gitee.com:x/y.git\n   abc1234..def5678  main -> main";
  const pushed = await store.act("push", () => store.verbs.push("C:/repo"));
  if (pushed?.ok !== true) throw new Error("push verb failed");
  const pushResult = store.getSnapshot().lastResult;
  if (pushResult?.kind !== "ok" || pushResult.action !== "push") {
    throw new Error(`unexpected push result: ${JSON.stringify(pushResult)}`);
  }
  if (pushResult.text !== null) throw new Error("a success must be worded by the panel's own summary, not by git's text");
  if (pushResult.detail !== CLEAN) throw new Error(`unexpected sanitized banner: ${JSON.stringify(pushResult.detail)}`);
  if (pushResult.detail.includes("\u001B")) throw new Error("ESC bytes must never reach the panel");
  if (pushResult.detail.includes("[01;33m") || pushResult.detail.includes("[0[m")) {
    throw new Error(`banner parameters leaked into the panel: ${JSON.stringify(pushResult.detail)}`);
  }

  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  const outputAt = html.indexOf('data-dsh-git="output"');
  const changesAt = html.indexOf('data-dsh-git="change-row"');
  if (outputAt < 0) throw new Error("the operation output box must carry its test hook");
  if (changesAt < 0) throw new Error("change rows missing from the expanded panel");
  if (!(outputAt < changesAt)) throw new Error("the operation output must render above the change list");
  if (!html.includes("output.push")) throw new Error("the card must show the localized action phrase");
  if (html.includes("Powered by GITEE.COM")) throw new Error("git's raw output must stay collapsed until asked for");
  if (!html.includes('data-dsh-git="output-toggle"')) throw new Error("a result carrying git output must offer the detail toggle");

  // Expanded: the same card carries git's words verbatim.
  const { stripAnsiEscapes, outputView } = mod.__internals;
  if (typeof outputView !== "function") throw new Error("client must expose outputView for the render test");
  const expanded = renderToStaticMarkup(outputView(pushResult, commonProps.t, true, () => {}));
  if (!expanded.includes("Powered by GITEE.COM") || !expanded.includes('data-dsh-git="output-detail"')) {
    throw new Error(`the expanded card must show git's raw output: ${expanded}`);
  }

  // A diff body is data, not a message: the transport must not rewrite it.
  const diffRes = await store.verbs.diff("C:/repo", "src/a.js", null);
  if (diffRes?.value?.worktree?.diff !== WORKTREE_DIFF) throw new Error("the diff body must pass through byte-faithful");

  // The stripper itself: complete and truncated CSI, OSC, and plain text.
  if (typeof stripAnsiEscapes !== "function") throw new Error("client must expose stripAnsiEscapes for the render test");
  if (stripAnsiEscapes("a\u001B[31mb\u001B[0m") !== "ab") throw new Error("complete SGR sequences must be removed");
  if (stripAnsiEscapes("x\u001B[0\u001B[01;33mY") !== "xY") throw new Error("a truncated CSI must be dropped too");
  if (stripAnsiEscapes("\u001B]0;title\u0007kept") !== "kept") throw new Error("OSC sequences must be removed");
  if (stripAnsiEscapes("plain text") !== "plain text") throw new Error("plain text must be untouched");

  // The reported case: `git add` on a CRLF checkout answers with three lines of
  // advice. The notification must be one short localized line; the advice is the
  // detail.
  const staged = await store.act("stage", () => store.verbs.stage("C:/repo"));
  if (staged?.ok !== true) throw new Error("stage verb failed");
  const stageResult = store.getSnapshot().lastResult;
  if (stageResult.text !== null) throw new Error("the LF/CRLF warnings must not be the summary line");
  if (!stageResult.detail.includes("LF will be replaced by CRLF")) throw new Error("git's warnings must survive as detail");
  const stageHtml = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  if (!stageHtml.includes("output.stage")) throw new Error("the stage card must show the localized summary");
  if (stageHtml.includes("LF will be replaced by CRLF")) throw new Error("the warnings must start collapsed");
  if (stageHtml.indexOf('data-dsh-git="output"') > stageHtml.indexOf('data-dsh-git="change-row"')) {
    throw new Error("the card must stay at the top of the body");
  }
  const collapsed = renderToStaticMarkup(outputView(pushResult, commonProps.t, false, () => {}));
  if (collapsed.includes("Powered by")) throw new Error(`a collapsed card must hide git's output: ${collapsed}`);
  console.log("operation card:", JSON.stringify(collapsed.slice(0, 240)));
  console.log("operation output:", JSON.stringify(pushResult.detail.slice(0, 48)), "/ stage summary is one localized line");
}

// The operation card belongs to ONE repository. Switching the session/workspace
// used to keep it (it was preserved unconditionally so a failed action's card
// would not vanish), so a failed push from the previous workspace stayed pinned
// above the next repository's clean header. A same-workspace re-read must still
// keep it — that is the "refreshing never flashes" rule.
{
  const pushed = await store.act("push", () => store.verbs.push("C:/repo"));
  if (pushed?.ok !== true) throw new Error("push fixture failed");
  if (store.getSnapshot().lastResult === null) throw new Error("a completed action must publish its result card");
  await store.refresh("C:/repo");
  if (store.getSnapshot().lastResult === null) throw new Error("a same-workspace re-read must keep the result card");

  await store.refresh("C:/other");
  if (store.getSnapshot().lastResult !== null) {
    throw new Error(`an operation card must not follow a workspace switch: ${JSON.stringify(store.getSnapshot().lastResult)}`);
  }
  // Switching back does not resurrect the stale card either.
  await store.refresh("C:/repo");
  if (store.getSnapshot().lastResult !== null) throw new Error("a stale operation card must not come back");
  // Leave one card in place for the later body-order assertions (they expect the
  // feedback block above the lists).
  await store.act("push", () => store.verbs.push("C:/repo"));
  console.log("workspace switch: the operation card never follows another repository");
}

// The push verb forwards an optional Session id. The panel supplies it so the
// host can ask the optional forge-session service to discover the branch's open
// change request (a panel push is not a shell tool call, which is the only thing
// forge-session's projection watches). The field stays absent when there is no
// Session: an older host must not receive a half-filled hint.
{
  await store.verbs.push("C:/repo", "s1");
  let lastPush = sent[sent.length - 1];
  if (lastPush.endpoint !== "push" || lastPush.payload.args.sessionId !== "s1") {
    throw new Error(`the push must carry the session id: ${JSON.stringify(lastPush)}`);
  }
  await store.verbs.push("C:/repo");
  lastPush = sent[sent.length - 1];
  if ("sessionId" in lastPush.payload.args) {
    throw new Error(`a push without a session must omit the field: ${JSON.stringify(lastPush)}`);
  }
  console.log("push: session id forwarded only when one is given");
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
  // The status chip trails the path (paths line up in one column), and it is
  // tinted from the status's own state colour instead of one grey chip for all.
  const pathAt = html.indexOf(">src/a.js<");
  const tagAt = html.indexOf(">status.modified<");
  if (!(pathAt >= 0 && tagAt >= 0 && pathAt < tagAt)) {
    throw new Error("the status chip must render after the path inside the row");
  }
  if (!html.includes("color-mix")) throw new Error("status chips must tint from the theme, not hardcoded rgba");
  console.log("change rows rendered as controls:", rows);
}

// List sections: the header collapses the section, the footer widens a long list.
// Two separate states — one flag doing both made the chevron point the wrong way
// for a list that was already on screen.
{
  const { sectionView } = mod.__internals;
  if (typeof sectionView !== "function") throw new Error("client must expose sectionView for the render test");
  const rows = Array.from({ length: 12 }, (_, index) => React.createElement("div", { key: index, "data-row": index }, `row ${index}`));
  const spec = {
    hook: "probe",
    label: "probe.label",
    count: 12,
    open: true,
    all: false,
    cap: 8,
    empty: "empty",
    rows,
    onToggle: () => {},
    onMore: () => {}
  };
  const preview = renderToStaticMarkup(sectionView(spec, commonProps.t));
  if ((preview.split("data-row=").length - 1) !== 8) throw new Error(`the preview must stop at the cap: ${preview}`);
  if (!preview.includes('data-dsh-git="probe-more"')) throw new Error("a long list must offer its show-all footer");
  if (!preview.includes("section.more")) throw new Error("the footer must say how many rows are hidden");
  if (!preview.includes('aria-expanded="true"')) throw new Error("an open section must say so");

  const all = renderToStaticMarkup(sectionView({ ...spec, all: true }, commonProps.t));
  if ((all.split("data-row=").length - 1) !== 12) throw new Error(`show-all must render every row: ${all}`);
  if (!all.includes("section.less")) throw new Error("an expanded footer must offer the way back");

  const closed = renderToStaticMarkup(sectionView({ ...spec, open: false }, commonProps.t));
  if (closed.includes("data-row=")) throw new Error("a collapsed section must hide its rows entirely");
  if (!closed.includes('aria-expanded="false"')) throw new Error("a collapsed section must say so");

  const empty = renderToStaticMarkup(sectionView({ ...spec, count: 0, rows: [] }, commonProps.t));
  if (!empty.includes("empty")) throw new Error("an empty section must show its empty wording");

  // And in the real panel: both sections start open with their count on the header.
  const panelHtml = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  for (const hook of ["changes-header", "log-header"]) {
    if (!panelHtml.includes(`data-dsh-git="${hook}"`)) throw new Error(`missing section header hook ${hook}`);
  }
  if (panelHtml.includes('data-dsh-git="changes-more"')) throw new Error("a two-file list needs no show-all footer");
  console.log("sections: preview 8/12 + show-all footer, collapse hides rows, panel sections carry their headers");
}

// A re-read of the SAME workspace must not blank the body: flipping to "loading"
// collapsed the whole workbench and snapped it back (the jump on ↻). The store
// reports the re-read through `refreshing` and keeps the data on screen.
{
  const during = store.refresh("C:/repo");
  const mid = store.getSnapshot();
  if (mid.refreshing !== true) throw new Error(`a same-workspace re-read must set refreshing, got ${JSON.stringify(mid.refreshing)}`);
  if (mid.phase !== "ready") throw new Error(`a same-workspace re-read must keep its data, got phase ${mid.phase}`);
  const midHtml = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  if (!midHtml.includes('data-dsh-git="change-row"')) throw new Error("the workbench must stay on screen while refreshing");
  if (midHtml.includes("loading")) throw new Error("a re-read must not fall back to the loading line");
  if (!midHtml.includes('aria-busy="true"')) throw new Error("the refresh button must report the re-read");
  await during;
  const after = store.getSnapshot();
  if (after.refreshing !== false) throw new Error("refreshing must clear when the re-read lands");
  if ((after.changes ?? []).length !== 2) throw new Error("the re-read must still land the fresh data");
  console.log("refresh: same-workspace re-read keeps the workbench and flags the button");
}

// Body order: feedback → status/branch → network toolbar → commit card →
// sections. The old layout interleaved auto-width buttons, so this is the guard
// that the panel reads top-down as one workflow.
{
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  const order = [
    'data-dsh-git="output"',
    "action.fetch",
    "action.pull",
    "action.push",
    "action.stage",
    "action.generate",
    "commit.placeholder",
    'data-dsh-git="changes-header"',
    'data-dsh-git="stash-header"',
    'data-dsh-git="log-header"'
  ];
  let previous = -1;
  for (const needle of order) {
    const at = html.indexOf(needle);
    if (at < 0) throw new Error(`body is missing ${needle}`);
    if (at < previous) throw new Error(`${needle} renders out of order (the body must read top-down)`);
    previous = at;
  }
  console.log("body order:", order.length, "blocks in workflow order");
}

// The network toolbar's primary button has two modes, and the retry path is the
// point: a failed commit-and-push leaves a clean tree and an empty composer, so
// a commit-only button was dead while the pill still showed "↑1". With unpushed
// commits it offers a plain push instead.
{
  const { networkPrimary } = mod.__internals;
  if (typeof networkPrimary !== "function") throw new Error("client must expose networkPrimary for the render test");
  const base = { dirty: 0, ahead: 0, upstream: "origin/main", oid: "abc1234", detached: false };

  if (networkPrimary({ ...base, dirty: 2 }, "feat: x").action !== "commitPush") {
    throw new Error("dirty tree + draft must commit and push");
  }
  // A failed push leaves exactly this: dirty leftovers or a clean tree, an empty
  // composer, and commits the upstream does not have.
  if (networkPrimary({ ...base, dirty: 2, ahead: 1 }, "").action !== "push") {
    throw new Error("unpushed commits must stay pushable with an empty draft");
  }
  if (networkPrimary({ ...base, ahead: 1 }, "").action !== "push") {
    throw new Error("a clean tree with unpushed commits must offer push");
  }
  const idle = networkPrimary(base, "");
  if (idle.action !== null || idle.reason !== "changes.none") {
    throw new Error(`nothing to do must disable the button: ${JSON.stringify(idle)}`);
  }
  const needMessage = networkPrimary({ ...base, dirty: 2 }, "");
  if (needMessage.action !== null || needMessage.reason !== "commit.empty") {
    throw new Error(`an empty draft must ask for a message: ${JSON.stringify(needMessage)}`);
  }
  if (networkPrimary({ ...base, upstream: null }, "").action !== "push") {
    throw new Error("a branch with no upstream must offer its first push");
  }
  if (networkPrimary({ ...base, detached: true, ahead: 1 }, "").action !== null) {
    throw new Error("a detached HEAD has no branch to push");
  }

  // In the panel (default fixture: dirty + ahead, empty draft) the toolbar shows
  // a plain push and it is ENABLED — the regression this test exists for.
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  if (html.includes("action.commitPush")) throw new Error("an empty draft must not claim it will commit");
  const at = html.indexOf("action.push");
  if (at < 0) throw new Error("the toolbar must offer push for unpushed commits");
  const tag = html.slice(html.lastIndexOf("<button", at), html.indexOf(">", at));
  if (tag.includes("disabled")) throw new Error("a failed push must not leave the button dead");

  // Clean tree and nothing unpushed: back to a disabled commit-and-push.
  statusValue = { ...statusValue, dirty: 0, ahead: 0, changes: [] };
  await store.refresh("C:/repo");
  const idleHtml = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  const idleAt = idleHtml.indexOf("action.commitPush");
  if (idleAt < 0) throw new Error("the idle toolbar must still show the commit-and-push label");
  const idleTag = idleHtml.slice(idleHtml.lastIndexOf("<button", idleAt), idleHtml.indexOf(">", idleAt));
  if (!idleTag.includes("disabled")) throw new Error("a clean, fully pushed tree must disable the primary action");

  // Restore the default fixture for the tests that follow.
  statusValue = { ...statusValue, dirty: 2, ahead: 1, changes: [{ status: "modified", path: "src/a.js" }, { status: "untracked", path: "b.txt" }] };
  await store.refresh("C:/repo");
  console.log("network primary: commit-and-push vs plain push (unpushed commits stay pushable after a failure)");
}

// The primary buttons must use the harness's contrast pairing. `brand-primary`
// is an INVERTED colour (near-black on light, near-white on dark), so pairing it
// with `#fff` made 推送 a blank white block and 提交 an empty grey box.
{
  const html = renderToStaticMarkup(React.createElement(bySlot["shell.overlay"].comp, commonProps));
  const primary = html.match(/style="[^"]*button-primary-fill[^"]*"/g) ?? [];
  if (primary.length !== 2) throw new Error(`expected both primary buttons on the button-primary-fill pairing, got ${primary.length}`);
  for (const style of primary) {
    if (!style.includes("--dsw-alias-label-primary-foreground")) {
      throw new Error(`a primary button carries no contrast label colour: ${style}`);
    }
  }
  if (/brand-primary[^"]*color:#fff/.test(html)) {
    throw new Error("brand-primary is a contrast colour, not an accent — never pair it with #fff");
  }
  console.log("primary buttons:", primary.length, "on the button-primary-fill / label-primary-foreground pairing");
}

// The diff parser: line numbers per side, kind classification, and the one case
// a naive file-header check gets wrong (a removed line whose text starts `--`).
{
  const { parseUnifiedDiff, parseDiffSide, diffRowView, diffWindow, DIFF_ROW } = mod.__internals;
  if (!parseUnifiedDiff || !parseDiffSide || !diffRowView) throw new Error("client must expose the diff internals for the render test");
  if (typeof diffWindow !== "function") throw new Error("client must expose diffWindow for the render test");

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
  // Per-file binary evidence: the names survive, unusable entries are dropped,
  // and a side with no such evidence keeps an empty list.
  if (parseDiffSide({ diff: "x", binary: false, truncated: false }).binaryPaths.length !== 0) throw new Error("binaryPaths must default to empty");
  const mixed = parseDiffSide({ diff: "text", binary: false, binaryPaths: ["a/pixel.bin", 42, ""], truncated: false });
  if (mixed.binaryPaths.length !== 1 || mixed.binaryPaths[0] !== "a/pixel.bin") throw new Error(`binaryPaths must keep only usable names: ${JSON.stringify(mixed.binaryPaths)}`);
  if (mixed.binary !== false) throw new Error("a mixed side is not a binary side");
  // Windowing math: a fixed-height row slice plus spacers that keep the
  // scrollbar honest. This is what replaces rendering every line at once.
  {
    const all = diffWindow(10, 0, 480, 18, 8);
    if (all.start !== 0 || all.end !== 10 || all.top !== 0 || all.bottom !== 0) throw new Error(`a small side must window to everything: ${JSON.stringify(all)}`);
    const top = diffWindow(100000, 0, 360, 18, 8);
    if (top.start !== 0 || top.end !== 28 || top.bottom !== (100000 - 28) * 18) throw new Error(`top window wrong: ${JSON.stringify(top)}`);
    const mid = diffWindow(100000, 18000, 360, 18, 8);
    if (mid.start !== 992 || mid.end !== 1028) throw new Error(`middle window wrong: ${JSON.stringify(mid)}`);
    if (mid.top !== 992 * 18 || mid.bottom !== (100000 - 1028) * 18) throw new Error(`spacers wrong: ${JSON.stringify(mid)}`);
    const bottom = diffWindow(100000, 100000 * 18, 360, 18, 8);
    if (bottom.end !== 100000) throw new Error(`the bottom window must clamp: ${JSON.stringify(bottom)}`);
    const empty = diffWindow(0, 0, 480, 18, 8);
    if (empty.start !== 0 || empty.end !== 0) throw new Error("an empty side has no rows to window");
    const unmeasured = diffWindow(100000, 0, 0, 18, 8);
    if (unmeasured.end !== 35) throw new Error(`an unmeasured viewport must use the fallback height: ${JSON.stringify(unmeasured)}`);
    const negative = diffWindow(10, -100, 0, 0, -3);
    if (negative.start !== 0 || negative.end !== 10) throw new Error(`garbage inputs must not break the window: ${JSON.stringify(negative)}`);
  }
  console.log("diff parser rows:", parsed.rows.length, "add/del:", parsed.additions, "/", parsed.deletions);
}

// Opening the diff must not let the pane's async content resize the panel: the
// two-pane box has a FIXED height, so nothing can jump once the diff lands.
{
  const { panelBoxStyle, DIFF_PANEL_HEIGHT } = mod.__internals;
  if (typeof panelBoxStyle !== "function") throw new Error("client must expose panelBoxStyle for the render test");
  const single = panelBoxStyle(null, 560);
  if (single.height !== undefined) throw new Error("the compact panel stays content-sized");
  if (single.width !== 400) throw new Error(`unexpected single-pane width: ${single.width}`);
  const split = panelBoxStyle({ file: "src/a.js" }, 560);
  if (split.height === undefined || split.height !== split.maxHeight) {
    throw new Error(`the two-pane panel must pin its height, got ${JSON.stringify({ height: split.height, maxHeight: split.maxHeight })}`);
  }
  if (split.height !== DIFF_PANEL_HEIGHT) throw new Error("the two-pane height must come from the shared constant");
  if (split.width !== 300 + 2 + 560) throw new Error(`unexpected two-pane width: ${split.width}`);
  console.log("panel box: single content-sized, two-pane pinned at", DIFF_PANEL_HEIGHT);
}

// The draft route reads BOTH projection surfaces the host has shipped: the
// session row's own `projectionValues` (0.1.6+) and the snapshot's per-session
// `projectionsBySession[id].values` (0.1.7+). Losing either one silently
// degrades every draft to the host's first registered route.
{
  const { sessionModelRoute } = mod.__internals;
  if (typeof sessionModelRoute !== "function") throw new Error("client must expose sessionModelRoute for the render test");
  const rowSurface = sessionModelRoute({ projectionValues: { modelSelection: { next: { provider: "p1", model: "m1" } } } }, undefined, "s1");
  if (rowSurface?.provider !== "p1" || rowSurface.model !== "m1") throw new Error(`row projectionValues route lost: ${JSON.stringify(rowSurface)}`);
  const snapshotSurface = sessionModelRoute(undefined, { projectionsBySession: { s1: { values: { modelSelection: { lastUsed: { provider: "p2", model: "m2" } } } } } }, "s1");
  if (snapshotSurface?.provider !== "p2" || snapshotSurface.model !== "m2") throw new Error(`projectionsBySession route lost: ${JSON.stringify(snapshotSurface)}`);
  // The row wins when both carry a value, and `next` (a pending pick) beats `lastUsed`.
  const both = sessionModelRoute(
    { projectionValues: { modelSelection: { lastUsed: { provider: "row", model: "r" } } } },
    { projectionsBySession: { s1: { values: { modelSelection: { next: { provider: "snap", model: "s" } } } } } },
    "s1"
  );
  if (both?.provider !== "row") throw new Error(`the row projection must win: ${JSON.stringify(both)}`);
  const pending = sessionModelRoute({ projectionValues: { modelSelection: { lastUsed: { provider: "old", model: "o" }, next: { provider: "new", model: "n" } } } }, undefined, "s1");
  if (pending?.provider !== "new") throw new Error(`the pending pick must win: ${JSON.stringify(pending)}`);
  // No route at all stays null, so generation falls back to the host's own pick.
  if (sessionModelRoute(undefined, { projectionsBySession: { s9: { values: {} } } }, "s1") !== null) {
    throw new Error("an absent projection must yield null");
  }
  if (sessionModelRoute(null, undefined, null) !== null) throw new Error("an unbound store must yield null");
  console.log("draft route: row + projectionsBySession surfaces both read, next beats lastUsed");
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
    changeVersion: "v1",
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


