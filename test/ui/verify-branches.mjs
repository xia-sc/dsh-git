// Real-browser check of the branch <select> when two remotes carry a branch of
// the same name (run: node test/ui/verify-branches.mjs).
//
// The regression this guards: the remote options used to be labelled with the
// bare branch part, so `origin/main` and `upstream/main` both rendered as
// `main` and the dropdown gave no way to tell them apart — the screenshot this
// script writes used to show exactly that (`dev` / `master` listed twice under
// 远程分支). Remote entries now carry the full remote-tracking ref as both the
// option value AND its label.
//
// Like verify-settings.mjs this needs NO dsh web and NO authentication: it
// serves this checkout over a loopback HTTP server and mounts the real client
// bundle against the real React UMD build in a real browser, so the options are
// inspected as real DOM — `test/render.mjs` is SSR and cannot read the rendered
// `<option>` list of a controlled select. It writes test/ui/select-open.png.
// DSH_GIT_UI_CHROME points at another Chrome binary when the default is missing.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { findChrome } from "./chrome.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SHOT = join(ROOT, "test", "ui", "select-open.png");
const CHROME = findChrome();
const TYPES = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

// The fixture is the whole point: one local `main` plus two remotes that both
// carry a `main`. `origin/main` is the one the local branch tracks, so it is the
// current branch's upstream; `upstream/main` is the indistinguishable twin.
const STATUS = {
  repo: true, branch: "main", detached: false, oid: "abc1234", upstream: "origin/main",
  ahead: 0, behind: 0, dirty: 1, changes: [{ status: "modified", path: "README.md" }]
};
const BRANCHES = {
  repo: true,
  current: "main",
  local: [
    { name: "main", current: true, upstream: "origin/main", sha: "abc1234" },
    { name: "dev", current: false, upstream: null, sha: "def5678" }
  ],
  remote: [
    { remote: "origin", branch: "main", name: "origin/main", short: "main" },
    { remote: "upstream", branch: "main", name: "upstream/main", short: "main" },
    { remote: "origin", branch: "dev", name: "origin/dev", short: "dev" }
  ]
};

const INDEX = `<!doctype html><html><head><meta charset="utf-8"><title>dsh-git branch harness</title>
<style>html,body{margin:0;height:100%;background:#14161a;font-family:system-ui,sans-serif}</style></head>
<body><div id="root"></div>
<script src="/node_modules/react/umd/react.development.js"></script>
<script src="/node_modules/react-dom/umd/react-dom.development.js"></script>
<script>window.__ModuleLoader__ = { load(h) { window.__handoff = h; } };</script>
<script src="/lib/client.js"></script>
<script>
(function () {
  var calls = [], regs = {}, dicts = {}, active = null;
  var STATUS = ${JSON.stringify(STATUS)};
  var BRANCHES = ${JSON.stringify(BRANCHES)};
  function respond(endpoint, payload) {
    if (endpoint === "status") return { ok: true, value: STATUS };
    if (endpoint === "branches") return { ok: true, value: BRANCHES };
    if (endpoint === "log") return { ok: true, value: { repo: true, commits: [{ sha: "abc1234", author: "me", subject: "init", refs: "HEAD -> main" }] } };
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
  var summary = { cwd: "/repo", projectionValues: { modelSelection: { next: { provider: "alpha", model: "alpha-large" } } } };
  window.__store = store;
  window.__calls = calls;
  window.__branches = BRANCHES;
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await page.goto(origin + "/");
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
  await page.waitForSelector('[data-dsh-git="panel"]', { timeout: 10000 });

  // ── the switcher's options ──────────────────────────────────────────────
  const options = await page.evaluate(() => {
    const select = document.querySelector('[data-dsh-git="panel"] select');
    if (!select) return null;
    return {
      // optgroup labels let the assertions say which section an option is in.
      groups: Array.from(select.querySelectorAll("optgroup")).map((group) => ({
        label: group.label,
        options: Array.from(group.querySelectorAll("option")).map((option) => ({ value: option.value, label: option.textContent }))
      })),
      selected: select.value,
      values: Array.from(select.querySelectorAll("option")).map((option) => option.value)
    };
  });
  check("the branch switcher renders", options !== null);
  if (options === null) throw new Error("no branch select");

  const remoteOptions = (options.groups.find((group) => /远程|Remote/i.test(group.label)) ?? {}).options ?? [];
  check("every remote branch is offered", remoteOptions.length === 3, JSON.stringify(remoteOptions));

  // The whole bug: two options whose value and label were both the bare `main`.
  for (const ref of ["origin/main", "upstream/main"]) {
    const option = remoteOptions.find((entry) => entry.value === ref);
    check(`${ref} is an option value`, option !== undefined, JSON.stringify(remoteOptions));
    check(`${ref} is labelled with the full ref too`, option?.label === ref, JSON.stringify(option));
  }
  const remoteLabels = remoteOptions.map((entry) => entry.label);
  check(
    "no two remote options share a label",
    new Set(remoteLabels).size === remoteLabels.length,
    JSON.stringify(remoteLabels)
  );
  // The bare branch part must not survive as a value: it would collide with the
  // local branch of the same name and pre-select the wrong thing.
  check("no remote option carries a bare branch name", remoteOptions.every((entry) => entry.value.includes("/")), JSON.stringify(remoteOptions));

  const localOptions = (options.groups.find((group) => /本地|Local/i.test(group.label)) ?? {}).options ?? [];
  check("local options keep the bare branch name", localOptions.some((entry) => entry.value === "main"), JSON.stringify(localOptions));
  check("the switcher pre-selects the current branch", options.selected === "main", options.selected);
  check("the per-remote HEAD symref is not offered", options.values.every((value) => !/HEAD/.test(value)), JSON.stringify(options.values));

  // ── the screenshot (the dropdown, opened) ───────────────────────────────
  // The panel holds two selects (the branch switcher and the AI draft scope);
  // the first in document order is the switcher, the one asserted above. The
  // opened listbox is drawn by the browser rather than as a DOM node, so it
  // cannot be measured — the viewport is simply tightened around the panel
  // instead of clipping, because `clip` together with an open native popup
  // makes headless Chromium's screenshot time out.
  const switcher = page.locator('[data-dsh-git="panel"] select').first();
  await page.setViewportSize({ width: 620, height: 640 });
  await page.waitForTimeout(300);
  await switcher.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOT });
  console.log("screenshot:", SHOT);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  check("no page errors", pageErrors.length === 0, JSON.stringify(pageErrors));
} finally {
  await browser.close();
  server.close();
}

if (failures > 0) {
  console.error(`\n${failures} BRANCH UI CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nBRANCH UI CHECK PASSED (real Chrome + real client bundle; duplicate remote names stay distinguishable)");
