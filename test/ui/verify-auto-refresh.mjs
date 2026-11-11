// Real-browser check of the automatic refresh (run: node test/ui/verify-auto-refresh.mjs).
//
// Like verify-settings.mjs this needs NO dsh web and NO authentication: it
// serves this checkout over a loopback HTTP server and mounts the real client
// bundle in the browser's own Chrome against the real React UMD build. The RPC
// layer is a mutable fixture, which is what makes "a file changed outside the
// plugin" reproducible: the test rewrites `window.__status` / `window.__diffText`
// and then only waits — every DOM change it observes comes from the poller.
//
// The gate for the pure decisions (intervals, back-off, signatures) is
// test/render.mjs; this script asserts the parts only a real timer and real DOM
// can prove: polling while the panel is open, the open diff's silent re-read,
// the settings switch stopping/restarting it, and persistence across a reload.
//
// It writes test/ui/auto-refresh.png. DSH_GIT_UI_CHROME points at another Chrome
// binary when the default is missing.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SHOT = join(ROOT, "test", "ui", "auto-refresh.png");
const CHROME = process.env.DSH_GIT_UI_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TYPES = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

// The harness page: React UMD (18, the version the plugin resolves) + the module
// loader handoff + a minimal ctx whose fixtures mirror test/render.mjs. The
// status and diff fixtures are MUTABLE on purpose (`window.__status`,
// `window.__diffText`): the test changes them and waits for the poller to pick
// the change up.
const INDEX = `<!doctype html><html><head><meta charset="utf-8"><title>dsh-git auto-refresh harness</title>
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
  window.__status = { repo: true, branch: "main", detached: false, oid: "abc1234", upstream: "origin/main", ahead: 0, behind: 0, dirty: 1, changes: [{ status: "modified", path: "README.md", file: "README.md", origFile: null, index: " ", worktree: "M" }] };
  window.__diffText = "diff --git a/README.md b/README.md\\n--- a/README.md\\n+++ b/README.md\\n@@ -1 +1 @@\\n-old\\n+new\\n";
  window.__failStatus = false;
  function statusCalls() {
    return calls.filter(function (call) { return call.endpoint === "status"; }).length;
  }
  window.__statusCalls = statusCalls;
  function respond(endpoint, payload) {
    var status = window.__status;
    if (endpoint === "status") return window.__failStatus === true ? { ok: false, error: { message: "host unavailable" } } : { ok: true, value: status };
    if (endpoint === "branches") {
      return { ok: true, value: { repo: true, current: status.branch, local: [{ name: status.branch, current: true, sha: status.oid, upstream: "origin/main" }], remote: [] } };
    }
    if (endpoint === "log") {
      return { ok: true, value: { repo: true, commits: [{ sha: status.oid, author: "me", subject: "init", refs: "HEAD -> " + status.branch }] } };
    }
    if (endpoint === "diff") {
      return { ok: true, value: { repo: true, path: payload && payload.args ? payload.args.path : "README.md", origPath: null, untracked: false, skipped: 0, worktree: { diff: window.__diffText, binary: false, truncated: false }, index: { diff: "", binary: false, truncated: false } } };
    }
    return { ok: true, value: { message: endpoint + " ok" } };
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
  window.__dicts = dicts;
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

// Debug aid for an environment that cannot spawn a browser (a confined sandbox,
// see AGENTS.md §8): serve the harness and stay alive, so an already-running
// browser (the MCP playwright instance) can drive it at the printed URL. The
// assertions below are skipped in this mode.
if (process.env.DSH_GIT_UI_SERVE_ONLY === "1") {
  console.log(`AUTO-REFRESH HARNESS SERVING AT ${origin}/  (serve-only; stop the process to end)`);
  await new Promise(() => {});
}

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures += 1;
  console.error(`  FAIL ${label}${detail === undefined ? "" : `: ${detail}`}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

const waitReady = async () => {
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
  await page.waitForSelector('[data-dsh-git="panel"]', { timeout: 10000 });
};
const statusCalls = () => page.evaluate(() => window.__statusCalls());
const snapshot = () => page.evaluate(() => window.__store.getSnapshot());

try {
  await page.goto(origin + "/");
  await waitReady();
  // A previous run may have left the switch off; start from the shipped default.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitReady();

  // ── the switch defaults on and does not need the panel ──────────────────
  const initial = await snapshot();
  check("auto refresh defaults on", initial.autoRefresh === true, JSON.stringify(initial.autoRefresh));

  // The harness page mounts the panel component but the panel starts collapsed
  // (store state), so open it the way the pill does: this also wakes the poller.
  await page.evaluate(() => window.__store.setPanelOpen(true));
  await page.waitForTimeout(400);
  const opened = await statusCalls();

  // ── an external change reaches the workbench without any click ──────────
  await page.evaluate(() => {
    window.__status.branch = "auto-refresh-proof";
    window.__status.dirty = 3;
  });
  await page.waitForFunction(() => window.__store.getSnapshot().branch === "auto-refresh-proof", undefined, { timeout: 10000 });
  const refreshed = await snapshot();
  check("an external branch change arrives automatically", refreshed.branch === "auto-refresh-proof", JSON.stringify(refreshed.branch));
  check("the dirty count follows it", refreshed.dirty === 3, String(refreshed.dirty));
  const afterBranch = await statusCalls();
  check("the poll actually called the endpoint", afterBranch > opened, `${opened} -> ${afterBranch}`);

  // ── a failing poll must not replace the workbench with an error card ────
  // The whole point of a background read is that it is disposable: a host
  // restart answering 405 for a few seconds must leave the data on screen.
  const beforeFailure = await snapshot();
  await page.evaluate(() => { window.__failStatus = true; });
  await page.waitForTimeout(5200);
  const afterFailure = await snapshot();
  check("a failing poll keeps the workbench ready", afterFailure.phase === "ready", afterFailure.phase);
  check("a failing poll keeps the last data", afterFailure.dirty === beforeFailure.dirty, `${beforeFailure.dirty} -> ${afterFailure.dirty}`);
  check("a failing poll keeps the change rows", await page.locator('[data-dsh-git="change-row"]').count() >= 1);
  check("a failing poll shows no error card", await page.locator('[data-dsh-git="output"]').count() === 0);
  await page.evaluate(() => { window.__failStatus = false; });

  // ── the OPEN diff re-reads its bytes silently ───────────────────────────
  await page.click('[data-dsh-git="change-row"]');
  await page.waitForSelector('[data-dsh-git="diff"]', { timeout: 8000 });
  await page.waitForFunction(() => {
    const body = document.querySelector('[data-dsh-git="diff-body"]');
    return body !== null && body.textContent.includes("+new");
  }, undefined, { timeout: 8000 });
  await page.evaluate(() => { window.__diffText = window.__diffText.replace("+new", "+changed-in-editor"); });
  await page.waitForFunction(() => {
    const body = document.querySelector('[data-dsh-git="diff-body"]');
    return body !== null && body.textContent.includes("changed-in-editor");
  }, undefined, { timeout: 10000 });
  check("the open diff picks up new bytes without a click", true);
  // The silent re-read must not restart the pane: its rows stay mounted.
  check("the diff pane stays open during the silent re-read", await page.locator('[data-dsh-git="diff"]').count() === 1);
  await page.screenshot({ path: SHOT });
  console.log("screenshot:", SHOT);

  // ── the settings switch stops and restarts the poller ───────────────────
  await page.click('[data-dsh-git="settings"]');
  await page.waitForSelector('[data-dsh-git="settings-auto-refresh"]', { timeout: 5000 });
  check("the popover carries the auto-refresh switch", await page.locator('[data-dsh-git="settings-auto-refresh"]').count() === 1);
  check("the switch starts pressed", await page.getAttribute('[data-dsh-git="settings-auto-refresh"]', "aria-pressed") === "true");
  await page.click('[data-dsh-git="settings-auto-refresh"]');
  await page.waitForTimeout(200);
  check("the switch turns off", await page.getAttribute('[data-dsh-git="settings-auto-refresh"]', "aria-pressed") === "false");
  check("the switch reached localStorage", await page.evaluate(() => window.localStorage.getItem("dsh-git.autoRefresh")) === "0");
  await page.click('[data-dsh-git="settings-close"]');
  await page.waitForTimeout(100);
  const offCount = await statusCalls();
  await page.waitForTimeout(6500);
  check("no polling while the switch is off", (await statusCalls()) === offCount, `${offCount} -> ${await statusCalls()}`);

  await page.evaluate(() => window.__store.setSettingsOpen(true));
  await page.click('[data-dsh-git="settings-auto-refresh"]');
  await page.waitForTimeout(200);
  check("the switch turns back on", await page.evaluate(() => window.__store.getSnapshot().autoRefresh) === true);
  await page.evaluate(() => window.__store.setSettingsOpen(false));
  const onCount = await statusCalls();
  await page.waitForTimeout(5200);
  check("polling resumes once the switch is on", (await statusCalls()) > onCount, `${onCount} -> ${await statusCalls()}`);

  // ── the switch survives a page reload ───────────────────────────────────
  await page.evaluate(() => window.__store.setAutoRefresh(false));
  await page.reload();
  await waitReady();
  const reloaded = await snapshot();
  check("the off switch survives a reload", reloaded.autoRefresh === false, JSON.stringify(reloaded.autoRefresh));
  const reloadCount = await statusCalls();
  await page.waitForTimeout(5000);
  check("a reloaded page with the switch off does not poll", (await statusCalls()) === reloadCount, `${reloadCount} -> ${await statusCalls()}`);
  // Restore the shipped default so the next run starts clean.
  await page.evaluate(() => window.__store.setAutoRefresh(true));
  await page.evaluate(() => window.localStorage.removeItem("dsh-git.autoRefresh"));

  check("no page errors", pageErrors.length === 0, JSON.stringify(pageErrors));
} finally {
  await browser.close();
  server.close();
}

if (failures > 0) {
  console.error(`\n${failures} AUTO-REFRESH UI CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nAUTO-REFRESH UI CHECK PASSED (real Chrome + real timers + real localStorage, no dsh web needed)");
