// Real-browser check of the click-a-change → diff-pane flow (run: node test/ui/verify-diff.mjs).
//
// It drives the live Web GUI at DSH_GIT_UI_URL (default http://127.0.0.1:3080)
// with the browser's own Chrome, and needs playwright-core somewhere on the
// require path (the other scripts in this directory make the same assumption).
//
// By default it INTERCEPTS every /dsh-git-rpc/* call the panel makes (status,
// log, branches, diff) and answers with fixtures, so it verifies the client half
// on its own — and independently of what the session's working tree happens to
// contain: request shape, response handling, the parsed rows, the staged/unstaged
// switch, the right-edge resize, and the panel growing from one column to two.
// Set DSH_GIT_UI_LIVE=1 to skip the interception and read the real endpoints
// instead — that also needs the host half loaded, i.e. a `dsh web` restart after
// editing lib/index.js.
//
// What each mode asserts (they differ on purpose)
// -----------------------------------------------
// Structural checks — two panes, the resize handle, the panel following the drag
// 1:1, wrap toggling, and the header naming the clicked file with a `+N −M` that
// matches the rows actually drawn — run in BOTH modes, because none of them
// depends on what the body says. The content-shape checks (two hunks, three
// additions, a removed line whose own text starts with `--`, exactly one
// no-newline marker) describe the FIXTURE, so they run in fixture mode only:
// asserting them live made `DSH_GIT_UI_LIVE=1` fail on any ordinary working tree.
// By the same rule the wrap trio is skipped live when the real diff holds no line
// wide enough to scroll, and the committed `diff-panel.png` is written in fixture
// mode only (a live screenshot would picture whatever the working tree happened
// to hold, and would then be committed by accident).
//
// The workspace it binds to is chosen the same way the panel is: whatever the
// session's cwd is. Point DSH_GIT_UI_WORKSPACE at a workspace NAME in the picker
// (default "dsh-git") when the session starts somewhere that is not a repository.
// That picker belongs to the CLI/`dsh web` shell; the 0.2 desktop shell replaced
// it with a sidebar list, so there the run leans on the session's own cwd (in
// fixture mode `status` always reports a repository) and says so rather than
// failing on a selector that no longer exists.
//
// Host shells also differ in first-run chrome: the 0.2 desktop app opens with a
// preview-notice overlay whose only button is 继续 and which sits on top of the
// composer (Escape does not close it), so it is dismissed before anything clicks.
//
// A fresh browser is NOT authenticated: `dsh web` fences the GUI behind a
// one-time token it prints on startup, so pass either
//   DSH_GIT_UI_URL=<the exact URL dsh web printed>   (it carries the token), or
//   DSH_GIT_UI_STORAGE_STATE=<a Playwright storage-state JSON from that browser>,
// otherwise the run fails with "authentication required".
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const chromePath = process.env.DSH_GIT_UI_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = process.env.DSH_GIT_UI_URL ?? "http://127.0.0.1:3080/";
const workspaceName = process.env.DSH_GIT_UI_WORKSPACE ?? "dsh-git";
const storageState = process.env.DSH_GIT_UI_STORAGE_STATE;
const live = process.env.DSH_GIT_UI_LIVE === "1";

const WORKTREE = [
  "diff --git a/README.md b/README.md",
  "index 0f34356..a75e47b 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -8,7 +8,7 @@ DeepSeek Harness Web GUI 的完整 Git 管理插件",
  " ",
  " **支持的工作流：** 分支切换 · 拉取更新(fetch)",
  "-最近提交 · 未提交文件列表 · 基于某分支新建分支。",
  "+最近提交 · 未提交文件列表 · **点击变更看差异** · 基于某分支新建分支。",
  " ",
  " ## 界面",
  "@@ -30,6 +30,9 @@",
  " - 两处界面共享同一个 store。",
  "+",
  "+### 差异查看",
  `+点变更列表里的一行，就在右侧显示该文件的 git diff。${"y".repeat(300)}`,
  "-- looks like a file header but is a removed line",
  "\\ No newline at end of file"
].join("\n");
const STAGED = [
  "diff --git a/README.md b/README.md",
  "index 1111111..2222222 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,3 +1,4 @@",
  " # 标题",
  "+已暂存的一行",
  " 正文"
].join("\n");

// The other endpoints the panel calls while it binds a session. Fixture mode
// answers these too: `status` is what decides whether the pill renders at all
// and which change rows the list holds, so leaving it real would make the whole
// run depend on the session's working tree being dirty — and on its cwd being a
// repository — which is exactly how this script failed on a clean tree.
const STATUS = {
  repo: true,
  branch: "verify-ui",
  detached: false,
  oid: "0".repeat(40),
  upstream: "origin/verify-ui",
  ahead: 1,
  behind: 0,
  dirty: 2,
  changes: [
    { status: "modified", path: "README.md", index: " ", worktree: "M", file: "README.md", origFile: null },
    { status: "untracked", path: "test/diff.mjs", index: "?", worktree: "?", file: "test/diff.mjs", origFile: null }
  ]
};
const LOGFIX = {
  repo: true,
  commits: [
    { sha: "1111111", author: "verify", subject: "fixture commit one", refs: "HEAD -> verify-ui" },
    { sha: "2222222", author: "verify", subject: "fixture commit two", refs: null }
  ]
};
const BRANCHES = {
  repo: true,
  current: "verify-ui",
  local: [{ name: "verify-ui", current: true, upstream: "origin/verify-ui", sha: "1111111" }],
  remote: [{ name: "origin/verify-ui", short: "verify-ui" }]
};

let failures = 0;
function check(label, condition, detail) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  ...(storageState === undefined || storageState === "" ? {} : { storageState })
});
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  if (!live) {
    // One handler for the whole channel. The panel's bootstrap calls decide what
    // this run even sees, so `status` (and the two list reads) are answered from
    // fixtures as well; only `diff` was intercepted before, which tied every
    // assertion to a dirty working tree.
    await page.route("**/dsh-git-rpc/*", async (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.split("/").pop();
      let req = {};
      try {
        req = JSON.parse(request.postData() ?? "{}");
      } catch {
        // A body this test does not send is not its concern; answer the envelope anyway.
      }
      const args = req?.payload?.args ?? {};
      const answer = (value) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ type: "server-response", rpcId: req.rpcId, result: { ok: true, value } })
        });
      if (endpoint === "status") return answer(STATUS);
      if (endpoint === "log") return answer(LOGFIX);
      if (endpoint === "branches") return answer(BRANCHES);
      if (endpoint === "diff") {
        const untracked = String(args.path ?? "").includes("diff.mjs");
        return answer({
          repo: true,
          path: args.path,
          origPath: null,
          untracked,
          skipped: 0,
          worktree: { diff: WORKTREE, binary: false, truncated: false },
          index: { diff: untracked ? "" : STAGED, binary: false, truncated: false }
        });
      }
      // fetch/pull/push/stage/commit/... are not exercised by this script.
      return answer({});
    });
  }

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // `dsh web` fences the GUI: a context without the token cookie only ever sees
  // this sentence, and every later assertion would blame the plugin for it.
  const gate = await page.evaluate(() => document.body.innerText.slice(0, 200));
  if (/authentication required/i.test(gate)) {
    console.error("AUTHENTICATION REQUIRED: this browser has no dsh web session cookie.");
    console.error("Run with DSH_GIT_UI_URL=<the URL `dsh web` printed> or DSH_GIT_UI_STORAGE_STATE=<storage-state.json>.");
    await browser.close();
    process.exit(2);
  }

  // First-run chrome on the 0.2 desktop shell: a preview-notice overlay whose
  // only button is 继续/Continue sits on top of the composer, so every click
  // below would be refused as "intercepted pointer events" (Escape does not
  // close it). Dismissing it here keeps the suite working on both shells.
  const dismissed = await page.evaluate(() => {
    const labels = ["继续", "Continue", "知道了", "我知道了", "确定", "开始使用", "Got it", "OK"];
    for (const overlay of document.querySelectorAll('[role="presentation"]')) {
      for (const button of overlay.querySelectorAll("button")) {
        const text = (button.innerText ?? "").trim();
        if (labels.includes(text)) {
          button.click();
          return text;
        }
      }
    }
    return null;
  });
  if (dismissed !== null) {
    console.log(`NOTE: dismissed a first-run overlay (button "${dismissed}").`);
    await page.waitForTimeout(600);
  }

  // The panel is bound to the session's cwd. The CLI/`dsh web` shell offers a
  // picker that can move the session to a repository; the 0.2 desktop shell has
  // no such picker (its sidebar lists workspaces but does not rebind the open
  // session), so there the fixture `status` above is what makes the pill render.
  if ((await page.locator('[data-dsh-git="dock"]').count()) === 0) {
    const picker = page.locator('button[aria-label="选择工作区"]').first();
    if ((await picker.count()) === 0) {
      console.log("NOTE: this shell has no workspace picker; relying on the session's own cwd (fixture mode reports a repository).");
    }
    if ((await picker.count()) > 0) {
      await picker.click();
      await page.waitForTimeout(600);
      // The entries are plain buttons with the workspace name as their only
      // text; click the exact one (a text locator would also match a session
      // row that merely mentions it).
      const picked = await page.evaluate((name) => {
        const leaves = Array.from(document.querySelectorAll("*"))
          .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim() === name);
        for (const leaf of leaves) {
          let target = leaf;
          for (let i = 0; i < 4 && target.parentElement; i += 1) {
            target = target.parentElement;
            if (target.tagName === "BUTTON" || target.getAttribute("role") === "option" || target.tagName === "LI") break;
          }
          target.click();
          return true;
        }
        return false;
      }, workspaceName);
      check(`the workspace picker listed ${JSON.stringify(workspaceName)}`, picked === true);
      await page.waitForTimeout(1800);
    }
  }
  const dock = page.locator('[data-dsh-git="dock"]');
  check("the dock pill appeared (the session is bound to a workspace)", (await dock.count()) > 0);
  if ((await dock.count()) === 0) {
    throw new Error(
      "no dock pill: the session has no cwd to bind (fixture mode already reports a repository), or the client half did not mount — " +
        "check the boot page / DevTools console for `web boot: … did not activate` or a slot error"
    );
  }

  const width = () => page.evaluate(() => ({
    panel: document.querySelector('[data-dsh-git="panel"]') ? Math.round(document.querySelector('[data-dsh-git="panel"]').getBoundingClientRect().width) : 0,
    diff: document.querySelector('[data-dsh-git="diff"]') ? Math.round(document.querySelector('[data-dsh-git="diff"]').getBoundingClientRect().width) : 0
  }));
  const rows = () => page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('[data-dsh-git="diff-row"]'));
    const count = (kind) => list.filter((row) => row.getAttribute("data-kind") === kind).length;
    return {
      total: list.length,
      add: count("add"),
      del: count("del"),
      hunk: count("hunk"),
      fileHeader: count("fileHeader"),
      noNewline: count("noNewline"),
      header: document.querySelector('[data-dsh-git="diff-header"]').innerText.replace(/\s+/g, " "),
      body: document.querySelector('[data-dsh-git="diff-body"]').innerText,
      hasRemovedDashDash: list.some((row) => (row.innerText ?? "").includes("-- looks like a file header"))
    };
  });

  await dock.click();
  await page.waitForTimeout(500);
  const collapsed = await width();
  check("the panel opens as one column", collapsed.panel > 0 && collapsed.diff === 0, JSON.stringify(collapsed));

  const changeRow = page.locator('[data-dsh-git="change-row"]').first();
  const changeRowCount = await page.locator('[data-dsh-git="change-row"]').count();
  if (changeRowCount === 0 && live) {
    // Live mode reads the real endpoints, so it needs a workspace that really is
    // a dirty repository. Saying so beats the 30s locator timeout that a clean
    // tree used to produce.
    console.error("NO CHANGES TO SHOW: live mode reads the real endpoints and this session's workspace has a clean tree.");
    console.error("Open the session on a repository with uncommitted changes, or drop DSH_GIT_UI_LIVE=1 to run on fixtures.");
    process.exit(2);
  }
  check("the change list offers clickable rows", changeRowCount > 0);
  // The row renders its status label and the file's display path on separate
  // lines; the header below must name THAT file. Reading it off the row keeps
  // the check honest whatever the working tree happens to contain (the diff
  // body itself is a fixture).
  const clickedFile = await changeRow.evaluate((el) => (el.innerText ?? "").trim().split("\n").pop().trim());
  await changeRow.click();
  await page.waitForTimeout(live ? 1500 : 700);

  const twoPane = await width();
  check("selecting a change opens the diff pane", twoPane.diff > 0, JSON.stringify(twoPane));
  check("the panel grew by the diff pane", twoPane.panel > collapsed.panel, `${collapsed.panel} -> ${twoPane.panel}`);
  check("the panel's right edge is the resize handle", (await page.locator('[data-dsh-git="panel-resize"]').count()) === 1);

  const parsed = await rows();
  check("the pane rendered rows from the diff", parsed.total > 0, JSON.stringify(parsed).slice(0, 200));
  if (parsed.total > 0) {
    // Content-independent, so they hold in BOTH modes: any real single-file diff
    // carries the `diff --git` banner plus the `index`/`---`/`+++` lines, and the
    // pane's own `+N −M` must equal the rows it drew.
    check("file headers are recognized", parsed.fileHeader >= 4, String(parsed.fileHeader));
    const headerCounts = /[+](\d+) [−-](\d+)/.exec(parsed.header);
    check("the header shows +/- counts", headerCounts !== null, parsed.header);
    check(
      "the header's +/- counts match the rows drawn",
      headerCounts !== null && Number(headerCounts[1]) === parsed.add && Number(headerCounts[2]) === parsed.del,
      `header ${headerCounts === null ? "?" : `${headerCounts[1]}/${headerCounts[2]}`} vs rows ${parsed.add}/${parsed.del}`
    );
    check("the header names the file that was clicked", parsed.header.includes(clickedFile), `${JSON.stringify(clickedFile)} vs ${parsed.header}`);

    // The remaining shapes describe the FIXTURE (two hunks, three additions, a
    // removed line whose own text starts with `--`, exactly one no-newline
    // marker). Real content has no obligation to look like that, so asserting
    // them live made `DSH_GIT_UI_LIVE=1` fail on any ordinary working tree.
    if (!live) {
      check("hunks are recognized", parsed.hunk >= 2, String(parsed.hunk));
      check("added rows are counted and marked", parsed.add >= 3, String(parsed.add));
      check("removed rows are counted and marked", parsed.del >= 2, String(parsed.del));
      check("a removed line starting with `--` is a change, not a header", parsed.hasRemovedDashDash === true);
      check("the no-newline marker survives", parsed.noNewline === 1, String(parsed.noNewline));
    }
  }

  if (!live) {
    await page.locator('[data-dsh-git="diff-scope-index"]').click();
    await page.waitForTimeout(600);
    const staged = await rows();
    check("the staged side re-reads the other half", staged.total > 0 && staged.total !== parsed.total, `${parsed.total} -> ${staged.total}`);
    await page.locator('[data-dsh-git="diff-scope-worktree"]').click();
    await page.waitForTimeout(600);
  }

  // Wrapping is a real layout switch: the row must stop being as wide as its
  // longest line, or `pre-wrap` never fires and the pane just scrolls sideways.
  {
    // The row to measure is the one with the LONGEST text, not the first add
    // row: which add is long is a property of the fixture, and the first one
    // usually fits on a single line at the default pane width.
    const overflow = () => page.evaluate(() => {
      const body = document.querySelector('[data-dsh-git="diff-body"]');
      const adds = Array.from(document.querySelectorAll('[data-dsh-git="diff-row"][data-kind="add"]'));
      const longest = adds.reduce((best, row) => (best === null || (row.textContent ?? "").length > (best.textContent ?? "").length ? row : best), null);
      return { overflowX: body.scrollWidth - body.clientWidth, rowHeight: longest === null ? 0 : Math.round(longest.getBoundingClientRect().height) };
    });
    const unwrapped = await overflow();
    if (unwrapped.overflowX === 0) {
      // Real (live) content may hold no line wide enough to overflow the pane,
      // and then wrapping has nothing to demonstrate. The fixture always
      // overflows, so this only relaxes `DSH_GIT_UI_LIVE=1`.
      console.log(`NOTE: the live diff has no line wide enough to scroll (rowHeight ${unwrapped.rowHeight}); wrap checks skipped`);
    } else {
      check("an unwrapped long line scrolls sideways", unwrapped.overflowX > 0, JSON.stringify(unwrapped));
      await page.locator('[data-dsh-git="diff-wrap"]').click();
      await page.waitForTimeout(500);
      const wrapped = await overflow();
      check("wrapping removes the sideways scroll", wrapped.overflowX === 0, JSON.stringify(wrapped));
      check("wrapping grows the row to several lines", wrapped.rowHeight > unwrapped.rowHeight, `${unwrapped.rowHeight} -> ${wrapped.rowHeight}`);
      await page.locator('[data-dsh-git="diff-wrap"]').click();
      await page.waitForTimeout(500);
      const back = await overflow();
      check("turning wrapping off restores the scroll", back.overflowX === unwrapped.overflowX, JSON.stringify(back));
    }
  }

  // Dragging the panel's right edge resizes the diff (the workbench keeps its
  // width), the panel follows 1:1, and the width stays inside the viewport.
  const before = await width();
  const box = await page.locator('[data-dsh-git="panel-resize"]').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(60, box.height / 2);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy, { steps: 8 });
  await page.mouse.up();
  const narrower = await width();
  check("dragging the right edge narrows the diff pane", narrower.diff === before.diff - 120, `${before.diff} -> ${narrower.diff}`);
  check("the panel follows the drag 1:1", narrower.panel === before.panel - 120, `${before.panel} -> ${narrower.panel}`);

  const box2 = await page.locator('[data-dsh-git="panel-resize"]').boundingBox();
  await page.mouse.dblclick(box2.x + box2.width / 2, box2.y + Math.min(60, box2.height / 2));
  const reset = await width();
  check("double-clicking the edge resets the width", reset.diff === before.diff, `${reset.diff} vs ${before.diff}`);

  const viewport = page.viewportSize();
  check("the panel stays inside the viewport", reset.panel <= viewport.width - 20, `${reset.panel} vs ${viewport.width}`);

  // Clicking the row showing closes the pane again, back to one column.
  await changeRow.click();
  await page.waitForTimeout(500);
  const closed = await width();
  check("clicking the active row folds the pane away", closed.diff === 0 && closed.panel === collapsed.panel, JSON.stringify(closed));

  // The committed screenshot is the FIXTURE's rendering; a live run would
  // overwrite it with whatever the working tree happened to contain.
  if (live) {
    console.log("NOTE: live mode leaves test/ui/diff-panel.png untouched (it is the fixture-mode reference).");
  } else {
    await page.screenshot({ path: fileURLToPath(new URL("./diff-panel.png", import.meta.url)) });
  }
  check("no page error was raised", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} DIFF UI CHECK(S) FAILED`);
  process.exit(1);
}
console.log(`DIFF UI VERIFIED (two panes, parsed rows, side switch, right-edge resize, fold-back${live ? ", live endpoint" : ", fixture endpoint"})`);
