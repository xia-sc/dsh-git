# @xia-sc/dsh-git

[中文](./README.md) | English

Complete Git management for the DeepSeek Harness Web GUI, presented as a
**collapsible floating block** that **follows the current session's workspace
in real time** — click a different session/workspace in the sidebar and the
panel rebinds to that repository instantly.

**Workflow supported:** branch switch · fetch · pull (fast-forward only) ·
stage all · commit (with an AI-drafted message) · push · status · recent
commits · uncommitted-file list · **click a change to see its diff** ·
new-branch-from-base.

## UI

- **Floating block** (`shell.overlay`): collapsed = renders nothing (no
  floating element that could cover the input); expanded = one workflow read
  top-down: status line (pending count, ahead/behind, upstream) → the branch
  switcher with its **dirty-tree pre-check** (selecting a branch while
  uncommitted changes exist warns with the affected files instead of switching,
  plus a "switch anyway" escape hatch) → a **network toolbar** (Fetch / Pull /
  Push, three equal columns, Push being the primary button) → a **commit card**
  (Stage all + draft basis + "✨ AI draft" in equal columns, the message input
  below it and the commit button) → two list cards. Every button group is split
  evenly instead of sizing itself to its label.
  **Operation feedback is pinned to the very
  top of the panel and stays one line tall** — the busy label and the last
  operation's result are the first rows of the body. The result is a localized
  phrase ("Pushed", "Staged everything", "Switched to x"); git's own output (a
  push sideband banner, the `LF will be replaced by CRLF` advice) sits behind a
  "Details ▾" toggle on the right, so the change list and the log can never push
  the notification out of sight. The panel is
  **draggable by its header bar**
  (the top row with the Git title — press, drag, release; it stays where
  dropped and is clamped inside the viewport; header buttons/inputs never
  start a drag; double-click the header to snap back to center).
  The header's right side is, in order, **⚙ Settings** (the commit-message
  language — see "The commit area and AI drafting"), **↻ Refresh** and
  **– Collapse**.
  A "＋ New branch" button beside the branch switcher opens an inline form:
  new branch name + base-branch picker (local branches or full remote refs
  like `origin/feature/x`) — confirming creates the branch from the base and
  switches to it.
- **Changes and recent commits are two cards**: a change row is "monospace path
  + status chip" (path first, so the paths line up in a column; modified=amber,
  added/untracked=green, deleted/conflict=red, renamed=blue; the file the diff
  pane is showing is highlighted), a commit row is "short sha + subject". Each
  card's header (`▾ Changes 12`) collapses the whole section and starts
  **expanded** — a Git panel must not hide the user's own changes; a list past
  8 / 5 rows offers "Show all N" at the bottom, which is a separate state, so the
  chevron always points the right way.
- **Refreshing never flashes**: clicking ↻ or any post-action re-read keeps the
  panel's content (a same-workspace re-read does not fall back to a "loading"
  line and snap back); the header's refresh button greys out and reads
  "Refreshing…".
- **Click a change to see its diff**: clicking any row of the change list grows
  the panel from its 400px single column into two panes — the full workbench on
  the left, that file's unified diff on the right (see *The diff viewer* below).
  Clicking the same row again, or the diff header's `×`, folds it back.
- **Composer dock pill** (`conversation.input.dock`): a compact, left-aligned
  status pill at the textarea's top-left (branch summary or "not a git
  repository"); clicking it toggles the floating panel.
- Both seats share one store, so they always agree, and both re-bind when the
  current session (and its cwd) changes. Rebinding clears the selected file —
  the panel never shows another repository's content.
- **ANSI colour codes are stripped from git's text output**: remotes colour
  their own banner (gitee's `Powered by GITEE.COM` does), and the panel is a DOM,
  not a terminal — the ESC byte has no glyph, so only the parameters survived
  and read as `[0[01;33m`. Only `message` text is stripped; **diff bodies and
  paths stay byte-faithful**.

### The diff viewer

Clicking a row of the change list shows that file's git diff on the right. The
list is the viewer's navigation: the highlighted row is the file on screen, and
the first selection expands the list to its full length.

- **Resizable**: the handle is the panel's own right edge — dragging it widens the
  panel (the workbench keeps its width) and the diff takes the rest, 1:1 with the
  pointer because the panel anchors its left edge on grab. Double-clicking the
  edge resets the width, and the panel always stays inside the viewport.
- **A stable box while the diff is open**: selecting a file pins the panel's height
  (both columns run to the bottom), so the diff arriving, switching files and
  collapsing again only scroll inside the panes — the panel never resizes under
  the pointer.
- **Staged / unstaged**: by default the pane follows the data — unstaged when
  that side has anything, staged otherwise — with two chips to switch by hand
  (an empty side is dimmed). When a file has changes on both sides, one click
  shows the side you care about and the other is one chip away.
- **Self-refreshing**: staging, committing, switching branches, or refreshing
  re-reads the open diff; when the unstaged side empties, the pane falls back to
  the staged side on its own.
- **Line numbers and colour**: per-side gutters taken from each hunk header,
  `+`/`-` rows in the theme's success/error colours, hunk headers on their own
  row, `\ No newline at end of file` dimmed.
- **Every edge has its own notice**: nothing on this side / a binary file has no
  text diff / the diff was too large and only its beginning is shown / N more
  untracked files were not expanded / the read failed. A diff past 1500 rows
  renders its first 1500 with a button to expand the rest (so a huge patch never
  becomes tens of thousands of nodes).
- **Untracked files** are diffed against the empty blob and read as a
  `new file mode` addition; an untracked **directory** is expanded file by file
  (capped at 50, the rest counted in that notice).
- **Renames** hand git both the old and the new path as the pathspec: naming only
  the new one leaves git unable to pair them and turns a rename into a whole-file
  addition.

### The commit area and AI drafting

The commit area follows the real order of operations: **stage all → draft → commit**.

- **Stage all**: `git add --all` (deletions and untracked files included).
  Disabled while the tree is clean. This is the answer to "only unstaged
  changes exist, so Commit fails" — committing itself still never stages
  implicitly.
- **Draft basis**: one of `Staged` (default), `Unstaged`, `Everything` — which
  part of the change set is handed to the model. `Staged` is the default
  because **it is the only basis whose content the commit actually records**;
  a message drafted from anything else may describe changes that will not be
  committed.
- **✨ AI draft**: sends the selected change set (diffstat + diff, truncated)
  to the model the current session has selected and drops the generated
  message into the input. Edit it, or just write your own.
- **Commit-message language (⚙ in the header)**: `Auto` by default — the model
  follows the language already used by the repository's commits and comments
  (the historical behaviour). Pick one of the presets (简体中文 / 繁體中文 /
  English / 日本語 / 한국어 / Français / Deutsch / Español / Русский) or
  `Custom…` and type a language name, and the draft is **forced** to write the
  whole message — subject and body — in that language, with the system prompt
  saying outright that it overrides the code comments, the past commit subjects
  and the diff. A repository whose comments are English is exactly what drags
  "Auto" off course, which is what this switch is for. The choice lives in the
  browser's `localStorage` (key `dsh-git.commitLanguage`), applies to every
  workspace and survives a reload; when storage is unavailable it silently
  falls back to `Auto`. A custom name is validated by the host for shape and
  length (≤ 60 chars, no line feed, quote or colon that could open a prompt
  rule of its own) and reports `invalid-language` when it does not fit.

The model route comes from the current session's `modelSelection` projection
(pending pick first, then last used), falling back to the host's first
registered route. The request carries the **current session id** (`sessionId`):
some gateways (the opencode-style routes on this machine, for one) require a
session-affinity header, and the host forwards a session id to its adapter only
when the request has one — without it the gateway answers `MissingSessionID`.
Failures are reported in the last-operation output with a localized sentence
(no changes / no model configured / draft failed, …); an unrecognized failure
code leads with the localized sentence and appends the host's own diagnosis.

## Architecture

One dual-face npm package:

| Half | File | Role |
| --- | --- | --- |
| Host | `lib/index.js` | Cordis plugin (bundle row `dsh-git`) registering the `/dsh-git-rpc` prefix route on its own `ctx.webServer`, speaking the same Connection RPC envelope the browser's `connection.rpc.call` sends and reusing the connection service's Host/Origin + browser-session fence (`connection.requestRejection`). Endpoints: `status`, `branches`, `checkout`, `createBranch`, `fetch`, `pull`, `stage`, `diff`, `commit`, `push`, `log`, `generateMessage`. All git runs via `execFile` (no shell), timeouts (30s local / 120s network), strict input validation. AI drafting goes through the injected `llm` service. |
| Browser | `lib/client.js` | `dsh.client` bundle (served at `/plugins/@xia-sc/dsh-git/client.js`): floating panel + dock line + shared store, hand-written against the module table (only `react`). |

### Why the route is self-owned (dsh >= 0.1.5-rc.1)

Since dsh 0.1.5-rc.1 an outside plugin can no longer call
`ctx.connection.rpc.handle()`: `HostConnectionService.rpc` closes over the
connection plugin's **own** Context (`inject` is only `["credentials"]`) and
registers through it (`owner.effect(() => owner.webServer.register(route))`),
while that plugin only resolves `webServer` inside an inner
`ctx.inject(["webServer"], …)` scope. Whatever the caller injects, the row
therefore failed to mount with `cannot get property "webServer" without inject`
— which is exactly what 0.3.0 did. This build registers `/dsh-git-rpc` itself
and implements the same RPC envelope; the request fence still comes from the
connection service's `requestRejection`, so the channel is exactly as trusted
as `/api`. `test/host-mount.mjs` guards this against a real Cordis host and the
real Connection service.

### The session binding belongs to the session-scoped seat (dsh >= 0.1.6-alpha.2)

Both faces used to read `current` (the current session id) out of the sessions
list snapshot. 0.1.6-alpha.2 dropped that field — the snapshot is now `ids` /
`byId` / `phase` / `subagentsByParent` / `jobsBySession`, and the current
session reaches **session-scoped** seats through the renderer's scope adapter
(`SlotScopeAdapter.current`, derived from `retainedBy.mainView`), which a
root-scoped `shell.overlay` entry cannot read (the symptom is the pill and the
panel silently disappearing, with no error anywhere).

Now the **pill** (`conversation.input.dock`, session-scoped: the framework hands
it `sessionId`) reads that session's `cwd` from the `useSessions` snapshot and
calls `store.bindSession(sessionId, cwd)`; the **panel** only reads the shared
store's `sessionId` / `cwd` (it also uses the identity to resolve the
`modelSelection` projection behind the AI draft route). `byId[id].retainedBy.mainView`
keeps an embedded Conversation (a subagent chat tab) from taking the workbench
over; a snapshot without that count is treated as main-view so the pill never
vanishes for want of it.

## Install

```sh
dsh plugin --profile web add @xia-sc/dsh-git
```

Or install straight from the source (both channels are the same code: the npm
version is the artifact of the matching tag):

```sh
dsh plugin --profile web add https://github.com/xia-sc/dsh-git
```

Then **restart `dsh web`** (bundle rows and the browser roster compose at
boot). After refresh, the dock pill appears above the composer once the current
session's workspace is a git repository; click it to open the panel.

Requires **dsh >= 0.1.5-rc.1** (the host half owns its `/dsh-git-rpc` route; see
the architecture note above).

Uninstall:

```sh
dsh plugin --profile web remove @xia-sc/dsh-git
```

## RPC contract (`/dsh-git-rpc`)

The browser calls `ctx.connection.rpc.call("/dsh-git-rpc", endpoint, { args })`;
the host side is this plugin's own `/dsh-git-rpc/*` prefix route, speaking the
same Connection envelope as `/api`:

- Request: `POST /dsh-git-rpc/<endpoint>`, `content-type: application/json`,
  `{ type: "client-request", rpcId, method: <endpoint>, payload: { args } }`
- Response: `{ type: "server-response", rpcId, result: { ok: true, value } | { ok: false, error } }`
- Fence: `connection.requestRejection` (Host/Origin + browser session cookie);
  non-`POST` → 405, non-JSON → 415, oversized body → 413, path outside the
  channel → 404.

Payloads use the `{ args }` convention. `cwd` must be an absolute path;
`branch` matches `^[A-Za-z0-9][A-Za-z0-9._/-]*$` (no leading `-`, no `..`,
`@{`, `\`, whitespace, control chars); `remote` is a plain segment. The commit
message is a real message: one subject line plus an optional multi-line body.
CRLF becomes LF, trailing whitespace is stripped per line, leading/trailing
blank lines are dropped and runs of blank lines collapse to one (so the single
blank line between subject and body is preserved); empty, over-long (>10000
characters), and control-character-carrying messages are rejected with
`invalid-message`. The message reaches git on stdin via
`git commit --cleanup=whitespace --file=-`, so spaces, quotes, line feeds,
shell metacharacters, and leading dashes are all recorded verbatim.

| Endpoint | args | Result (`value`) |
| --- | --- | --- |
| `status` | `{ cwd }` | `{ repo, branch, detached, oid, upstream, ahead, behind, dirty, changes: [{status, path, index, worktree, file, origFile}] }`. `path` is the display string (a rename reads `old → new`), `file`/`origFile` are the pathspec `diff` needs, and `index`/`worktree` are the two porcelain-v2 letters. |
| `branches` | `{ cwd }` | `{ repo, current, local: [{name, current, upstream, sha}], remote: [{name, short}] }` |
| `checkout` | `{ cwd, branch }` | `{ branch, detached, oid, message? }` via `git switch --guess`; the browser pre-checks dirty state and warns before switching; a refusal caused by "local changes would be overwritten" is surfaced with a readable prefix. |
| `createBranch` | `{ cwd, branch, base? }` | `{ branch, detached, oid, message? }` via `git switch --create <branch> <base>` (omitted base = HEAD); creates the branch from the base branch and switches to it. |
| `fetch` | `{ cwd, remote? }` | `{ message }` (120s timeout) |
| `pull` | `{ cwd }` | `{ message }` via `git pull --ff-only` (never implicit-merge) |
| `stage` | `{ cwd }` | `{ message }` via `git add --all` |
| `diff` | `{ cwd, path, origPath? }` | `{ repo, path, origPath, untracked, skipped, worktree: {diff, binary, truncated}, index: {…} }`. Both sides are read in one round trip (`git diff [--cached] --no-ext-diff --no-color -- <path> [<origPath>]`); `path` must be repository-relative (absolute paths, `..`, a leading `-`, control characters, and surrounding whitespace are rejected with `invalid-path`). An untracked path is diffed with `git diff --no-index -- /dev/null <path>` (exit code 1 tolerated); an untracked directory is expanded with `git ls-files --others --exclude-standard` (capped at 50, the rest counted in `skipped`). A side past 400k characters is truncated at a line boundary and flagged `truncated`; a binary side is flagged `binary`. **Read-only**: it never writes the index, the working tree, or any config. |
| `commit` | `{ cwd, message }` | `{ message }`; `missing-author` error when `user.name/email` unset |
| `push` | `{ cwd }` | `{ message }` (120s timeout) |
| `log` | `{ cwd, count? }` | `{ repo, commits: [{sha, author, subject, refs}] }` (clamped 1..50) |
| `generateMessage` | `{ cwd, mode?, provider?, model?, sessionId?, language? }` | `{ message, mode, provider, model }`. `mode` is `staged` (default) / `unstaged` / `all`; anything else is `invalid-mode`. `sessionId` is an optional non-empty string (over 200 chars is `invalid-session`); the panel sends the current session id so session-affine gateways can route the call. `language` is an optional **language name** (the ⚙ setting; absent, `null`, an empty string and `auto` all mean "follow the repository") written into the system prompt to force the whole message into that language; a name that is too long (> 60 chars) or carries a line feed, quote or colon is `invalid-language`. Failure code in `error.details.code`: `no-changes`, `no-provider`, `no-model`, `llm-truncated` (the output cap ran out before any text was written), `llm-empty`, `cancelled`, `llm-failed`. |

> A failed result carries `error.code === "internal"` on the wire (the Connection
> envelope only requires a string), with the plugin's own diagnostic in
> `error.details.code`; the client localizes from that code.
>
> The `message` of `fetch`/`pull`/`push`/`stage`/`commit` is **git's own output**
> (ANSI colour codes stripped): an empty string when git said nothing. The panel
> notifies with an `output.<action>` phrase and keeps that text behind its
> expandable "Details".

## Design decisions & boundaries

- **pull is `--ff-only`**: no surprise merge commits; conflicts surface as an
  error the user resolves in their own tooling.
- **commit does not stage**: it commits what is staged. To commit everything at
  once, use the commit area's **Stage all** button (`git add --all`) rather than
  making commit stage implicitly.
- **AI drafting sends the change set's diff to whichever model provider you
  configured** — possibly a third-party gateway. It only happens when you click
  "✨ AI draft"; the plugin itself never calls the network. The diff is
  truncated to 12000 characters, and nothing outside the repository is sent.
  The output cap is 8192 tokens: a reasoning model shares that completion budget
  between its thinking and the message, so a cap sized for the message alone
  produces "hit the cap before writing anything" — reported as `llm-truncated`
  rather than a vague `llm-empty`.
- **push/pull credentials** come from the system (Git Credential Manager /
  SSH agent); the plugin never touches credential storage. AI drafting never
  touches credentials either — the model adapter resolves its own API key.
- **The plugin never mutates git config**; missing author reports a clear
  error instead.
- **The diff viewer is strictly read-only**: its endpoint runs only `git diff` /
  `git ls-files` — it never writes the index, the working tree, or any config —
  and it deliberately does **not** depend on the host's right-Sidebar tab API
  (that surface is still moving fast). The two panes live inside the panel
  instead, and the diff renderer is written here as well (this bundle depends on
  `react` only): unified-diff parsing, both line-number gutters, `+`/`-`
  colours, and no syntax-highlighting dependency.
- **A rename needs both names in the pathspec**: git only pairs them when the old
  path is named too; naming the new path alone reports a whole-file addition
  (`test/diff.mjs` guards this).
- **porcelain-v2 status parsing**: a `2` (rename/copy) record carries its path in
  the 10th field with the old name TAB-separated after it, and a `u` (conflict)
  record carries its path in the 11th field and is always a conflict. Both were
  read from `slice(8)` / `slice(9)` before — off by the score and hash columns —
  and are now built by `changeEntry()`.
- **The plugin imports no `@deepseek-ai/*` runtime package** (only `node:`
  builtins and `@deepseek-ai/cordis`). Under a pnpm `link:` install the host
  packages do not resolve from the plugin's real source path, so such an import
  would make the plugin fail at load time; the request construction and stream
  assembly generation needs are therefore implemented locally and tested
  directly by `test/generate.mjs`.
- Panel operations are plain UI actions (like the Cordis panel) and are not
  written to the session log / model prompt. AI drafting only fills the input;
  it never commits by itself.

## Development notes

- The browser bundle is hand-written (no build step); edits to `lib/client.js`
  are picked up on refresh (no-cache), host-side edits need a `dsh web`
  restart.
- Tests (`npm test` runs all five):
  - `node test/smoke.mjs` — route, envelope, endpoint dispatch and input
    validation (no git spawn: the session sandbox blocks child-process piped
    stdio);
  - `node test/host-mount.mjs` — mounts the row on a real Cordis host with the
    real `dsh-client-connection` (resolved from the `DSH_HOME` profile; SKIPs
    when no profile is installed);
  - `node test/generate.mjs` — the AI-draft units: route resolution, prompt
    assembly, truncation, stream assembly (both the `block-end` and the
    delta-only path), terminal failure / abort / empty output;
  - `node test/render.mjs` — real React SSR render of both seats, including the
    three commit-area controls, the diff parser (line numbers, row kinds, a
    removed line starting with `--`), the row renderer, the diff pane's header,
    and `act()`'s result plumbing and localization (needs a react/react-dom copy,
    e.g. via `DSH_GIT_REACT_ROOT`; SKIPs without one).
  - `node test/slot-mount.mjs` — mounts both seats on the real
    `SlotCore`/`SlotRegistry` with the real renderer (SKIPs without a host profile).
  - `npm run test:ui:settings` — **real browser** offline regression
    (playwright-core + local Chrome; needs neither `dsh web` nor authentication):
    the script serves this checkout over loopback, mounts the client half with the
    React UMD build, and then really clicks the ⚙ settings popover, switches the
    language, and checks both the `localStorage` persistence and the `language`
    the draft request carries; it writes `test/ui/settings-popover.png`.
- `npm run test:commit` — **end-to-end**: really spawns git in a throwaway
  repository, commits through the plugin's own `/dsh-git-rpc/commit` route, and
  reads the message back with `git log --format=%B` (multi-line, CRLF, non-ASCII,
  leading `-`, shell metacharacters…), then confirms a rejected message creates
  no commit.
- `npm run test:diff` — **end-to-end**: drives `/dsh-git-rpc/diff` in a throwaway
  repository through every shape the change list can produce — both sides of the
  index, an untracked file and an untracked **directory**, **rename pairing**, a
  deletion, a binary blob, the 400k truncation, path validation, and a directory
  outside any work tree.
- The last two need piped child-process stdio, so they are deliberately **not**
  part of `npm test` — run them from an ordinary terminal.
- The git command set is verified end-to-end against the running server.

## License

MIT — see [LICENSE](LICENSE).
