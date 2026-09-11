# @dsh-plugins/dsh-git

[中文](./README.md) | English

Complete Git management for the DeepSeek Harness Web GUI, presented as a
**collapsible floating block** that **follows the current session's workspace
in real time** — click a different session/workspace in the sidebar and the
panel rebinds to that repository instantly.

**Workflow supported:** branch switch · fetch · pull (fast-forward only) ·
stage all · commit (with an AI-drafted message) · push · status · recent
commits · uncommitted-file list · new-branch-from-base.

## UI

- **Floating block** (`shell.overlay`): collapsed = renders nothing (no
  floating element that could cover the input); expanded = the full Git
  workbench (status line, branch switcher with **dirty-tree pre-check** —
  selecting a branch while uncommitted changes exist shows a warning listing
  the affected files instead of switching, with a "switch anyway" escape
  hatch, fetch/pull actions, a **commit area** — stage-all button, draft-basis
  picker, "✨ AI draft" button, message input and commit button — collapsible
  changes and recent-commit lists, last-operation output). The panel is
  **draggable by its header bar**
  (the top row with the Git title — press, drag, release; it stays where
  dropped and is clamped inside the viewport; header buttons/inputs never
  start a drag; double-click the header to snap back to center).
  A "＋ New branch" button beside the branch switcher opens an inline form:
  new branch name + base-branch picker (local branches or full remote refs
  like `origin/feature/x`) — confirming creates the branch from the base and
  switches to it.
- **Composer dock pill** (`conversation.input.dock`): a compact, left-aligned
  status pill at the textarea's top-left (branch summary or "not a git
  repository"); clicking it toggles the floating panel.
- Both seats share one store, so they always agree, and both re-bind when the
  current session (and its cwd) changes.

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

The model route comes from the current session's `modelSelection` projection
(pending pick first, then last used), falling back to the host's first
registered route. Failures are reported in the last-operation output with a
localized sentence (no changes / no model configured / draft failed, …).

## Architecture

One dual-face npm package:

| Half | File | Role |
| --- | --- | --- |
| Host | `lib/index.js` | Cordis plugin (bundle row `dsh-git`) registering the `/dsh-git-rpc` prefix route on its own `ctx.webServer`, speaking the same Connection RPC envelope the browser's `connection.rpc.call` sends and reusing the connection service's Host/Origin + browser-session fence (`connection.requestRejection`). Endpoints: `status`, `branches`, `checkout`, `createBranch`, `fetch`, `pull`, `stage`, `commit`, `push`, `log`, `generateMessage`. All git runs via `execFile` (no shell), timeouts (30s local / 120s network), strict input validation. AI drafting goes through the injected `llm` service. |
| Browser | `lib/client.js` | `dsh.client` bundle (served at `/plugins/@dsh-plugins/dsh-git/client.js`): floating panel + dock line + shared store, hand-written against the module table (only `react`). |

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

## Install

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
dsh plugin --profile web remove @dsh-plugins/dsh-git
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
| `status` | `{ cwd }` | `{ repo, branch, detached, oid, upstream, ahead, behind, dirty, changes: [{status, path}] }` |
| `branches` | `{ cwd }` | `{ repo, current, local: [{name, current, upstream, sha}], remote: [{name, short}] }` |
| `checkout` | `{ cwd, branch }` | `{ branch, detached, oid, message? }` via `git switch --guess`; the browser pre-checks dirty state and warns before switching; a refusal caused by "local changes would be overwritten" is surfaced with a readable prefix. |
| `createBranch` | `{ cwd, branch, base? }` | `{ branch, detached, oid, message? }` via `git switch --create <branch> <base>` (omitted base = HEAD); creates the branch from the base branch and switches to it. |
| `fetch` | `{ cwd, remote? }` | `{ message }` (120s timeout) |
| `pull` | `{ cwd }` | `{ message }` via `git pull --ff-only` (never implicit-merge) |
| `stage` | `{ cwd }` | `{ message }` via `git add --all` |
| `commit` | `{ cwd, message }` | `{ message }`; `missing-author` error when `user.name/email` unset |
| `push` | `{ cwd }` | `{ message }` (120s timeout) |
| `log` | `{ cwd, count? }` | `{ repo, commits: [{sha, author, subject, refs}] }` (clamped 1..50) |
| `generateMessage` | `{ cwd, mode?, provider?, model? }` | `{ message, mode, provider, model }`. `mode` is `staged` (default) / `unstaged` / `all`; anything else is `invalid-mode`. Failure code in `error.details.code`: `no-changes`, `no-provider`, `no-model`, `llm-empty`, `cancelled`, `llm-failed`. |

> A failed result carries `error.code === "internal"` on the wire (the Connection
> envelope only requires a string), with the plugin's own diagnostic in
> `error.details.code`; the client localizes from that code.

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
- **push/pull credentials** come from the system (Git Credential Manager /
  SSH agent); the plugin never touches credential storage. AI drafting never
  touches credentials either — the model adapter resolves its own API key.
- **The plugin never mutates git config**; missing author reports a clear
  error instead.
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
- Tests (`npm test` runs all four):
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
    three commit-area controls and `act()`'s result plumbing and localization
    (needs a react/react-dom copy, e.g. via `DSH_GIT_REACT_ROOT`; SKIPs without
    one).
- `npm run test:commit` — **end-to-end**: really spawns git in a throwaway
  repository, commits through the plugin's own `/dsh-git-rpc/commit` route, and
  reads the message back with `git log --format=%B` (multi-line, CRLF, non-ASCII,
  leading `-`, shell metacharacters…), then confirms a rejected message creates
  no commit. It needs piped child-process stdio, so it is deliberately **not**
  part of `npm test` — run it from an ordinary terminal.
- The git command set is verified end-to-end against the running server.
