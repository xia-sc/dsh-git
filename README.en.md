# @dsh-plugins/dsh-git

[中文](./README.md) | English

Complete Git management for the DeepSeek Harness Web GUI, presented as a
**collapsible floating block** that **follows the current session's workspace
in real time** — click a different session/workspace in the sidebar and the
panel rebinds to that repository instantly.

**Workflow supported:** branch switch · fetch · pull (fast-forward only) ·
commit · push · status · recent commits · uncommitted-file list · new-branch-from-base.

## UI

- **Floating block** (`shell.overlay`): collapsed = renders nothing (no
  floating element that could cover the input); expanded = the full Git
  workbench (status line, branch switcher with **dirty-tree pre-check** —
  selecting a branch while uncommitted changes exist shows a warning listing
  the affected files instead of switching, with a "switch anyway" escape
  hatch, fetch/pull/commit/push actions, collapsible changes and recent-commit
  lists, last-operation output). The panel is **draggable by its header bar**
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

## Architecture

One dual-face npm package:

| Half | File | Role |
| --- | --- | --- |
| Host | `lib/index.js` | Cordis plugin (bundle row `dsh-git`) registering the `/dsh-git-rpc` prefix route on its own `ctx.webServer`, speaking the same Connection RPC envelope the browser's `connection.rpc.call` sends and reusing the connection service's Host/Origin + browser-session fence (`connection.requestRejection`). Endpoints: `status`, `branches`, `checkout`, `createBranch`, `fetch`, `pull`, `commit`, `push`, `log`. All git runs via `execFile` (no shell), timeouts (30s local / 120s network), strict input validation. |
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
`@{`, `\`, whitespace, control chars); `remote` is a plain segment; the commit
message is passed as `--message=<msg>` (control chars rejected).

| Endpoint | args | Result (`value`) |
| --- | --- | --- |
| `status` | `{ cwd }` | `{ repo, branch, detached, oid, upstream, ahead, behind, dirty, changes: [{status, path}] }` |
| `branches` | `{ cwd }` | `{ repo, current, local: [{name, current, upstream, sha}], remote: [{name, short}] }` |
| `checkout` | `{ cwd, branch }` | `{ branch, detached, oid, message? }` via `git switch --guess`; the browser pre-checks dirty state and warns before switching; a refusal caused by "local changes would be overwritten" is surfaced with a readable prefix. |
| `createBranch` | `{ cwd, branch, base? }` | `{ branch, detached, oid, message? }` via `git switch --create <branch> <base>` (omitted base = HEAD); creates the branch from the base branch and switches to it. |
| `fetch` | `{ cwd, remote? }` | `{ message }` (120s timeout) |
| `pull` | `{ cwd }` | `{ message }` via `git pull --ff-only` (never implicit-merge) |
| `commit` | `{ cwd, message }` | `{ message }`; `missing-author` error when `user.name/email` unset |
| `push` | `{ cwd }` | `{ message }` (120s timeout) |
| `log` | `{ cwd, count? }` | `{ repo, commits: [{sha, author, subject, refs}] }` (clamped 1..50) |

## Design decisions & boundaries

- **pull is `--ff-only`**: no surprise merge commits; conflicts surface as an
  error the user resolves in their own tooling.
- **commit does not stage**: it commits what is staged (`git add` is the
  user's job, in their own tooling).
- **push/pull credentials** come from the system (Git Credential Manager /
  SSH agent); the plugin never touches credential storage.
- **The plugin never mutates git config**; missing author reports a clear
  error instead.
- Panel operations are plain UI actions (like the Cordis panel) and are not
  written to the session log / model prompt.

## Development notes

- The browser bundle is hand-written (no build step); edits to `lib/client.js`
  are picked up on refresh (no-cache), host-side edits need a `dsh web`
  restart.
- Tests (`npm test` runs all three):
  - `node test/smoke.mjs` — route, envelope, endpoint dispatch and input
    validation (no git spawn: the session sandbox blocks child-process piped
    stdio);
  - `node test/host-mount.mjs` — mounts the row on a real Cordis host with the
    real `dsh-client-connection` (resolved from the `DSH_HOME` profile; SKIPs
    when no profile is installed);
  - `node test/render.mjs` — real React SSR render of both seats (needs a
    react/react-dom copy, e.g. via `DSH_GIT_REACT_ROOT`; SKIPs without one).
- The git command set is verified end-to-end against the running server.
