// Real-browser check of the stash / discard / amend controls
// (run: node test/ui/verify-git-actions.mjs).
//
// Like verify-settings.mjs this needs NO dsh web and NO authentication: it
// serves this checkout over a loopback HTTP server and mounts the real client
// bundle in the browser's own Chrome against the real React UMD build. The RPC
// layer is a fixture that records every call, so the test can assert the exact
// wire payloads the three new actions send — the git side has its own end-to-end
// suites (test/stash.mjs, test/discard.mjs, test/commit.mjs).
//
// It writes test/ui/git-actions.png. DSH_GIT_UI_CHROME points at another Chrome
// binary. DSH_GIT_UI_SERVE_ONLY=1 serves the harness and stays alive instead of
// running the browser (for a sandbox that cannot spawn one; drive it with an
// already-running browser at the printed URL).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SHOT = join(ROOT, "test", "ui", "git-actions.png");
const CHROME = process.env.DSH_GIT_UI_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TYPES = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

const INDEX = `<!doctype html><html><head><meta charset="utf-8"><title>dsh-git actions harness</title>
<style>html,body{margin:0;height:100%;background:#14161a;font-family:system-ui,sans-serif}</style></head>
<body><div id="root"></div>
<script src="/node_modules/react/umd/react.development.js"></script>
<script src="/node_modules/react-dom/umd/react-dom.development.js"></script>
<script>window.__ModuleLoader__ = { load(h) { window.__handoff = h; } };</script>
<script src="/lib/client.js"></script>
<script>
(function () {
  var calls = [];
  var regs = {};
  var dicts = {};
  var active = null;
  window.__status = {
    repo: true, branch: "main", detached: false, oid: "abc1234", upstream: "origin/main",
    ahead: 0, behind: 0, dirty: 2,
    changes: [
      { status: "modified", path: "README.md", file: "README.md", origFile: null, index: " ", worktree: "M" },
      { status: "untracked", path: "notes.txt", file: "notes.txt", origFile: null, index: "?", worktree: "?" }
    ],
    stashes: []
  };
  function respond(endpoint, payload) {
    var status = window.__status;
    if (endpoint === "status") return { ok: true, value: status };
    if (endpoint === "branches") return { ok: true, value: { repo: true, current: status.branch, local: [{ name: status.branch, current: true, sha: status.oid, upstream: "origin/main" }], remote: [] } };
    if (endpoint === "log") return { ok: true, value: { repo: true, commits: [{ sha: status.oid, author: "me", subject: "init", refs: "HEAD -> " + status.branch }] } };
    if (endpoint === "headMessage") return { ok: true, value: { message: "feat: previous subject\\n\\nPrevious body." } };
    if (endpoint === "amendCheck") return { ok: true, value: { pushed: window.__amendPushed === true, refs: window.__amendPushed === true ? ["origin/main"] : [], upstream: "origin/main" } };
    if (endpoint === "diff") return { ok: true, value: { repo: true, path: payload && payload.args ? payload.args.path : "README.md", origPath: null, untracked: false, skipped: 0, worktree: { diff: "diff --git a/README.md b/README.md\\n--- a/README.md\\n+++ b/README.md\\n@@ -1 +1 @@\\n-old\\n+new\\n", binary: false, truncated: false }, index: { diff: "", binary: false, truncated: false } } };
    return { ok: true, value: { message: "" } };
  }
  var ctx = {
    effect: function (fn) { var d = fn(); return typeof d === "function" ? d : function () {}; },
    locale: { register: function (ns, d) { Object.assign(dicts, d); return function () {}; } },
    connection: { rpc: { call: async function (channel, endpoint, payload) { calls.push({ channel: channel, endpoint: endpoint, payload: payload }); return respond(endpoint, payload); } } },
    slots: {
      inject: function (name, cb) { regs[name] = { cb: cb }; },
      register: function (opts, comp) { active.opts = opts; active.comp = comp; return function () {}; }
    }
  };
  var mod = window.__handoff.factory(function (spec) {
    if (spec === "react") return React;
    throw new Error("unexpected require " + spec);
  });
  mod.apply(ctx);
  for (var name of ["shell.overlay", "conversation.input.dock"]) {
    active = regs[name];
    regs[name].cb();
  }
  active = null;
  function makeT(dict) {
    return function (key, params) {
      var text = dict[key];
      if (text === undefined) return key;
      if (params) Object.keys(params).forEach(function (k) { text = text.split("{" + k + "}").join(String(params[k])); });
      return text;
    };
  }
  var store = regs["shell.overlay"].opts.inject().store;
  var panelComp = regs["shell.overlay"].comp;
  var summary = { cwd: "/repo", retainedBy: { mainView: 1 } };
  window.__store = store;
  window.__calls = calls;
  window.__ready = false;
  store.bindSession("s1", "/repo");
  store.refresh("/repo").then(function () {
    var root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(React.createElement(panelComp, {
      store: store,
      t: makeT(dicts.zh),
      sessionId: "s1",
      useSessions: function () { return { ids: ["s1"], byId: { s1: summary } }; }
    }));
    window.__ready = true;
  });
})();
</script></body></html>`;

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (pathname === "/") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(INDEX);
    return;
  }
  try {
    const body = await readFile(join(ROOT, pathname.replace(/^\/+/, "")));
    res.setHeader("content-type", TYPES[extname(pathname)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// Serve-only mode for an environment that cannot spawn a browser (AGENTS.md §8):
// keep the process alive so an already-running browser can drive the harness.
if (process.env.DSH_GIT_UI_SERVE_ONLY === "1") {
  console.log(`GIT-ACTIONS HARNESS SERVING AT ${origin}/  (serve-only; stop the process to end)`);
  await new Promise(() => {});
}

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures += 1;
  console.error(`  FAIL ${label}${detail === undefined ? "" : `: ${detail}`}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

/** The last recorded call for one endpoint. */
const lastCall = (endpoint) => page.evaluate((ep) => {
  const calls = window.__calls.filter((call) => call.endpoint === ep);
  return calls.length === 0 ? null : calls[calls.length - 1];
}, endpoint);

try {
  await page.goto(origin + "/");
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
  await page.evaluate(() => window.__store.setPanelOpen(true));
  await page.waitForSelector('[data-dsh-git="panel"]', { timeout: 10000 });

  // ── discard: ✕ → confirmation strip → cancel, then confirm ─────────────
  check("a non-conflicted change row carries a discard control", await page.locator('[data-dsh-git="change-discard"]').count() === 2);
  await page.click('[data-dsh-git="change-discard"]');
  await page.waitForSelector('[data-dsh-git="discard-confirm"]', { timeout: 5000 });
  check("clicking ✕ opens the confirmation strip", true);
  check("the strip names the file", (await page.locator('[data-dsh-git="discard-confirm"]').textContent()).includes("README.md"));
  check("the diff did not open from the ✕ click", await page.locator('[data-dsh-git="diff"]').count() === 0);
  await page.click('[data-dsh-git="discard-cancel"]');
  await page.waitForTimeout(150);
  check("cancelling drops the strip", await page.locator('[data-dsh-git="discard-confirm"]').count() === 0);
  check("cancelling sends no request", (await lastCall("discard")) === null);

  await page.click('[data-dsh-git="change-discard"]');
  await page.waitForSelector('[data-dsh-git="discard-confirm"]');
  await page.click('[data-dsh-git="discard-apply"]');
  await page.waitForTimeout(250);
  const discard = await lastCall("discard");
  check("confirming sends the discard request", discard !== null && discard.payload.args.path === "README.md" && discard.payload.args.origPath === null, JSON.stringify(discard?.payload));

  // ── stash: the shelf action sends git's own WIP label ───────────────────
  await page.click('[data-dsh-git="stash-push"]');
  await page.waitForTimeout(250);
  const stash = await lastCall("stash");
  check("the stash action sends a WIP message", stash !== null && stash.payload.args.message === "WIP on main", JSON.stringify(stash?.payload));
  check("the stash action does not include untracked files by default", stash.payload.args.includeUntracked === false);

  // ── the shelf lists what status returned, and restores one entry ───────
  await page.evaluate(() => {
    window.__status.stashes = [{ ref: "stash@{0}", subject: "On main: WIP on main" }];
    return window.__store.refresh("/repo");
  });
  await page.waitForTimeout(200);
  await page.click('[data-dsh-git="stash-header"]');
  await page.waitForSelector('[data-dsh-git="stash-pop"]', { timeout: 5000 });
  check("the stash card shows the entry", (await page.locator('[data-dsh-git="stash-pop"]').count()) === 1);
  await page.click('[data-dsh-git="stash-pop"]');
  await page.waitForTimeout(250);
  const pop = await lastCall("stashPop");
  check("restoring sends the exact stash ref", pop !== null && pop.payload.args.ref === "stash@{0}", JSON.stringify(pop?.payload));

  // ── a panel push carries the Session id (forge discovery hint) ──────────
  // A panel push is not a shell tool call, so the host uses this id to ask the
  // optional forge-session service to discover the branch's open change
  // request. Make the toolbar's third button the plain "Push" mode first.
  await page.evaluate(() => {
    window.__status.ahead = 1;
    window.__status.dirty = 0;
    window.__status.changes = [];
    return window.__store.refresh("/repo");
  });
  await page.waitForTimeout(250);
  const clickedPush = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('[data-dsh-git="panel"] button'))
      .find((candidate) => candidate.textContent.trim() === "推送" && candidate.disabled === false);
    if (button === undefined) return false;
    button.click();
    return true;
  });
  await page.waitForTimeout(250);
  const push = await lastCall("push");
  check("the network toolbar offers a plain push", clickedPush === true);
  check("the panel push carries the session id", push !== null && push.payload.args.sessionId === "s1", JSON.stringify(push?.payload));

  // ── amend on a published HEAD asks before rewriting it ──────────────────
  // The knock-on effect is a force push, which this plugin never performs, so
  // the mode must stay off until the user confirms the warning.
  await page.evaluate(() => { window.__amendPushed = true; });
  await page.click('[data-dsh-git="amend-toggle"]');
  await page.waitForSelector('[data-dsh-git="amend-warn"]', { timeout: 5000 });
  check("amend warns before rewriting a published commit", (await page.locator('[data-dsh-git="amend-warn-confirm"]').count()) === 1);
  check("the warning names the remote ref", (await page.locator('[data-dsh-git="amend-warn"]').innerText()).includes("origin/main"));
  check("the warning keeps amend mode off", (await page.locator('[data-dsh-git="amend-load"]').count()) === 0);
  await page.click('[data-dsh-git="amend-warn-cancel"]');
  await page.waitForTimeout(150);
  check("cancelling the warning leaves amend mode off", (await page.locator('[data-dsh-git="amend-warn"]').count()) === 0);
  await page.evaluate(() => { window.__amendPushed = false; });

  // ── amend: the toggle reads HEAD's message and the commit is an amend ───
  await page.click('[data-dsh-git="amend-toggle"]');
  await page.waitForTimeout(400);
  const headRequest = await lastCall("headMessage");
  check("enabling amend reads the last message", headRequest !== null, JSON.stringify(headRequest?.payload));
  const filled = await page.evaluate(() => document.querySelector("textarea").value);
  check("the composer is pre-filled with the last message", filled === "feat: previous subject\n\nPrevious body.", JSON.stringify(filled));
  const commitLabel = await page.locator('button:has-text("修改提交")').count();
  check("the commit button switches to amend", commitLabel === 1);
  check("commit-and-push is disabled while amending", await page.locator('[data-dsh-git="panel"] button:has-text("提交并推送")').isDisabled());
  await page.click('button:has-text("修改提交")');
  await page.waitForTimeout(250);
  const amend = await lastCall("commit");
  check("the amend request carries amend: true", amend !== null && amend.payload.args.amend === true, JSON.stringify(amend?.payload));
  check("the amend request carries the loaded message", amend.payload.args.message === "feat: previous subject\n\nPrevious body.", JSON.stringify(amend?.payload));

  await page.screenshot({ path: SHOT });
  console.log("screenshot:", SHOT);
  check("no page errors", pageErrors.length === 0, JSON.stringify(pageErrors));
} finally {
  await browser.close();
  server.close();
}

if (failures > 0) {
  console.error(`\n${failures} GIT-ACTIONS UI CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nGIT-ACTIONS UI CHECK PASSED (real Chrome + real React DOM + fixture RPC, no dsh web needed)");
