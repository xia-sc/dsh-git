# @xia-sc/dsh-git

English | [中文](./README.md)

Git for the DeepSeek Harness Web GUI: a collapsible floating panel plus a composer pill that
**always follows the current session's workspace**, so branch / commit / push / diff work happens
in the GUI instead of a terminal.

**Workflows:** branch switching · fetch · pull (fast-forward only) · stage all · commit (with
AI-drafted messages) · push · one-click commit & push · stash / restore · discard one change ·
amend the last commit · click a change to see its diff · new branch from any base.

## Features

- **Floating panel** (`shell.overlay`) and **composer pill** (`conversation.input.dock`) share one
  store. The collapsed panel renders nothing; the pill shows the branch summary and toggles it.
- **Branches**: the switcher pre-checks a dirty tree (warns before switching); remote branches are
  listed with their full tracking refs (`origin/main`, `upstream/main`) and create a tracking
  branch when picked; a name collision is reported instead of silently detaching HEAD.
- **Diff viewer**: clicking a change row opens two panes (workbench + unified diff), resizable via
  the panel's right edge (double-click resets); staged/unstaged sides switch; large diffs are
  virtualized; the open diff follows data changes.
- **Commit area**: stage all, AI draft basis (staged / unstaged / everything), ✨ AI draft, a
  multi-line message box (Ctrl/Cmd+Enter commits), Commit and Commit & push; the draft language
  can be forced in ⚙.
- **Auto refresh** (on by default): read-only polling every 4 s with the panel open / 15 s while
  collapsed; pauses while the page is hidden, reads once on return, backs off on failures; can be
  turned off in ⚙ (persisted in `localStorage`).
- **Stash shelf**: lists `stash@{N}` entries with git's subject; **＋ Stash** stores tracked
  changes as `WIP on <branch>`; **Restore** runs `git stash pop`. Untracked files are **not**
  included by default; a conflicting pop keeps the entry and leaves the conflict in the tree.
- **Discard one change**: the `✕` on a change row asks for **inline confirmation** (irreversible);
  tracked files go back to HEAD (`git restore --staged --worktree`), untracked files/directories
  are removed (`git clean -f -d`); conflicted rows have no such control, and there is no
  "discard everything".
- **Amend the last commit**: the switch in the commit card pre-fills the previous message (never
  overwriting an existing draft) and turns the button into Amend. It reuses the same message
  normalization and `--cleanup=whitespace`, plus `--amend`. Rewriting a pushed branch needs a
  force push, which the plugin never does automatically; Commit & push is disabled while amending.
- **Forge cooperation (dsh >= 0.2.2)**: after a successful push the plugin calls the host's
  optional `forgeSession.discoverBranch`, so the official Forge panel discovers the branch's open
  PR — a panel push is not a shell call, so forge would otherwise never learn about it. Older
  hosts, missing providers and local remotes skip this silently and the push is unaffected.
- **Refreshing never flashes**: ↻ and post-action re-reads keep the panel's content; only the ↻
  button greys out. **Operation feedback stays one line** at the top of the body (localized summary
  plus git's own output behind "Details").
- Buttons share equal widths; colors/spacing come from theme tokens; the panel is draggable
  (double-click the header to reset).

## Install

```sh
dsh plugin --profile web add @xia-sc/dsh-git
# or from source (same content):
dsh plugin --profile web add https://github.com/xia-sc/dsh-git
```

Then **restart `dsh web`** (the bundle row and browser roster are composed at startup). Requires
**dsh >= 0.1.5-rc.1**; forge cooperation needs **0.2.2+** with forge enabled.

Uninstall: `dsh plugin --profile web remove @xia-sc/dsh-git`.

## RPC contract (`/dsh-git-rpc`)

The browser calls `ctx.connection.rpc.call("/dsh-git-rpc", endpoint, { args })`; the host half owns
that prefix route and speaks the same Connection envelope as `/api`:

- Request: `POST /dsh-git-rpc/<endpoint>`, `application/json`,
  `{ type: "client-request", rpcId, method, payload: { args } }`
- Response: `{ type: "server-response", rpcId, result: { ok: true, value } | { ok: false, error } }`
- Fence: `connection.requestRejection` (Host/Origin + browser session cookie); not POST → 405,
  not JSON → 415, body too large → 413, outside the channel → 404.

`cwd` must be absolute; `branch` matches `^[A-Za-z0-9][A-Za-z0-9._/-]*$`; `path` is repository-relative
(no absolute paths, `..`, leading `-`, control chars or surrounding spaces). Commit messages: CRLF→LF,
trailing spaces stripped per line, blank-line runs collapsed; empty/over-long (>10000)/control-char
messages are `invalid-message`; the message reaches git on stdin through
`git commit --cleanup=whitespace --file=-`.

| Endpoint | Args | Result / notes |
| --- | --- | --- |
| `status` | `{ cwd }` | `{ repo, branch, detached, oid, upstream, ahead, behind, dirty, generate, stashes: [{ref, subject}], changes: [{status, path, index, worktree, file, origFile}] }`; `generate` says whether the host provides `llm`; `stashes` rides along (max 50) |
| `branches` | `{ cwd }` | `{ repo, current, local, remote }`; remote entries carry the full tracking ref plus the short branch name; per-remote `HEAD` symrefs are filtered out |
| `checkout` | `{ cwd, branch }` | `{ branch, detached, oid, message? }`; a remote ref creates a tracking branch; a name collision reports `checkout-remote-conflict` and leaves HEAD untouched |
| `createBranch` | `{ cwd, branch, base? }` | `{ branch, detached, oid, message? }` via `git switch --create` (base defaults to HEAD) |
| `fetch` | `{ cwd }` | `{ message }` (120s) |
| `pull` | `{ cwd }` | `{ message }`, always `--ff-only` |
| `stage` | `{ cwd }` | `{ message }` via `git add --all` |
| `stash` | `{ cwd, message?, includeUntracked? }` | `{ message }`; message is one line ≤200 chars; omitted → git's own `WIP on <branch>`; `-u` only when `includeUntracked`; nothing stashable → `no-changes` |
| `stashPop` | `{ cwd, ref }` | `{ message }`; ref accepts only `stash@{N}` (`invalid-ref`); conflict → `stash-conflict` (entry kept), blocked by a dirty tree → `stash-blocked`, missing → `stash-missing` |
| `discard` | `{ cwd, path, origPath? }` | `{ message }`; the host re-reads the path's porcelain-v2 status: conflict → `discard-conflict` (refused), untracked → `git clean -f -d`, staged addition → unstage then clean, otherwise → `git restore --staged --worktree` (rename passes both paths) |
| `diff` | `{ cwd, path, origPath? }` | `{ repo, path, origPath, untracked, skipped, worktree: {diff, binary, binaryPaths, truncated}, index: {…} }`; both sides in one read, untracked via `--no-index`, 400k-char per-side truncation, binary decided per file; **read-only** |
| `commit` | `{ cwd, message, amend? }` | `{ message }`; `amend:true` runs `--amend --cleanup=whitespace --file=-` (`no-commit` without HEAD); missing author → `missing-author` |
| `headMessage` | `{ cwd }` | `{ message }` (`git log -1 --format=%B`); `no-commit` when there is no commit; read-only |
| `push` | `{ cwd, sessionId? }` | `{ message }` (120s); no upstream → automatic `--set-upstream` (`remote.pushDefault`→`origin`→only remote, else `no-remote`); `sessionId` is an optional forge-discovery hint, silently ignored when unusable |
| `log` | `{ cwd, count? }` | `{ repo, commits: [{sha, author, subject, refs}] }` (clamped 1..50) |
| `generateMessage` | `{ cwd, mode?, provider?, model?, sessionId?, language? }` | `{ message, mode, provider, model }`; failure codes `llm-unavailable` / `no-changes` / `no-provider` / `no-model` / `llm-truncated` / `llm-empty` / `cancelled` / `llm-failed` |

> `error.code` on the wire is always `"internal"`; plugin diagnostic codes live in
> `error.details.code` and the client localizes by them. `fetch`/`pull`/`push`/`stage`/`commit`/`stash`
> return git's own output as `message` (ANSI stripped; empty when git said nothing); the panel words
> `output.<action>` and keeps the raw output under "Details".

## Design decisions & boundaries

- **commit does not stage**: it records what is staged; Commit & push is an explicit composite
  (stage all → commit → push). When the push fails the commit has landed and the notice says so.
- **pull is `--ff-only`**; **a branch without an upstream is pushed with `--set-upstream`** (git's
  own advice; git writes the tracking config).
- **Never edits git config, never touches credentials** (system credential manager / SSH agent;
  missing author is an error, not something to fill in).
- **Discarding is irreversible**: one path at a time, always confirmed; no "discard all";
  conflicted paths are refused; untracked paths use `clean -f -d` (no `-x`, ignored files stay).
- **Stash follows git**: untracked files excluded by default; a conflicting pop keeps the entry;
  no `stash drop`/`apply`.
- **Amend rewrites history**: no automatic force push; the success line says so; the composite
  action is disabled while amending.
- **Forge cooperation is optional**: only the host's public `discoverBranch` (read-only lookup);
  older hosts / missing providers skip silently; no fake shell tool events, no session-log writes,
  no direct writes to forge internals.
- **The diff viewer is read-only**: `diff` only runs `git diff`/`git ls-files` and never writes the
  index, the working tree or config; it does not depend on the host's right-sidebar tab API and
  renders the two panes itself (only `react`, no syntax highlighting).
- The plugin imports no `@deepseek-ai/*` runtime packages (only `node:` builtins and
  `@deepseek-ai/cordis`); `llm`/`forgeSession`/`sessions` are all read optionally via `ctx.get`.
- Panel actions are ordinary UI behavior: no session log, no model prompt, no auto-commit;
  auto refresh is read-only polling.

## Development notes

- The browser half (`lib/client.js`) is a **hand-written artifact with no build step**: edits apply
  on page refresh. Host-half (`lib/index.js`, `cordis.patch.yml`) edits need a `dsh web` restart.
- `npm test`: smoke → host-mount → slot-mount → generate → render (no git; render needs
  `react`/`react-dom`, point `DSH_GIT_REACT_ROOT` at a node_modules else it SKIPs).
- Real-git end-to-end (needs an ordinary terminal; a confined sandbox blocks piped child processes):
  `npm run test:diff` / `test:commit` / `test:push` / `test:checkout` / `test:stash` / `test:discard`.
- Real-browser scripts (playwright-core + local Chrome, offline, no auth): `npm run test:ui:settings`
  / `test:ui:branches` / `test:ui:auto` / `test:ui:actions`; `test/ui/verify-diff.mjs` needs auth
  (`DSH_GIT_UI_URL` / `DSH_GIT_UI_STORAGE_STATE`).
- Engineering conventions, pitfalls and the release flow are in `AGENTS.md`.

## License

MIT — see [LICENSE](LICENSE).
