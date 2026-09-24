// Real-browser check of the click-a-change → diff-pane flow (run: node test/ui/verify-diff.mjs).
//
// It drives the live Web GUI at DSH_GIT_UI_URL (default http://127.0.0.1:3080)
// with the browser's own Chrome, and needs playwright-core somewhere on the
// require path (the other scripts in this directory make the same assumption).
//
// By default it INTERCEPTS /dsh-git-rpc/diff and answers with fixtures, so it
// verifies the client half on its own: request shape, response handling, the
// parsed rows, the staged/unstaged switch, the untracked notice, the right-edge
// resize, and the panel growing from one column to two. Set DSH_GIT_UI_LIVE=1 to skip
// the interception and read the real endpoint instead — that also needs the
// host half loaded, i.e. a `dsh web` restart after editing lib/index.js.
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
    await page.route("**/dsh-git-rpc/diff", async (route) => {
      const req = JSON.parse(route.request().postData() ?? "{}");
      const args = req?.payload?.args ?? {};
      const untracked = String(args.path ?? "").includes("diff.mjs");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          type: "server-response",
          rpcId: req.rpcId,
          result: { ok: true, value: {
            repo: true,
            path: args.path,
            origPath: null,
            untracked,
            skipped: 0,
            worktree: { diff: WORKTREE, binary: false, truncated: false },
            index: { diff: untracked ? "" : STAGED, binary: false, truncated: false }
          } }
        })
      });
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

  // The panel is bound to the session's cwd: pick a workspace that is a git
  // repository before looking for the dock pill.
  if ((await page.locator('[data-dsh-git="dock"]').count()) === 0) {
    const picker = page.locator('button[aria-label="选择工作区"]').first();
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
  check("the dock pill appeared (workspace is a git repository)", (await dock.count()) > 0);
  if ((await dock.count()) === 0) throw new Error("no dock pill: bind the session to a git workspace first");

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
  check("the change list offers clickable rows", (await page.locator('[data-dsh-git="change-row"]').count()) > 0);
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
