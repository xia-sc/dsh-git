// Real-browser check of the header's ⚙ settings popover and the commit-message
// language it drives (run: node test/ui/verify-settings.mjs).
//
// Unlike the other scripts here this one needs NO dsh web and NO authentication:
// it serves this checkout over a loopback HTTP server and mounts the real client
// bundle in the browser's own Chrome against the real React UMD build, so the
// gear, the select, the custom field, the backdrop dismissal and the forced
// language on the draft request are all exercised as real DOM events with real
// `localStorage` behind them. That is the only way to verify interaction at all
// here — `test/render.mjs` is SSR and cannot run an effect or a click.
//
// It writes test/ui/settings-popover.png, the screenshot the README links to.
// DSH_GIT_UI_CHROME points at another Chrome binary when the default is missing.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SHOT = join(ROOT, "test", "ui", "settings-popover.png");
const CHROME = process.env.DSH_GIT_UI_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TYPES = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

// The harness page: React UMD (18, the version the plugin resolves) + the module
// loader handoff + a minimal ctx whose fixtures mirror test/render.mjs.
const INDEX = `<!doctype html><html><head><meta charset="utf-8"><title>dsh-git settings harness</title>
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
  function respond(endpoint, payload) {
    if (endpoint === "status") return { ok: true, value: { repo: true, branch: "main", detached: false, oid: "abc1234", upstream: "origin/main", ahead: 0, behind: 0, dirty: 1, changes: [{ status: "modified", path: "README.md" }] } };
    if (endpoint === "branches") return { ok: true, value: { repo: true, current: "main", local: [{ name: "main", current: true, sha: "abc1234", upstream: "origin/main" }], remote: [] } };
    if (endpoint === "log") return { ok: true, value: { repo: true, commits: [{ sha: "abc1234", author: "me", subject: "init", refs: "HEAD -> main" }] } };
    if (endpoint === "generateMessage") return { ok: true, value: { message: "feat: 生成的提交信息", mode: (payload && payload.args && payload.args.mode) || "staged" } };
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
  // The plugin's own zh dictionary, so the harness renders the real Chinese
  // strings (and the screenshot is worth looking at) instead of key names.
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
  var summary = { cwd: "/repo", projectionValues: { modelSelection: { next: { provider: "alpha", model: "alpha-large" } } } };
  window.__store = store;
  window.__calls = calls;
  window.__ready = false;
  store.bindSession("s1", "/repo");
  store.refresh("/repo").then(function () {
    store.setPanelOpen(true);
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

try {
  await page.goto(origin + "/");
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
  await page.waitForSelector('[data-dsh-git="panel"]', { timeout: 10000 });
  await page.evaluate(() => localStorage.clear());
  check("panel rendered with its header", await page.locator('[data-dsh-git="panel"]').count() === 1);
  check("the settings gear sits in the header", await page.locator('[data-dsh-git="settings"]').count() === 1);
  check("the popover starts closed", await page.locator('[data-dsh-git="settings-popover"]').count() === 0);

  // ── open the popover ────────────────────────────────────────────────────
  await page.click('[data-dsh-git="settings"]');
  await page.waitForSelector('[data-dsh-git="settings-popover"]', { timeout: 5000 });
  check("clicking the gear opens the popover", true);
  check("the backdrop renders under it", await page.locator('[data-dsh-git="settings-backdrop"]').count() === 1);
  check("the language select renders", await page.locator('[data-dsh-git="settings-language"]').count() === 1);
  check("the close button renders", await page.locator('[data-dsh-git="settings-close"]').count() === 1);
  check("the custom field stays hidden for a preset", await page.locator('[data-dsh-git="settings-language-text"]').count() === 0);

  const box = await page.locator('[data-dsh-git="settings-popover"]').boundingBox();
  const panelBox = await page.locator('[data-dsh-git="panel"]').boundingBox();
  check("the popover sits inside the panel's box", box.x >= panelBox.x && box.y >= panelBox.y
    && box.x + box.width <= panelBox.x + panelBox.width + 1
    && box.y + box.height <= panelBox.y + panelBox.height + 1, JSON.stringify({ box, panelBox }));
  check("the select offers every preset plus custom",
    (await page.locator('[data-dsh-git="settings-language"] option').allTextContents()).length === 11);

  // ── pick a language, then draft ─────────────────────────────────────────
  await page.selectOption('[data-dsh-git="settings-language"]', "zh-CN");
  const afterSelect = await page.evaluate(() => ({
    lang: window.__store.getSnapshot().generateLanguage,
    stored: window.localStorage.getItem("dsh-git.commitLanguage"),
    value: document.querySelector('[data-dsh-git="settings-language"]').value
  }));
  check("the select shows the picked language", afterSelect.value === "zh-CN");
  check("the store published the setting", afterSelect.lang === "zh-CN", JSON.stringify(afterSelect));
  check("the setting reached localStorage", afterSelect.stored === JSON.stringify({ id: "zh-CN", text: "" }), afterSelect.stored);

  // The popover floats over the workbench, so the draft button is behind it while
  // it is open: dismiss first, exactly as a user does.
  await page.click('[data-dsh-git="settings-close"]');
  await page.waitForTimeout(150);
  await page.click('button:has-text("AI 生成")');
  await page.waitForFunction(() => document.querySelector("textarea") && document.querySelector("textarea").value !== "", undefined, { timeout: 8000 });
  const drafted = await page.evaluate(() => window.__calls.filter((call) => call.endpoint === "generateMessage").pop());
  check("the draft carries the forced language", drafted?.payload?.args?.language === "Simplified Chinese (简体中文)", JSON.stringify(drafted?.payload));
  check("the draft kept the session id", drafted?.payload?.args?.sessionId === "s1", JSON.stringify(drafted?.payload));

  // ── the custom entry ────────────────────────────────────────────────────
  await page.click('[data-dsh-git="settings"]');
  await page.waitForSelector('[data-dsh-git="settings-language"]', { timeout: 5000 });
  await page.selectOption('[data-dsh-git="settings-language"]', "custom");
  await page.waitForSelector('[data-dsh-git="settings-language-text"]', { timeout: 5000 });
  await page.fill('[data-dsh-git="settings-language-text"]', "  Esperanto  ");
  const custom = await page.evaluate(() => ({
    text: window.__store.getSnapshot().generateLanguageText,
    directive: window.__store.languageDirective(),
    shown: document.querySelector('[data-dsh-git="settings-language-text"]').value,
    stored: window.localStorage.getItem("dsh-git.commitLanguage")
  }));
  check("the custom field echoes the text back verbatim", custom.shown === "  Esperanto  ", JSON.stringify(custom));
  check("the directive is trimmed", custom.directive === "Esperanto", JSON.stringify(custom));
  check("the custom name is persisted", custom.stored === JSON.stringify({ id: "custom", text: "  Esperanto  " }), custom.stored);

  await page.click('[data-dsh-git="settings-close"]');
  await page.waitForTimeout(150);
  await page.click('button:has-text("AI 生成")');
  await page.waitForTimeout(400);
  const customDraft = await page.evaluate(() => window.__calls.filter((call) => call.endpoint === "generateMessage").pop());
  check("a custom language reaches the endpoint", customDraft?.payload?.args?.language === "Esperanto", JSON.stringify(customDraft?.payload));

  // ── dismissal: the backdrop, the ×, and the panel's own collapse ────────
  await page.click('[data-dsh-git="settings"]');
  await page.waitForSelector('[data-dsh-git="settings-language"]', { timeout: 5000 });
  await page.selectOption('[data-dsh-git="settings-language"]', "zh-CN");
  await page.screenshot({ path: SHOT });
  console.log("screenshot:", SHOT);
  await page.click('[data-dsh-git="settings-backdrop"]', { position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  check("the backdrop closes the popover", await page.locator('[data-dsh-git="settings-popover"]').count() === 0);

  await page.click('[data-dsh-git="settings"]');
  await page.waitForSelector('[data-dsh-git="settings-popover"]');
  await page.click('[data-dsh-git="settings-close"]');
  await page.waitForTimeout(200);
  check("the close button closes the popover", await page.locator('[data-dsh-git="settings-popover"]').count() === 0);

  await page.click('[data-dsh-git="settings"]');
  await page.waitForSelector('[data-dsh-git="settings-popover"]');
  await page.evaluate(() => window.__store.setPanelOpen(false));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__store.setPanelOpen(true));
  await page.waitForTimeout(300);
  check("collapsing the panel drops the popover", await page.locator('[data-dsh-git="settings-popover"]').count() === 0);

  // ── persistence across a real page reload ───────────────────────────────
  await page.reload();
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
  await page.waitForSelector('[data-dsh-git="panel"]');
  check("the setting survives a page reload", await page.evaluate(() => window.__store.getSnapshot().generateLanguage) === "zh-CN");

  // ── auto sends no directive at all ──────────────────────────────────────
  await page.click('[data-dsh-git="settings"]');
  await page.selectOption('[data-dsh-git="settings-language"]', "auto");
  await page.click('[data-dsh-git="settings-close"]');
  await page.waitForTimeout(150);
  await page.click('button:has-text("AI 生成")');
  await page.waitForTimeout(400);
  const autoDraft = await page.evaluate(() => window.__calls.filter((call) => call.endpoint === "generateMessage").pop());
  check("auto omits the language", autoDraft?.payload?.args?.language === undefined, JSON.stringify(autoDraft?.payload));

  check("no page errors", pageErrors.length === 0, JSON.stringify(pageErrors));
} finally {
  await browser.close();
  server.close();
}

if (failures > 0) {
  console.error(`\n${failures} SETTINGS UI CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nSETTINGS UI CHECK PASSED (real Chrome + real React DOM + real localStorage, no dsh web needed)");
