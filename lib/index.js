/**
 * @xia-sc/dsh-git — host half.
 *
 * Mounts the `/dsh-git-rpc` Connection RPC channel on the web server. The
 * browser half (lib/client.js) calls the endpoints through
 * `connection.rpc.call("/dsh-git-rpc", endpoint, { args })` with the current
 * session's workspace directory as `args.cwd`:
 *
 *   - `status`    → repo facts: current branch (or detached HEAD), dirty file
 *                   count, ahead/behind vs upstream, uncommitted file list.
 *   - `branches`  → local and remote branch lists. Remote entries carry both the
 *                   full remote-tracking ref (`origin/main`) and the branch part
 *                   (`main`), so two remotes with the same branch name stay
 *                   distinguishable.
 *   - `checkout`  → switch branches. A local name goes through `git switch
 *                   --guess`; a remote-tracking ref starts a local tracking
 *                   branch, or is refused with `checkout-remote-conflict` when a
 *                   local branch of the same name tracks another remote. Never
 *                   detaches.
 *   - `createBranch` → create a new branch from a base branch and switch to
 *                   it (IDE "new branch from…" semantics).
 *   - `fetch`     → git fetch (optionally a specific remote).
 *   - `pull`      → git pull --ff-only (fast-forward only; conflicts surface
 *                   as errors instead of surprise merges).
 *   - `stage`     → git add --all, so the next commit has something to record.
 *   - `stash`     → git stash push (message on the reflog, optionally including
 *                   untracked files) — the panel's "put it aside" action.
 *   - `stashPop`  → git stash pop <ref>; a conflict keeps the stash entry (git's
 *                   own behaviour) and is reported as `stash-conflict`.
 *   - `discard`   → drop ONE path's uncommitted changes: `git restore --staged
 *                   --worktree` for tracked entries, `git clean -f -d` for
 *                   untracked ones. The host decides from its own status read;
 *                   conflicted paths are refused.
 *   - `headMessage` → the current commit's message, for the amend flow.
 *   - `diff`      → one changed path's unified diff, read from both sides of the
 *                   index (staged / unstaged) so the panel can show either;
 *                   untracked paths are diffed against the empty blob.
 *   - `commit`    → git commit (message on stdin via `--file=-`) with
 *                   author-config check up front; `amend: true` rewrites HEAD
 *                   through the same message path.
 *   - `push`      → git push; a branch without an upstream (the state every
 *                   just-created branch is in) is pushed with
 *                   `--set-upstream <remote> <branch>`, which creates the
 *                   remote branch and records the tracking relationship. After
 *                   a successful push the optional `forgeSession` service (dsh
 *                   >= 0.2.2) is asked to discover open change requests for the
 *                   pushed branch, so the official Forge panel sees PRs that
 *                   were not created through a shell tool call.
 *   - `log`       → recent commit summary lines.
 *   - `generateMessage` → draft a commit message from the working tree through
 *                   the shared LLM service (see the endpoint's own docs); the
 *                   caller may pin the message's language with `language`.
 *
 * Every git run goes through execFile with a fixed argument array (no shell),
 * a timeout, and strict input validation.
 *
 * dsh >= 0.1.5-rc.1: this package owns its HTTP route outright.
 *
 * `connection.rpc.handle()` cannot be used by an outside plugin in this
 * version. `HostConnectionService.rpc` closes over `this.ctx` — the connection
 * plugin's OWN Context, whose inject is only `["credentials"]` — and registers
 * through it (`owner.effect(() => owner.webServer.register(route))`, see
 * dsh-client-connection lib/index.js), while that plugin reaches `webServer`
 * through an inner `ctx.inject(["webServer"], …)` scope. The owner fiber
 * therefore never resolves `webServer`, and the call throws
 * `cannot get property "webServer" without inject` no matter what the caller
 * injects. We register the channel on `webServer` ourselves and speak the same
 * Connection RPC wire protocol the browser's `connection.rpc.call` sends
 * (`{type:"client-request",rpcId,method,payload}` in,
 * `{type:"server-response",rpcId,result}` out).
 *
 * The channel keeps the connection service's own Host/Origin + browser-cookie
 * fence (`connection.requestRejection`), so it is exactly as trusted as the
 * `/api` transport — loopback or a configured trusted authority, same-origin.
 */
import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";

/** Stable Cordis plugin name. */
const name = "dsh-git";
/**
 * Services required before this plugin can mount its channel: `webServer`
 * owns the route and `connection` supplies the request fence.
 *
 * `llm` is deliberately NOT listed. AI drafting is optional, and a hard inject
 * made the whole plugin row wait for a service `dsh-app-boot` does not treat as
 * a required startup entry: a missing `llm` left the channel unmounted (the
 * panel then got a 405 and claimed the workspace was not a repository) instead
 * of degrading one button. The service is read opportunistically through
 * {@link optionalLlm}, and its absence answers `llm-unavailable` from the one
 * endpoint that needs it.
 */
const inject = ["webServer", "connection"];

/** The Connection RPC channel this plugin serves. */
const RPC_CHANNEL = "/dsh-git-rpc";
/** One endpoint segment, mirroring the client's ENDPOINT_SEGMENT_PATTERN. */
const RPC_SEGMENT = /^[A-Za-z0-9_$.-]+$/;
/** Request-body cap: git RPC payloads are small (a commit message at most). */
const RPC_MAX_BODY_BYTES = 1024 * 1024;

/** Per-invocation git timeout for fast local operations. */
const GIT_TIMEOUT_MS = 30000;
/** Longer timeout for network operations (fetch/pull/push). */
const GIT_NET_TIMEOUT_MS = 120000;
/** Capture bound for git output (large repos / long pushes). */
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Ceiling for one commit-message generation. The browser's own abort still
 * applies; this only bounds a request whose client went away without hanging up.
 */
const LLM_TIMEOUT_MS = 120000;
/** Diff characters sent to the model (a diff has no natural size bound). */
const LLM_DIFF_MAX_CHARS = 12000;
/** Diff-stat characters sent to the model. */
const LLM_STAT_MAX_CHARS = 2000;
/**
 * Output cap for one generated commit message. A reasoning model spends this
 * budget on its thinking BEFORE any text exists and reports the two together as
 * `completion_tokens`, so a cap sized for the message alone truncates every
 * call that thinks a little. 8192 leaves room for a long think plus a
 * subject+body; the model still stops on its own well before it (an unset cap
 * would fall back to the adapter's own default, which is larger still).
 */
const LLM_MAX_TOKENS = 8192;
/** Accepted `generateMessage` modes. */
const GENERATE_MODES = ["staged", "unstaged", "all"];
/**
 * Longest session id this plugin will forward to the LLM service. Real ids are
 * short branded strings; the cap only keeps a hostile caller from stuffing
 * arbitrary text into a request header.
 */
const SESSION_ID_MAX_CHARS = 200;
/** Default mode: the only one whose content is what `commit` will actually record. */
const GENERATE_MODE_DEFAULT = "staged";
/**
 * Longest commit-message language directive the panel may send. The setting is
 * a language NAME ("Simplified Chinese (简体中文)"), never a sentence, so a
 * tight cap plus {@link LANGUAGE_DIRECTIVE} keep a caller from smuggling extra
 * prompt rules into the system message.
 */
const LANGUAGE_MAX_CHARS = 60;
/**
 * Shape of an acceptable language directive: a letter or digit, then letters,
 * digits, spaces and the punctuation real language names use. Deliberately no
 * line feed, no control character and no `:` / `;` / quote — the characters
 * that would let the value open a rule of its own inside the system prompt.
 */
const LANGUAGE_DIRECTIVE = /^[\p{L}\p{N}][\p{L}\p{N} .,()（）·'\-/+&]*$/u;

/** A successful RPC result. */
function ok(value) {
	return { ok: true, value };
}
/** A failed RPC result in the Connection transport's `RpcResult` error shape. */
function fail(code, message, details = {}) {
	// The wire requires `error.code` to be a string and `error.details` to be a
	// plain object (see dsh-client-connection rpcErrorSchema / the browser's
	// parseConnectionResponse). `code: "internal"` keeps the envelope acceptable
	// to every 0.1.x host, while the plugin's own diagnostic code rides in
	// `details.code` and `message` stays the human-readable git text the panel
	// shows.
	return { ok: false, error: { code: "internal", message, details: Object.assign({}, details, { code }) } };
}

/**
 * The child's numeric exit status, from whichever field this Node build used.
 * A spawn failure (ENOENT) carries a string errno instead, so it never matches.
 * @param error - an execFile failure.
 * @returns the status, or undefined when the child never exited.
 */
function exitStatusOf(error) {
	for (const candidate of [error.code, error.status, error.exitCode]) {
		if (typeof candidate === "number") return candidate;
	}
	return undefined;
}

/**
 * Run one git invocation without a shell.
 * @param cwd - working directory (the session workspace).
 * @param args - git arguments (never user-joined into a string; no shell).
 * @param signal - optional transport cancellation (kills the child on abort).
 * @param timeoutMs - per-call timeout.
 * @param stdin - optional text written to the child's stdin (`--file=-`).
 * @param allowExit - exit codes this call reads as success. `git diff --no-index`
 * reports "the two sides differ" as exit 1, which is exactly the answer a viewer
 * asked for, so that endpoint lists `[1]` instead of treating it as a failure.
 * @returns resolved stdout/stderr, or rejects with the exec error augmented
 * with `stdout`/`stderr` text.
 */
function runGit(cwd, args, signal, timeoutMs = GIT_TIMEOUT_MS, stdin = undefined, allowExit = undefined) {
	return new Promise((resolve, reject) => {
		const child = execFile("git", args, {
			cwd,
			timeout: timeoutMs,
			maxBuffer: MAX_BUFFER,
			windowsHide: true,
			encoding: "utf8",
			signal
		}, (error, stdout, stderr) => {
			if (error === null) {
				resolve({ stdout, stderr });
				return;
			}
			if (Array.isArray(allowExit) && allowExit.includes(exitStatusOf(error))) {
				// Resolve with whatever the child did print: the caller has declared
				// this code to be an answer rather than a failure.
				resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
				return;
			}
			const wrapped = error instanceof Error ? error : new Error(String(error));
			wrapped.stdout = String(stdout ?? "");
			wrapped.stderr = String(stderr ?? "");
			reject(wrapped);
		});
		if (stdin === undefined) return;
		// A message body is written as UTF-8 and the stream is always closed, so
		// git sees a complete `--file=-` input even when the child never reads it.
		child.stdin.on("error", () => {});
		child.stdin.end(stdin, "utf8");
	});
}

/** Whether a git exec failure means the cwd is outside any work tree. */
function isNotARepo(error) {
	return /not a git repository/i.test(error.stderr ?? "");
}

/** Extract a bounded, display-safe diagnostic from a git failure. */
function cleanMessage(error) {
	const text = String(error.stderr ?? error.message ?? "").trim().replace(/\s+/g, " ");
	return text.length > 0 ? text.slice(0, 800) : "git failed";
}

/** Map an exec failure to an RPC error result. */
function gitError(error) {
	if (error.code === "ENOENT") {
		return fail("git-not-found", "git executable not found on PATH", {});
	}
	if (error.killed === true) {
		return fail("timeout", "git did not finish within the time limit", {});
	}
	if (error.name === "AbortError" || error.signal !== undefined && error.signal !== null) {
		return fail("cancelled", "git operation was cancelled", {});
	}
	return fail("git-error", cleanMessage(error), {});
}

/** Validate a caller-supplied working directory. */
function validCwd(value) {
	return typeof value === "string" && value.length > 0 && isAbsolute(value);
}

/**
 * Read the caller's commit-message language setting.
 *
 * `undefined`/absent/`"auto"` all mean "follow the repository" (the historical
 * behaviour), so the panel can send whatever its settings field holds without
 * the host needing a language table of its own: the value is the language NAME
 * the model should answer in, validated only for shape and length.
 *
 * @param raw - the caller's `language` argument.
 * @returns `{ ok: true, value }` with the directive (or undefined for auto), or
 *   `{ ok: false }` for anything that is not a plain language name.
 */
function readLanguage(raw) {
	if (raw === undefined || raw === null) return { ok: true, value: undefined };
	if (typeof raw !== "string") return { ok: false };
	const trimmed = raw.trim();
	if (trimmed === "" || trimmed.toLowerCase() === "auto") return { ok: true, value: undefined };
	if (trimmed.length > LANGUAGE_MAX_CHARS || !LANGUAGE_DIRECTIVE.test(trimmed)) return { ok: false };
	return { ok: true, value: trimmed };
}

/**
 * Read an optional registered service by name.
 *
 * `ctx.get` is the reflection-layer read: it returns undefined when no fiber
 * provides the service, and — unlike a bare `ctx.service` property read — it
 * never throws "cannot get property ... without inject". It is read per call
 * rather than once in `apply()`, because the host may start or restart a
 * provider independently of this plugin.
 * @param ctx - plugin context.
 * @param serviceName - registered service name (e.g. `llm`, `forgeSession`).
 * @returns the service instance, or undefined when the host provides none.
 */
function optionalService(ctx, serviceName) {
	if (ctx === null || typeof ctx !== "object" || typeof ctx.get !== "function") return undefined;
	try {
		return ctx.get(serviceName);
	} catch {
		return undefined;
	}
}

/**
 * Read the optional `llm` service (the AI drafting capability).
 * @param ctx - plugin context.
 * @returns the `llm` service, or undefined when the host provides none.
 */
function optionalLlm(ctx) {
	return optionalService(ctx, "llm");
}

/** Longest accepted repository-relative path (a git pathspec). */
const PATH_MAX = 4096;

/**
 * Normalize a caller-supplied path into a repository-relative git pathspec.
 *
 * The diff viewer names one file from the status list, so the accepted shape is
 * deliberately narrow: a relative path with no traversal, no option-looking
 * leading `-`, no absolute or drive-qualified form, and no control characters or
 * surrounding whitespace.
 * A trailing slash (how git prints an untracked directory) is kept — the pathspec
 * then matches the whole subtree, which is what the user clicked.
 * @param value - caller-supplied path.
 * @returns the slash-normalized path, or null when it is unusable.
 */
function normalizedPath(value) {
	if (typeof value !== "string") return null;
	if (value.length === 0 || value.length > PATH_MAX) return null;
	// Control characters (NUL, CR, LF, tab, DEL) and surrounding whitespace are
	// never part of a name this endpoint is handed: git quotes such a path in
	// the status output, so it could not have arrived intact anyway.
	if (/[\u0000-\u001f\u007f]/.test(value)) return null;
	if (value !== value.trim()) return null;
	const file = value.replace(/\\/g, "/");
	if (file.startsWith("-") || file.startsWith("/")) return null;
	if (/^[A-Za-z]:/.test(file)) return null;
	if (file.split("/").some((segment) => segment === "." || segment === "..")) return null;
	return file;
}

/** Longest accepted commit message (characters). */
const MESSAGE_MAX = 10000;
/**
 * Characters a commit message may never contain: NUL, every other C0 control
 * except the line feed and the tab, and DEL. A line feed is the message's own
 * line separator and a tab is ordinary indentation — both are legal in a real
 * commit message, and rejecting them here silently broke every drafted (or
 * pasted) message that carried a subject plus a body.
 */
const MESSAGE_FORBIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/**
 * Normalize a caller-supplied commit message into the exact text git records.
 * Accepts a real commit message shape — one subject line plus an optional
 * multi-line body — so newline separated drafts work, while still refusing a
 * message git must not be handed:
 *
 *   - CRLF and lone CR collapse to LF, so a Windows draft survives a clipboard
 *     round trip instead of turning into one unreadable line;
 *   - trailing whitespace is stripped per line, leading and trailing blank
 *     lines are dropped, and runs of blank lines collapse to one — this is
 *     `git commit --cleanup=whitespace` applied here too, and it deliberately
 *     *keeps* the single blank line that separates subject from body;
 *   - empty, whitespace-only, and over-long messages are rejected;
 *   - NUL, other non-whitespace control characters, and DEL are rejected.
 *
 * @param value - caller-supplied message.
 * @returns the normalized message, or null when the value is unusable.
 */
function normalizeCommitMessage(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MESSAGE_MAX) return null;
	const lines = trimmed.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/, ""));
	const collapsed = [];
	for (const line of lines) {
		if (line === "" && (collapsed.length === 0 || collapsed[collapsed.length - 1] === "")) continue;
		collapsed.push(line);
	}
	const normalized = collapsed.join("\n");
	if (normalized.length === 0 || MESSAGE_FORBIDDEN.test(normalized)) return null;
	return normalized;
}

/** Normalize a caller-supplied branch name to a safe git argument. */
function normalizeBranch(raw) {
	if (typeof raw !== "string") return null;
	let value = raw.trim();
	if (value.startsWith("remotes/")) value = value.slice("remotes/".length);
	if (value.length === 0 || value.length > 255) return null;
	if (value.startsWith("-")) return null;
	if (/[\\\s"'`\u0000-\u001f]/.test(value)) return null;
	if (value.includes("..") || value.includes("@{") || value.includes(":") || value.includes("~") || value.includes("^")) return null;
	if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) return null;
	return value;
}

/** Longest accepted stash message (characters). */
const STASH_MESSAGE_MAX = 200;
/**
 * Normalize a caller-supplied stash message.
 *
 * A stash message is one line: it lands in the stash reflog and the panel shows
 * it as a row label. `undefined`/`null`/blank all mean "let git write its own
 * `WIP on <branch>` message" (no `--message` argument at all), while a real
 * value must be a single line without control characters.
 * @param raw - caller-supplied message.
 * @returns the trimmed message (possibly ""), or null when unusable.
 */
function normalizeStashMessage(raw) {
	if (raw === undefined || raw === null) return "";
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (trimmed === "") return "";
	if (trimmed.length > STASH_MESSAGE_MAX) return null;
	if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
	return trimmed;
}

/**
 * The only stash ref shape the host accepts. The panel always sends the ref it
 * read from `status.stashes`; anything else (a revision expression, a branch,
 * an option-looking string) is refused instead of being handed to `git stash
 * pop`, which would happily resolve arbitrary refs.
 */
const STASH_REF = /^stash@\{\d{1,3}\}$/;

/** Validate a caller-supplied stash ref. */
function normalizeStashRef(raw) {
	return typeof raw === "string" && STASH_REF.test(raw) ? raw : null;
}

/**
 * The porcelain-v2 record kinds this plugin parses itself.
 *
 * `git status --porcelain=v2 -z` separates records with NUL and never quotes a
 * path, which matters for the discard endpoint: it must know whether the single
 * target path is untracked (`? `), conflicted (`u `), newly added in the index
 * (XY starts with `A`) or an ordinary modification, without re-implementing the
 * full v2 parser.
 */
function recordKind(record) {
	if (typeof record !== "string" || record.length < 2) return "unknown";
	if (record.startsWith("? ")) return "untracked";
	if (record.startsWith("u ")) return "conflict";
	if (record.startsWith("1 ") || record.startsWith("2 ")) {
		const xy = record.slice(2, 4);
		if (xy.startsWith("A")) return "added";
		return "tracked";
	}
	return "unknown";
}

/** Human label for one porcelain-v2 XY status pair (first char wins for display). */
function labelOf(xy) {
	if (xy === undefined || xy === null) return "?";
	const code = String(xy);
	const first = code[0];
	const second = code[1];
	if (first === "?" || second === "?") return "untracked";
	if (first === "!" || second === "!") return "ignored";
	if (first === "u" || second === "u" || code === "UU") return "conflict";
	switch (first) {
		case "M": return "modified";
		case "A": return "added";
		case "D": return "deleted";
		case "R": return "renamed";
		case "C": return "copied";
		case "T": return "type-changed";
		default: return "changed";
	}
}

/**
 * One entry of the status list.
 *
 * `path` is what the panel prints (a rename reads `old → new`), while `file` /
 * `origFile` are the pathspec the diff endpoint has to be given. `index` and
 * `worktree` are the two porcelain-v2 letters, so the viewer knows which side of
 * the index an entry actually lives on instead of guessing from the label.
 * @param xy - the two-letter XY status.
 * @param path - the path git reported (already display-shaped for a rename).
 * @param options - `file` (pathspec path), `origFile` (pre-rename path), and
 * `status` when the record's own label would mislead (an unmerged pair is a
 * conflict whatever its two letters say).
 */
function changeEntry(xy, path, options = {}) {
	const code = typeof xy === "string" ? xy : "";
	return {
		status: options.status !== undefined ? options.status : labelOf(code),
		path,
		index: code[0] !== undefined ? code[0] : " ",
		worktree: code[1] !== undefined ? code[1] : " ",
		file: options.file !== undefined ? options.file : path,
		origFile: options.origFile !== undefined ? options.origFile : null
	};
}

/** Most stash entries one `status` answer carries (the panel previews three). */
const STASH_LIST_MAX = 50;

/**
 * Parse `git stash list --format=%gd%x00%gs` into `{ ref, subject }` rows.
 * Records whose ref is not the exact `stash@{N}` shape are dropped: the browser
 * only ever sends one of these back to `stashPop`, so nothing else may leak in.
 * @param stdout - git's stdout.
 */
function parseStashList(stdout) {
	const stashes = [];
	for (const line of String(stdout ?? "").split(/\r?\n/)) {
		if (line === "") continue;
		const parts = line.split("\0");
		const ref = parts[0] ?? "";
		if (!STASH_REF.test(ref)) continue;
		stashes.push({ ref, subject: parts[1] ?? "" });
		if (stashes.length >= STASH_LIST_MAX) break;
	}
	return stashes;
}

/**
 * `status` endpoint: repo facts + uncommitted file list for one directory.
 *
 * `generate` tells the panel whether the optional AI drafting is usable. It
 * rides on the read the panel already performs on every refresh, so a missing
 * `llm` costs no extra round trip and the draft button can be disabled with a
 * reason instead of failing after the click.
 *
 * `stashes` (ref + subject) rides along for the same reason: the stash card must
 * also notice a stash created in a terminal, and a second round trip per poll
 * would be paid for nothing on every workspace. `git stash list` only walks the
 * stash reflog, so it is cheap even on a large repository.
 * @param rawCwd - session workspace directory.
 * @param signal - transport cancellation.
 * @param canGenerate - whether the host provides the `llm` service.
 */
async function gitStatus(rawCwd, signal, canGenerate = false) {
	const generate = canGenerate === true;
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	let out;
	let stashOut = null;
	try {
		[out, stashOut] = await Promise.all([
			runGit(rawCwd, ["status", "--porcelain=v2", "--branch"], signal),
			// A missing stash is not a failure: an empty list and a broken read
			// answer the same way (the status read above is what decides whether
			// this directory is a repository at all).
			runGit(rawCwd, ["stash", "list", "--format=%gd%x00%gs"], signal).catch(() => null)
		]);
	} catch (error) {
		if (isNotARepo(error)) return ok({ repo: false, generate, stashes: [] });
		return gitError(error);
	}
	let branch = null;
	let detached = false;
	let oid = null;
	let upstream = null;
	let ahead = 0;
	let behind = 0;
	let dirty = 0;
	const changes = [];
	for (const line of out.stdout.split(/\r?\n/)) {
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			detached = head === "(detached)";
			if (!detached) branch = head;
		} else if (line.startsWith("# branch.oid ")) {
			oid = line.slice("# branch.oid ".length).trim();
		} else if (line.startsWith("# branch.upstream ")) {
			upstream = line.slice("# branch.upstream ".length).trim();
		} else if (line.startsWith("# branch.ab ")) {
			const match = /^# branch\.ab \+(\d+) -(\d+)/.exec(line);
			if (match !== null) {
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
		} else if (line.length > 0) {
			dirty += 1;
			const parts = line.split(" ");
			if (parts.length >= 2 && parts[0] !== "!") {
				if (parts[0] === "?") {
					// `? <path>` — untracked; git collapses an untracked directory
					// into its `dir/` entry, which the diff endpoint expands.
					changes.push(changeEntry("??", parts.slice(1).join(" ")));
				} else if (parts[0] === "1") {
					// `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`
					changes.push(changeEntry(parts[1], parts.slice(8).join(" ")));
				} else if (parts[0] === "2") {
					// `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>`
					// The last two fields are ONE space-separated token (a tab
					// separates them), which is why the score column at index 8 is
					// not the path.
					const pair = parts.slice(9).join(" ").split("\t");
					const path = pair[0] !== undefined ? pair[0] : "";
					const orig = pair[1] !== undefined && pair[1] !== "" ? pair[1] : null;
					changes.push(changeEntry(parts[1], orig !== null ? `${orig} → ${path}` : path, { file: path, origFile: orig }));
				} else if (parts[0] === "u") {
					// `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`
					const path = parts.slice(10).join(" ");
					changes.push(changeEntry(parts[1] !== undefined ? parts[1] : "uu", path, { file: path, status: "conflict" }));
				}
			}
		}
	}
	return ok({ repo: true, branch, detached, oid, upstream, ahead, behind, dirty, changes, generate, stashes: parseStashList(stashOut === null ? "" : stashOut.stdout) });
}

/**
 * `branches` endpoint: local and remote branch lists for one directory.
 * @param rawCwd - session workspace directory.
 * @param signal - transport cancellation.
 */
async function gitBranches(rawCwd, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	let heads;
	let remotes;
	try {
		[heads, remotes] = await Promise.all([
			runGit(rawCwd, [
				"for-each-ref",
				"--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)",
				"refs/heads"
			], signal),
			runGit(rawCwd, ["for-each-ref", "--format=%(refname:short)%00%(symref)", "refs/remotes"], signal)
		]);
	} catch (error) {
		if (isNotARepo(error)) return ok({ repo: false, current: null, local: [], remote: [] });
		return gitError(error);
	}
	const local = heads.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
		const parts = line.split("\0");
		return {
			name: parts[0],
			current: parts[1] === "*",
			upstream: parts[2] !== undefined && parts[2] !== "" ? parts[2] : null,
			sha: parts[3] !== undefined && parts[3] !== "" ? parts[3] : null
		};
	});
	// `refname:short` for a remote-tracking ref is already `<remote>/<branch…>`
	// (not `remotes/<remote>/<branch…>`), so the remote segment is the first
	// slash-separated component of the whole line.
	//
	// The `%(symref)` field is non-empty exactly on the per-remote HEAD symref
	// (`refs/remotes/origin/HEAD` → `refs/remotes/origin/main`). That entry is
	// not a branch a user can pick — switching to it detaches — so it is dropped
	// rather than listed as a bogus option.
	const remote = [];
	for (const line of remotes.stdout.split(/\r?\n/)) {
		if (line === "") continue;
		const parts = line.split("\0");
		const name = parts[0];
		if (parts[1] !== undefined && parts[1] !== "") continue;
		const slash = name.indexOf("/");
		if (slash <= 0 || slash === name.length - 1) continue;
		const remoteName = name.slice(0, slash);
		const branch = name.slice(slash + 1);
		// `name` is the full remote-tracking ref and is what the panel switches
		// to; `short` is the local branch name a tracking switch would create.
		remote.push({ remote: remoteName, branch, name, short: branch });
	}
	const current = local.find((entry) => entry.current)?.name ?? null;
	return ok({ repo: true, current, local, remote });
}

/**
 * Whether an exact ref exists — no prefix or DWIM matching.
 *
 * Deliberately not `show-ref --verify`: for a ref that is missing *and* too
 * short to be a valid ref (`refs/remotes/main`) that command exits **128**, not
 * 1, so its "missing" answer is indistinguishable from a real git failure and
 * would turn an ordinary local switch into `git-error`. `for-each-ref` exits 0
 * either way, and its prefix matching is neutralised by comparing whole lines.
 *
 * @param cwd - repository directory.
 * @param ref - full ref name (`refs/remotes/origin/main`).
 * @param signal - transport cancellation.
 */
async function refExists(cwd, ref, signal) {
	// `%(refname)` is emitted in full, so an exact comparison is enough: a
	// shorter pattern also reports its descendants (`refs/heads/feature` would
	// match `refs/heads/feature/x`), which must not count as this ref existing.
	const out = await runGit(cwd, ["for-each-ref", "--format=%(refname)", ref], signal);
	return out.stdout.split(/\r?\n/).some((line) => line === ref);
}

/**
 * The full upstream ref of one local branch, straight from git's own config.
 * @param cwd - repository directory.
 * @param name - local branch name (already validated).
 * @param signal - transport cancellation.
 * @returns `refs/remotes/<remote>/<branch…>`, or null when the branch does not
 *   exist or tracks nothing.
 */
async function branchUpstream(cwd, name, signal) {
	// The whole head list is read in one call and filtered here: `for-each-ref`
	// patterns match by prefix, so `refs/heads/main` would also pull in
	// `refs/heads/main/xyz` and the exact name still has to be compared.
	const out = await runGit(cwd, ["for-each-ref", "--format=%(refname:short)%00%(upstream)", "refs/heads"], signal);
	for (const line of out.stdout.split(/\r?\n/)) {
		if (line === "") continue;
		const parts = line.split("\0");
		if (parts[0] !== name) continue;
		return parts[1] !== undefined && parts[1] !== "" ? parts[1] : null;
	}
	return null;
}

/**
 * `checkout` endpoint: switch the repo at `cwd` to `branch`.
 *
 * Two shapes arrive here, and they need different git commands:
 *
 *   - a local branch name (`main`, `feature/x`) → `git switch --guess`, which
 *     keeps the historical DWIM behaviour;
 *   - a remote-tracking ref (`origin/main`, `upstream/feature/x`), which the
 *     panel now sends for remote picks — `git switch --guess origin/main` fails
 *     outright with "a branch is expected, got remote branch", so a tracking
 *     switch is issued instead and creates the same-named local branch.
 *
 * The second shape can collide: `--track` refuses to run when a local branch of
 * that name already exists ("a branch named 'main' already exists"), and the
 * only ways around it are detaching HEAD or clobbering the existing branch's
 * upstream. Neither is acceptable silently, so the colliding case fails with
 * `checkout-remote-conflict` — HEAD is left exactly where it was — and the
 * message points at 「新建分支」, which already accepts a remote ref as its base.
 *
 * @param rawCwd - session workspace directory.
 * @param rawBranch - local branch name or remote-tracking ref to switch to.
 * @param signal - transport cancellation.
 */
async function gitCheckout(rawCwd, rawBranch, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const branch = normalizeBranch(rawBranch);
	if (branch === null) return fail("invalid-branch", "invalid branch name");

	let args = ["switch", "--guess", branch];
	try {
		// Remote-tracking refs always have the shape `<remote>/<branch…>`, so a
		// slash-free name can never be one — no extra read for the common case.
		if (branch.indexOf("/") !== -1 && await refExists(rawCwd, `refs/remotes/${branch}`, signal)) {
			// The panel sends a bare local name for local picks, so a local branch
			// that is itself named like a remote-tracking ref (`origin/main`) arrives
			// exactly like the remote ref does. git resolves such a name to the local
			// branch, and `--track` could not create it anyway, so the exact local
			// branch wins — otherwise that branch would become unreachable.
			if (await refExists(rawCwd, `refs/heads/${branch}`, signal)) {
				args = ["switch", "--guess", branch];
			} else {
				// `--track` names the new local branch after the remote-tracking ref's
				// branch part, so that is the name a collision would involve.
				const local = branch.slice(branch.indexOf("/") + 1);
				const upstream = await branchUpstream(rawCwd, local, signal);
				if (upstream === null && !(await refExists(rawCwd, `refs/heads/${local}`, signal))) {
					args = ["switch", "--track", branch];
				} else if (upstream === `refs/remotes/${branch}`) {
					// Already the local branch that tracks this very ref: a plain switch
					// keeps the tracking configuration intact.
					args = ["switch", local];
				} else {
					const tracks = upstream === null ? `本地分支 ${local} 未跟踪任何远端` : `本地分支 ${local} 跟踪的是 ${upstream.replace(/^refs\/remotes\//, "")}`;
					return fail(
						"checkout-remote-conflict",
						`${tracks}，无法再把它关联到 ${branch} 上（git 不允许两个分支同名）。HEAD 未改动；` +
							`请用「新建分支」以 ${branch} 为起点另建一个名字不同的分支。`,
						{ branch, local, upstream }
					);
				}
			}
		}
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		// A failed pre-flight read (timeout, cancellation, …) is reported as-is;
		// it must not be mistaken for a switch failure.
		return gitError(error);
	}

	let out;
	try {
		out = await runGit(rawCwd, args, signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		const detail = cleanMessage(error);
		// The common refusal: local changes would be overwritten by the switch.
		// Keep git's own words but add context so the panel message is readable.
		if (/local changes to the following files would be overwritten|your local changes would be overwritten/i.test(detail)) {
			return fail("checkout-failed", "本地有未提交的修改会被切换覆盖，git 已拒绝：" + detail, {});
		}
		// A tracking switch can still lose the race against another writer, or hit
		// a name that exists only as a tag/ref we never listed: keep git's words
		// and flag the collision so the panel can say what to do about it.
		if (/a branch named .* already exists/i.test(detail)) {
			// Name the colliding local branch too: the panel localizes this code and
			// needs `local` to word the "use New branch" advice (see checkoutResult).
			const slash = branch.indexOf("/");
			const local = slash === -1 ? branch : branch.slice(slash + 1);
			let upstream = null;
			try {
				upstream = await branchUpstream(rawCwd, local, signal);
			} catch {
				upstream = null;
			}
			return fail("checkout-remote-conflict", `无法切换到 ${branch}：` + detail, { branch, local, upstream });
		}
		return fail("checkout-failed", detail, {});
	}
	const status = await gitStatus(rawCwd, signal);
	if (status.ok === true && status.value.repo === true) {
		return ok({
			branch: status.value.branch,
			detached: status.value.detached,
			oid: status.value.oid,
			message: out.stderr.trim() !== "" ? out.stderr.trim().slice(0, 500) : null
		});
	}
	// The switch succeeded but the follow-up status read failed: report the local
	// branch a tracking switch just created, not the remote ref the caller sent.
	const slash = branch.indexOf("/");
	const localBranch = slash === -1 ? branch : branch.slice(slash + 1);
	return ok({ branch: localBranch, detached: false, oid: null, message: out.stderr.trim() !== "" ? out.stderr.trim().slice(0, 500) : null });
}

/**
 * `createBranch` endpoint: create a new branch from a base branch and switch
 * to it (IDE "new branch from…" semantics). The base may be a local branch
 * name or a remote-tracking ref (e.g. `origin/feature/x`); an omitted base
 * means HEAD (the current state).
 * @param rawCwd - session workspace directory.
 * @param rawBranch - new branch name (validated; `HEAD` is rejected).
 * @param rawBase - base branch/ref, or undefined/null for HEAD.
 * @param signal - transport cancellation.
 */
async function gitCreateBranch(rawCwd, rawBranch, rawBase, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const branch = normalizeBranch(rawBranch);
	if (branch === null || branch.toLowerCase() === "head") return fail("invalid-branch", "invalid branch name");
	const base = rawBase === undefined || rawBase === null ? "HEAD" : normalizeBranch(rawBase);
	if (base === null) return fail("invalid-branch", "invalid base branch");
	let out;
	try {
		out = await runGit(rawCwd, ["switch", "--create", branch, base], signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("create-branch-failed", cleanMessage(error), {});
	}
	const status = await gitStatus(rawCwd, signal);
	if (status.ok === true && status.value.repo === true) {
		return ok({
			branch: status.value.branch,
			detached: status.value.detached,
			oid: status.value.oid,
			message: out.stderr.trim() !== "" ? out.stderr.trim().slice(0, 500) : null
		});
	}
	return ok({ branch, detached: false, oid: null, message: out.stderr.trim() !== "" ? out.stderr.trim().slice(0, 500) : null });
}

/**
 * `fetch` endpoint: download remote refs.
 *
 * It takes no remote argument. The endpoint once accepted one that no caller
 * ever sent — the panel's fetch button has no remote picker — so the contract
 * advertised a knob with no surface and its validator was dead code. A plain
 * `git fetch` honours `branch.<name>.remote` the way the user's own git does.
 * @param rawCwd - session workspace directory.
 * @param signal - transport cancellation.
 */
async function gitFetch(rawCwd, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const args = ["fetch"];
	let out;
	try {
		out = await runGit(rawCwd, args, signal, GIT_NET_TIMEOUT_MS);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("fetch-failed", cleanMessage(error), {});
	}
	const detail = [out.stdout, out.stderr].join("\n").trim();
	return ok({ message: detail.slice(0, 800) });
}

/**
 * `pull` endpoint: fast-forward-only pull of the current branch's upstream.
 * Never merges implicitly; a non-fast-forward or dirty-tree case surfaces as
 * an error the user resolves in their own tooling.
 * @param rawCwd - session workspace directory.
 * @param signal - transport cancellation.
 */
async function gitPull(rawCwd, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	let out;
	try {
		out = await runGit(rawCwd, ["pull", "--ff-only"], signal, GIT_NET_TIMEOUT_MS);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("pull-failed", cleanMessage(error), {});
	}
	const detail = [out.stdout, out.stderr].join("\n").trim();
	return ok({ message: detail.slice(0, 800) });
}

/** Read the repo's configured author (user.name / user.email) or null. */
async function readAuthor(cwd) {
	const read = async (key) => {
		try {
			const out = await runGit(cwd, ["config", key]);
			return out.stdout.trim();
		} catch {
			return "";
		}
	};
	const [name, email] = await Promise.all([read("user.name"), read("user.email")]);
	return name !== "" || email !== "" ? { name, email } : null;
}

/**
 * `commit` endpoint: commit staged + message (no implicit add — the user
 * stages explicitly with `git add` in their own tooling; we commit what is
 * staged). Checks author config up front with a clear error.
 *
 * The message reaches git on **stdin** through `--file=-`, never as an
 * `--message=<msg>` argument: a subject-plus-body message contains spaces and
 * line feeds, and Windows argument quoting is exactly where such a message
 * would be mangled or truncated. `--cleanup=whitespace` is pinned explicitly so
 * a user's `commit.cleanup=verbatim` (or `scissors`) configuration cannot
 * truncate or reshape the message behind the panel's back.
 *
 * @param rawCwd - session workspace directory.
 * @param rawMessage - commit message (normalized and validated).
 * @param signal - transport cancellation.
 * @param amend - true rewrites HEAD (`git commit --amend`) through the same
 *   message path; the caller supplies the message, so the panel can pre-fill the
 *   previous one and let the user edit it.
 */
async function gitCommit(rawCwd, rawMessage, signal, amend = false) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const message = normalizeCommitMessage(rawMessage);
	if (message === null) {
		return fail("invalid-message", "a commit message is required (non-empty, at most " + MESSAGE_MAX + " characters, and free of control characters)");
	}
	const rewriting = amend === true;
	if (rewriting) {
		// `--amend` on an unborn branch has nothing to rewrite: answer a stable
		// code instead of letting git's "no commits yet" text reach the panel.
		try {
			await runGit(rawCwd, ["rev-parse", "--verify", "HEAD"], signal);
		} catch (error) {
			if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
			return fail("no-commit", "the repository has no commit to amend yet", {});
		}
	}
	const author = await readAuthor(rawCwd);
	if (author === null) {
		return fail("missing-author", "git user.name / user.email are not configured; set them first (e.g. `git config --global user.name \"you\"` and `git config --global user.email you@example.com`)", {});
	}
	const args = ["commit"];
	if (rewriting) args.push("--amend");
	args.push("--cleanup=whitespace", "--file=-");
	let out;
	try {
		out = await runGit(rawCwd, args, signal, GIT_TIMEOUT_MS, `${message}\n`);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("commit-failed", cleanMessage(error), {});
	}
	const summary = out.stdout.trim() !== "" ? out.stdout.trim().slice(0, 500) : out.stderr.trim().slice(0, 500);
	return ok({ message: summary });
}

/**
 * Whether the current branch resolves to a tracking upstream.
 *
 * `git rev-parse @{upstream}` fails both when no upstream is configured and
 * when the remote-tracking ref it names is gone (e.g. the remote branch was
 * deleted and pruned); either state needs the push to set the tracking up
 * again, so both answer `false`.
 *
 * @param cwd - repository working directory.
 * @param signal - transport cancellation.
 */
async function hasTrackingUpstream(cwd, signal) {
	try {
		const out = await runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], signal);
		return out.stdout.trim() !== "";
	} catch {
		return false;
	}
}

/** The repository's `remote.pushDefault`, or null when it does not set one. */
async function readPushDefault(cwd, signal) {
	try {
		return (await runGit(cwd, ["config", "--get", "remote.pushDefault"], signal)).stdout.trim() || null;
	} catch {
		return null;
	}
}

/**
 * The configured remote names, or a `fail` result when even that cannot be read.
 * @param cwd - repository working directory.
 * @param signal - transport cancellation.
 * @returns a `string[]`, or an RPC failure result.
 */
async function readRemotes(cwd, signal) {
	try {
		const out = await runGit(cwd, ["remote"], signal);
		// Remote names come from git itself, so Unicode is allowed; only an
		// empty or option-looking name would be unusable as a positional argument.
		return out.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("-"));
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return gitError(error);
	}
}

/**
 * Decide the git arguments for one push.
 *
 * This is the whole policy, kept pure so the git-free gate can assert it
 * without spawning git:
 *
 *   - a branch that tracks an upstream → plain `git push`, so `push.default`
 *     keeps its normal meaning;
 *   - a branch with no upstream (every just-created branch) → `git push
 *     --set-upstream <remote> <branch>`. This is exactly what git's own error
 *     message recommends, it creates the remote branch, and git records
 *     `branch.<name>.remote` / `.merge` — the plugin still never writes config.
 *     The remote is chosen in `git push`'s order: `remote.pushDefault`, then
 *     `origin`, then the only configured remote;
 *   - several remotes and none of those named → refuse (`no-remote`) instead
 *     of guessing: pushing a branch into the wrong project is worse than an
 *     actionable message;
 *   - no remotes at all → `no-remote`; a detached HEAD → `detached-head`.
 *
 * @param input.branch - current branch name (already normalized), or null.
 * @param input.hasUpstream - whether the branch already tracks an upstream.
 * @param input.remotes - configured remote names.
 * @param input.pushDefault - the repository's `remote.pushDefault`, or null.
 * @returns `{ args, remote? }` for git, or `{ code, message, details? }` for a
 *   refusal. `remote` is the remote the plan itself chose (only when it had to
 *   name one); a plain `git push` leaves it to git's own configuration.
 */
function pushPlan(input) {
	const branch = input.branch;
	if (typeof branch !== "string" || branch === "") {
		return { code: "detached-head", message: "HEAD is not on a branch, so there is no upstream to push to" };
	}
	if (input.hasUpstream === true) return { args: ["push"] };
	const remotes = Array.isArray(input.remotes) ? input.remotes.filter((one) => typeof one === "string" && one !== "") : [];
	if (remotes.length === 0) {
		return { code: "no-remote", message: "no git remote is configured, so there is nothing to push to" };
	}
	for (const candidate of [input.pushDefault, "origin", remotes.length === 1 ? remotes[0] : null]) {
		if (typeof candidate === "string" && candidate !== "" && !candidate.startsWith("-") && remotes.includes(candidate)) {
			return { args: ["push", "--set-upstream", candidate, branch], remote: candidate };
		}
	}
	return {
		code: "no-remote",
		message: `several git remotes are configured (${remotes.join(", ")}) and none is named "origin"; add a remote named origin or push from your own terminal`,
		details: { remotes }
	};
}

/**
 * The remote a tracking branch pushes to (`branch.<name>.remote`), or null.
 * `.` names the local repository itself and is treated as no usable remote.
 * @param cwd - repository working directory.
 * @param branch - current branch name (from git, not caller input).
 * @param signal - transport cancellation.
 */
async function readBranchRemote(cwd, branch, signal) {
	try {
		const out = await runGit(cwd, ["config", "--get", `branch.${branch}.remote`], signal);
		const name = out.stdout.trim();
		return name === "" || name === "." ? null : name;
	} catch {
		return null;
	}
}

/**
 * The remote branch a tracking branch merges (`branch.<name>.merge`), or null.
 * The push publishes THIS name on the remote; it is usually the local branch
 * name, but `branch.<name>.merge` may point somewhere else.
 * @param cwd - repository working directory.
 * @param branch - current branch name (from git, not caller input).
 * @param signal - transport cancellation.
 */
async function readBranchMerge(cwd, branch, signal) {
	try {
		const out = await runGit(cwd, ["config", "--get", `branch.${branch}.merge`], signal);
		const ref = out.stdout.trim();
		if (ref === "") return null;
		return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
	} catch {
		return null;
	}
}

/**
 * The URL `git push` would use for one remote, or null.
 *
 * `--push` is asked first because a remote may carry a separate `pushurl`; a
 * git older than 2.7 answers that option with an error and the fetch URL is
 * used instead. The URL is returned verbatim: only a forge provider can tell
 * whether it names a repository (a local path simply makes the discovery a
 * no-op).
 * @param cwd - repository working directory.
 * @param remote - remote name (from git's own config or remote list).
 * @param signal - transport cancellation.
 */
async function readRemotePushUrl(cwd, remote, signal) {
	try {
		const out = await runGit(cwd, ["remote", "get-url", "--push", remote], signal);
		const url = out.stdout.trim();
		if (url !== "") return url;
	} catch {
		// Fall through to the fetch URL.
	}
	try {
		const out = await runGit(cwd, ["remote", "get-url", remote], signal);
		const url = out.stdout.trim();
		return url === "" ? null : url;
	} catch {
		return null;
	}
}

/**
 * Ask the optional dsh 0.2.2 forge-session service to discover open change
 * requests for the branch this push just published.
 *
 * Forge-session's projection only reads `git push` / `gh pr` output from
 * `tool/call` + `tool/result` events of the `bash`/`pwsh` tools
 * (`dsh-experimental-forge-session`'s `SHELL_TOOLS`). A panel push goes through
 * this plugin's own RPC route instead, so without this call the official Forge
 * panel would never learn about the branch. `forgeSession.discoverBranch(...)`
 * is that service's public "as after a push of that branch" entry: it looks up
 * open change requests whose head is the branch and records the unbound ones as
 * `discovered`.
 *
 * Best-effort on purpose. Every condition below (no session id, no
 * forge-session service, no sessions service, unknown session, another
 * workspace, a remote no provider can parse) only skips the discovery: a push
 * must never fail or slow down because an optional host capability is missing.
 * The lookup is fire-and-forget, so the RPC answer is not held for the forge's
 * network round trip.
 * @param ctx - plugin context.
 * @param rawSessionId - caller's Session id, when the panel has one.
 * @param cwd - the workspace the push ran in.
 * @param remoteUrl - URL of the remote the branch was pushed to.
 * @param branch - the remote branch name that was published.
 */
function notifyForgeDiscovery(ctx, rawSessionId, cwd, remoteUrl, branch) {
	if (typeof rawSessionId !== "string" || rawSessionId === "" || rawSessionId.length > SESSION_ID_MAX_CHARS) return;
	const forgeSession = optionalService(ctx, "forgeSession");
	const sessions = optionalService(ctx, "sessions");
	if (forgeSession === undefined || sessions === undefined) return;
	if (typeof forgeSession.discoverBranch !== "function" || typeof sessions.get !== "function") return;
	let session;
	try {
		session = sessions.get(rawSessionId);
	} catch {
		return;
	}
	if (session === undefined || session === null) return;
	// Only the Session that owns this workspace may receive the binding, so a
	// stale panel (or a caller that passes someone else's id) cannot attach a
	// change request to the wrong conversation.
	const header = session.header;
	const sessionCwd = header !== null && typeof header === "object" ? header.cwd : undefined;
	if (typeof sessionCwd !== "string" || sessionCwd !== cwd) return;
	try {
		const task = forgeSession.discoverBranch(session, remoteUrl, branch);
		// Fire and forget: the request signal must NOT be passed on (the RPC
		// response ends long before the lookup does), and a discovery failure is
		// the forge's business, never the push's.
		if (task !== null && typeof task === "object" && typeof task.catch === "function") task.catch(() => {});
	} catch {
		// A missing or failing forge service must not affect the push.
	}
}

/**
 * `push` endpoint: push the current branch to its upstream.
 *
 * A branch created a moment ago has no upstream, and a bare `git push` refuses
 * outright in that state ("the current branch … has no upstream branch") — the
 * failure the panel used to surface right after a new branch was created. When
 * no tracking upstream exists the endpoint therefore does what git itself
 * recommends: `git push --set-upstream <remote> <branch>` (see `pushPlan`).
 *
 * After a successful push it also asks the optional forge-session service to
 * discover open change requests for the pushed branch (see
 * {@link notifyForgeDiscovery}); that capability is absent on older hosts and
 * the push behaves exactly as before there.
 *
 * @param ctx - plugin context (reads optional `forgeSession`/`sessions`; neither
 *   is required, and neither enters `inject`).
 * @param rawCwd - session workspace directory.
 * @param rawSessionId - caller's Session id, when the panel has one.
 * @param signal - transport cancellation.
 */
async function gitPush(ctx, rawCwd, rawSessionId, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	let branch = null;
	try {
		const head = await runGit(rawCwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal);
		// `symbolic-ref` prints the branch's real name, not caller input: it may
		// hold Unicode (a Chinese branch name is ordinary here), so only an empty
		// or option-looking name is unusable as a positional argument.
		const name = head.stdout.trim();
		branch = name !== "" && !name.startsWith("-") ? name : null;
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		// Detached HEAD: `symbolic-ref` exits non-zero, and `pushPlan` words it.
	}
	const hasUpstream = branch !== null && await hasTrackingUpstream(rawCwd, signal);
	let remotes = [];
	let pushDefault = null;
	if (branch !== null && !hasUpstream) {
		remotes = await readRemotes(rawCwd, signal);
		if (!Array.isArray(remotes)) return remotes;
		pushDefault = await readPushDefault(rawCwd, signal);
	}
	const plan = pushPlan({ branch, hasUpstream, remotes, pushDefault });
	if (plan.args === undefined) return fail(plan.code, plan.message, plan.details ?? {});
	let out;
	try {
		out = await runGit(rawCwd, plan.args, signal, GIT_NET_TIMEOUT_MS);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("push-failed", cleanMessage(error), {});
	}
	const detail = [out.stdout, out.stderr].join("\n").trim();
	// Best-effort: tell the optional forge-session service about the branch this
	// push published, so the Forge panel discovers its open change request even
	// though the push did not run as a shell tool call. Every step here is a
	// local config/remote read; none of it may change the push result, and a
	// failure is swallowed on purpose.
	try {
		const remoteName = hasUpstream ? await readBranchRemote(rawCwd, branch, signal) : (plan.remote ?? null);
		const remoteBranch = hasUpstream ? (await readBranchMerge(rawCwd, branch, signal)) ?? branch : branch;
		if (branch !== null && remoteName !== null && remoteBranch !== null) {
			const remoteUrl = await readRemotePushUrl(rawCwd, remoteName, signal);
			if (remoteUrl !== null) notifyForgeDiscovery(ctx, rawSessionId, rawCwd, remoteUrl, remoteBranch);
		}
	} catch {
		// Discovery is optional: a failed read must not turn a successful push into an error.
	}
	return ok({ message: detail.slice(0, 800) });
}

/**
 * `log` endpoint: recent commit summary lines (default 10).
 * @param rawCwd - session workspace directory.
 * @param rawCount - number of commits to list (clamped 1..50).
 * @param signal - transport cancellation.
 */
async function gitLog(rawCwd, rawCount, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const count = Number.isInteger(rawCount) ? Math.min(50, Math.max(1, rawCount)) : 10;
	let out;
	try {
		out = await runGit(rawCwd, ["log", `--max-count=${count}`, "--format=%h%x00%an%x00%s%x00%D"], signal);
	} catch (error) {
		if (isNotARepo(error)) return ok({ repo: false, commits: [] });
		return gitError(error);
	}
	const commits = out.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
		const [shortSha, author, subject, refs] = line.split("\0");
		return {
			sha: shortSha ?? "",
			author: author ?? "",
			subject: subject ?? "",
			refs: refs !== undefined && refs !== "" ? refs : null
		};
	});
	return ok({ repo: true, commits });
}

/**
 * Extract the endpoint from a request pathname (`/dsh-git-rpc/<endpoint>`).
 * Returns undefined when the path is outside the channel or a segment is not a
 * plain single segment (empty, `.`, `..`, or outside the client's own
 * segment pattern).
 * @param pathname - URL pathname of the request.
 */
function endpointFromPath(pathname) {
	if (typeof pathname !== "string" || !pathname.startsWith(`${RPC_CHANNEL}/`)) return undefined;
	const query = pathname.indexOf("?");
	const endpoint = pathname.slice(RPC_CHANNEL.length + 1, query === -1 ? undefined : query);
	if (endpoint === "") return undefined;
	for (const segment of endpoint.split("/")) {
		if (segment === "" || segment === "." || segment === ".." || !RPC_SEGMENT.test(segment)) return undefined;
	}
	return endpoint;
}

/**
 * Read a request body with a hard byte cap.
 * Deliberately uses the classic data/end/error events rather than async
 * iteration: the host's own bridge does `for await (const chunk of req)`, and
 * keeping this reader on the event API means one dependency fewer on an
 * IncomingMessage behaviour this plugin cannot pin.
 * @param req - node:http request.
 * @param maxBytes - cap; exceeding it resolves to undefined.
 * @returns the utf8 body, or undefined on overrun/error/abort.
 */
function readBoundedBody(req, maxBytes) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};
		function onData(chunk) {
			size += chunk.length;
			if (size > maxBytes) {
				try { req.resume(); } catch { /* the socket is already gone */ }
				finish(undefined);
				return;
			}
			chunks.push(chunk);
		}
		function onEnd() { finish(Buffer.concat(chunks, size).toString("utf8")); }
		function onError() { finish(undefined); }
		function onAborted() { finish(undefined); }
		function cleanup() {
			try {
				req.removeListener("data", onData);
				req.removeListener("end", onEnd);
				req.removeListener("error", onError);
				req.removeListener("aborted", onAborted);
			} catch { /* listeners already removed */ }
		}
		req.on("data", onData);
		req.on("end", onEnd);
		req.on("error", onError);
		req.on("aborted", onAborted);
	});
}

/** Write one JSON envelope (never throws into the request handler). */
function sendEnvelope(res, status, payload) {
	try {
		if (res.writableEnded === true) return;
		res.statusCode = status;
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.setHeader("cache-control", "no-store");
		res.end(JSON.stringify(payload));
	} catch {
		try { res.end(); } catch { /* response already finished */ }
	}
}

/** A server-response envelope with a result (the browser's `connection.rpc.call` reply). */
function rpcFull(rpcId, result) {
	return { type: "server-response", rpcId, result };
}

/** A server-response envelope carrying a failure result. */
function rpcError(rpcId, code, message, details) {
	return rpcFull(rpcId, { ok: false, error: { code, message, details } });
}

/**
 * `stash` endpoint: put the tracked working-tree changes aside
 * (`git stash push --message <msg>`).
 *
 * A missing message means "let git write its own `WIP on <branch>` line"
 * (no `--message` at all); the panel always sends one. Untracked files are
 * deliberately NOT included unless the caller asks for them: that is git's own
 * default, and silently sweeping a user's new files into a stash is exactly the
 * surprise this action must not spring.
 *
 * `git stash push` treats "nothing to stash" as a SUCCESS with a stdout notice,
 * so it is detected here and reported with a stable code instead of pretending
 * something was saved.
 * @param rawCwd - session workspace directory.
 * @param rawMessage - optional one-line stash message.
 * @param rawIncludeUntracked - true adds `--include-untracked`.
 * @param signal - transport cancellation.
 */
async function gitStash(rawCwd, rawMessage, rawIncludeUntracked, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const message = normalizeStashMessage(rawMessage);
	if (message === null) {
		return fail("invalid-message", "a stash message must be a single line of at most " + STASH_MESSAGE_MAX + " characters and free of control characters");
	}
	const args = ["stash", "push"];
	if (message !== "") args.push("--message", message);
	if (rawIncludeUntracked === true) args.push("--include-untracked");
	let out;
	try {
		out = await runGit(rawCwd, args, signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("stash-failed", cleanMessage(error), {});
	}
	const text = [out.stdout, out.stderr].join("\n").trim();
	if (/no local changes to save/i.test(text)) return fail("no-changes", "no local changes to save", {});
	return ok({ message: text.slice(0, 800) });
}

/**
 * `stashPop` endpoint: restore one stash entry and let git drop it.
 *
 * The ref is restricted to the exact `stash@{N}` shape the status list produced:
 * `git stash pop` accepts arbitrary revisions, and a plugin must not turn a
 * typed-looking argument into "pop that commit".
 *
 * On a conflict git applies what it can, leaves the conflicted files in the
 * working tree, and KEEPS the stash entry ("The stash entry is kept in case you
 * need it again.") — that behaviour is relied on here and surfaced as
 * `stash-conflict`, never as "restored".
 * @param rawCwd - session workspace directory.
 * @param rawRef - `stash@{N}` from `status.stashes`.
 * @param signal - transport cancellation.
 */
async function gitStashPop(rawCwd, rawRef, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const ref = normalizeStashRef(rawRef);
	if (ref === null) return fail("invalid-ref", "a stash reference like stash@{0} is required", {});
	let out;
	try {
		out = await runGit(rawCwd, ["stash", "pop", ref], signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		const text = String(error.stderr ?? error.message ?? "");
		if (/no stash entries found|is not a valid reference/i.test(text)) return fail("stash-missing", cleanMessage(error), {});
		if (/CONFLICT/i.test(text) || /CONFLICT/i.test(String(error.stdout ?? ""))) {
			return fail("stash-conflict", cleanMessage(error), { ref });
		}
		// git refuses to replay a stash when the working tree would be overwritten
		// and aborts BEFORE touching anything (the entry is kept). That is a
		// different answer from a failed pop: the user has to deal with the
		// uncommitted changes first, so it gets its own code and wording.
		if (/would be overwritten|Aborting/i.test(text)) return fail("stash-blocked", cleanMessage(error), { ref });
		return fail("stash-pop-failed", cleanMessage(error), {});
	}
	const text = [out.stdout, out.stderr].join("\n").trim();
	return ok({ message: text.slice(0, 800) });
}

/**
 * `headMessage` endpoint: the current commit's message, for the amend flow.
 * The panel pre-fills its composer with this text so amending starts from the
 * message git actually recorded (which may have been written in a terminal).
 * @param rawCwd - session workspace directory.
 * @param signal - transport cancellation.
 */
async function gitHeadMessage(rawCwd, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	try {
		await runGit(rawCwd, ["rev-parse", "--verify", "HEAD"], signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("no-commit", "the repository has no commit to amend yet", {});
	}
	let out;
	try {
		out = await runGit(rawCwd, ["log", "-1", "--format=%B"], signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return gitError(error);
	}
	// `%B` ends with a newline and may use CRLF on a Windows checkout; the
	// composer wants the message as git would record it.
	return ok({ message: out.stdout.replace(/\r\n?/g, "\n").replace(/\n+$/, "") });
}

/** Read the porcelain-v2 records for one pathspec set (NUL separated, unquoted). */
async function discardRecords(cwd, paths, signal) {
	const out = await runGit(cwd, ["status", "--porcelain=v2", "-z", "--"].concat(paths), signal);
	return String(out.stdout ?? "").split("\0").filter((record) => record !== "");
}

/**
 * `discard` endpoint: drop ONE path's uncommitted changes.
 *
 * The host reads that path's own porcelain-v2 record instead of trusting the
 * browser's idea of its state, because the two ways of throwing work away are
 * not interchangeable and one of them is dangerous to get wrong:
 *
 *   - a conflicted path (`u`) is REFUSED — discarding a merge state destroys the
 *     user's conflict resolution work and belongs in a terminal;
 *   - an untracked path (`?`) is removed with `git clean -f -d` (no `-x`, so
 *     ignored files stay), which is also how an untracked directory is dropped;
 *   - a staged addition (XY starts with `A`) has no HEAD version to restore to:
 *     it is unstaged first and the leftover file removed by the same clean;
 *   - everything else goes through `git restore --staged --worktree -- <paths>`,
 *     restoring both the index and the working tree from HEAD.
 *
 * `origPath` travels with a rename so the old side is restored too. Nothing
 * here runs before the confirmation the panel already collected; this endpoint
 * is deliberately the only one in the plugin that deletes working-tree data.
 * @param rawCwd - session workspace directory.
 * @param rawPath - the change's `file` pathspec.
 * @param rawOrigPath - the rename's `origFile`, when it has one.
 * @param signal - transport cancellation.
 */
async function gitDiscard(rawCwd, rawPath, rawOrigPath, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const file = normalizedPath(rawPath);
	if (file === null) return fail("invalid-path", "path must be a repository-relative path", {});
	let orig = null;
	if (rawOrigPath !== undefined && rawOrigPath !== null) {
		orig = normalizedPath(rawOrigPath);
		if (orig === null) return fail("invalid-path", "original path must be a repository-relative path", {});
	}
	const paths = orig !== null && orig !== file ? [file, orig] : [file];
	let records;
	try {
		records = await discardRecords(rawCwd, paths, signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("discard-failed", cleanMessage(error), {});
	}
	if (records.length === 0) return fail("no-changes", "the selected path has no changes to discard", {});
	const kinds = records.map((record) => recordKind(record));
	if (kinds.includes("conflict")) {
		return fail("discard-conflict", "a conflicted path must be resolved in a terminal first", { path: file });
	}
	const onlyUntracked = kinds.every((kind) => kind === "untracked");
	const added = kinds.includes("added");
	let detail = "";
	try {
		if (!onlyUntracked) {
			if (added) {
				const unstage = await runGit(rawCwd, ["restore", "--staged", "--"].concat(paths), signal);
				detail = [unstage.stdout, unstage.stderr].join("\n").trim();
			} else {
				const restore = await runGit(rawCwd, ["restore", "--staged", "--worktree", "--"].concat(paths), signal);
				detail = [restore.stdout, restore.stderr].join("\n").trim();
			}
		}
		// Whatever is left as untracked (the file behind a staged addition, or the
		// target of a rename) is the residue this action promised to remove.
		const after = await discardRecords(rawCwd, paths, signal);
		if (after.some((record) => recordKind(record) === "untracked")) {
			const clean = await runGit(rawCwd, ["clean", "-f", "-d", "--"].concat(paths), signal);
			detail = [detail, [clean.stdout, clean.stderr].join("\n").trim()].filter(Boolean).join("\n");
		}
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("discard-failed", cleanMessage(error), {});
	}
	return ok({ message: detail.slice(0, 800) });
}

/**
 * `stage` endpoint: stage every working-tree change (`git add --all`), including
 * deletions and untracked files, so the following `commit` has something to
 * record. The commit path itself still never stages implicitly.
 * @param rawCwd - session workspace directory.
 * @param signal - transport cancellation.
 */
async function gitStage(rawCwd, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	let out;
	try {
		out = await runGit(rawCwd, ["add", "--all"], signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("stage-failed", cleanMessage(error), {});
	}
	const detail = [out.stdout, out.stderr].join("\n").trim();
	// `message` is git's own output and nothing else: an operation git says
	// nothing about reports an empty string, and the panel words its own summary.
	return ok({ message: detail.slice(0, 800) });
}

/**
 * Read one side of the working tree as `{ stat, diff }`.
 * `--no-ext-diff` keeps a configured external diff program out of the path:
 * this is a background read, and it must never open a GUI or block.
 * @param rawCwd - session workspace directory.
 * @param cached - true reads the index (staged), false the working tree (unstaged).
 * @param signal - transport cancellation.
 * @returns `{ repo, stat, diff }`; `repo: false` outside a work tree.
 */
async function readDiff(rawCwd, cached, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const scope = cached === true ? ["--cached"] : [];
	try {
		const [statOut, diffOut] = await Promise.all([
			runGit(rawCwd, ["diff", ...scope, "--stat", "--no-ext-diff"], signal),
			runGit(rawCwd, ["diff", ...scope, "--no-ext-diff"], signal)
		]);
		return ok({ repo: true, stat: statOut.stdout.trim(), diff: diffOut.stdout.trim() });
	} catch (error) {
		if (isNotARepo(error)) return ok({ repo: false, stat: "", diff: "" });
		return gitError(error);
	}
}

/** Per-side cap for one diff sent to the viewer (the panel renders a slice of it). */
const DIFF_MAX_CHARS = 400000;
/** Untracked files expanded for one directory selection; the rest are counted. */
const DIFF_MAX_UNTRACKED_FILES = 50;

/**
 * Bound one side of a diff at a line boundary, reporting the truncation rather
 * than silently dropping the tail. CRLF is normalized here because the browser
 * renders the text as lines.
 * @param text - raw git output.
 * @returns `{ diff, truncated }`.
 */
function clampDiffText(text) {
	const cleaned = String(text ?? "").replace(/\r\n/g, "\n");
	if (cleaned.length <= DIFF_MAX_CHARS) return { diff: cleaned, truncated: false };
	const cut = cleaned.lastIndexOf("\n", DIFF_MAX_CHARS);
	return { diff: cleaned.slice(0, cut === -1 ? DIFF_MAX_CHARS : cut), truncated: true };
}

/** Whether one side's text is git's placeholder for a binary difference. */
function isBinaryDiff(text) {
	return /^Binary files .* differ$/m.test(text) || /^GIT binary patch$/m.test(text);
}

/**
 * Read one side of the index for one pathspec, without a `--stat` pass: the
 * viewer computes its own `+N −M` counts from the hunks it renders, so a second
 * git invocation per side would only add latency.
 * @param rawCwd - session workspace directory.
 * @param paths - pathspec entries (a rename's old and new path both, so git can pair them).
 * @param cached - true reads the index (staged), false the working tree (unstaged).
 * @param signal - transport cancellation.
 * @returns git's stdout.
 */
async function readPathDiff(rawCwd, paths, cached, signal) {
	const scope = cached === true ? ["--cached"] : [];
	const out = await runGit(rawCwd, ["diff", ...scope, "--no-ext-diff", "--no-color", "--", ...paths], signal);
	return out.stdout;
}

/**
 * List the untracked files one pathspec names (an untracked directory is
 * reported by git as a single `dir/` entry, and this is how its files are found).
 * @param rawCwd - session workspace directory.
 * @param file - repository-relative pathspec.
 * @param signal - transport cancellation.
 * @returns the paths git reports, NUL-separated output split apart.
 */
async function untrackedFiles(rawCwd, file, signal) {
	const out = await runGit(rawCwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", file], signal);
	return out.stdout.split("\u0000").filter((entry) => entry !== "");
}

/**
 * Diff one untracked file against the empty blob.
 *
 * `git diff --no-index` has no index to compare with, so it is handed
 * `/dev/null` as the missing side (git itself resolves that path on Windows);
 * it reports "the sides differ" as exit 1, which `runGit` accepts for this call.
 * A run that failed for a real reason produced no diff header, so the fallback
 * keeps the error rather than reporting an empty file as unchanged.
 * @param rawCwd - session workspace directory.
 * @param file - repository-relative path of an untracked file.
 * @param signal - transport cancellation.
 * @returns the diff text.
 */
async function readUntrackedDiff(rawCwd, file, signal) {
	try {
		const out = await runGit(rawCwd, ["diff", "--no-index", "--no-ext-diff", "--no-color", "--", "/dev/null", file], signal, GIT_TIMEOUT_MS, undefined, [1]);
		return out.stdout;
	} catch (error) {
		const text = String(error.stdout ?? "");
		if (text.includes("diff --git")) return text;
		throw error;
	}
}

/**
 * `diff` endpoint: one changed path's unified diff, split by which side of the
 * index it lives on.
 *
 * Both sides are read in one round trip because the viewer shows them as two
 * tabs of the same page (the panel answers "what will the commit record?" from
 * the index side and "what is not staged yet?" from the worktree side). A path
 * that is untracked on both sides falls back to `--no-index` against the empty
 * blob; an untracked *directory* is expanded file by file, capped, with the
 * remainder counted so the viewer can say so instead of showing a partial tree
 * silently.
 *
 * Every command here is read-only: this endpoint never writes the index, the
 * working tree, or any git configuration.
 * @param rawCwd - session workspace directory.
 * @param rawPath - repository-relative path (from the status list).
 * @param rawOrigPath - the pre-rename path when the status record carries one.
 * @param signal - transport cancellation.
 */
async function gitFileDiff(rawCwd, rawPath, rawOrigPath, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const file = normalizedPath(rawPath);
	if (file === null) return fail("invalid-path", "a repository-relative path is required");
	let orig = null;
	if (rawOrigPath !== undefined && rawOrigPath !== null) {
		orig = normalizedPath(rawOrigPath);
		if (orig === null) return fail("invalid-path", "a repository-relative path is required");
	}
	// A rename is only pairable when both of its names are in the pathspec:
	// naming the new path alone makes git report the whole file as an addition.
	const paths = orig !== null && orig !== file ? [orig, file] : [file];
	try {
		let worktreeText = await readPathDiff(rawCwd, paths, false, signal);
		let indexText = await readPathDiff(rawCwd, paths, true, signal);
		let untracked = false;
		let skipped = 0;
		// Binary evidence is collected PER FILE, before any truncation. One blob
		// among the files of an expanded untracked directory used to flip the
		// whole side to "binary" (a single `isBinaryDiff` over the concatenated
		// text), which hid every text hunk of that directory; and judging after
		// `clampDiffText` could also cut git's `Binary files ... differ` line and
		// report a binary side as an ordinary (empty-looking) diff.
		const worktreeBinary = isBinaryDiff(worktreeText) ? [file] : [];
		const indexBinary = isBinaryDiff(indexText) ? [file] : [];
		if (orig === null && worktreeText.trim() === "" && indexText.trim() === "") {
			// Nothing on either side of the index. Either the path is untracked —
			// git has no base to diff against — or it is genuinely unchanged; the
			// question is settled by asking git which untracked files it knows.
			const files = await untrackedFiles(rawCwd, file, signal);
			if (files.length > 0) {
				untracked = true;
				const expanded = files.slice(0, DIFF_MAX_UNTRACKED_FILES);
				skipped = files.length - expanded.length;
				const parts = [];
				for (const one of expanded) {
					const text = await readUntrackedDiff(rawCwd, one, signal);
					if (text === "") continue;
					// A binary file's side is git's placeholder line, not a patch:
					// keep the name for the notice and leave the text side clean so
					// the text hunks of its neighbours still render.
					if (isBinaryDiff(text)) worktreeBinary.push(one);
					else parts.push(text);
				}
				worktreeText = parts.join("\n");
			}
		}
		const worktree = clampDiffText(worktreeText);
		const index = clampDiffText(indexText);
		/** A side with nothing but binary evidence has no text to render at all. */
		const binaryOnly = (text, binaryPaths) => isBinaryDiff(text) || (text.trim() === "" && binaryPaths.length > 0);
		return ok({
			repo: true,
			path: file,
			origPath: orig,
			untracked,
			skipped,
			worktree: { diff: worktree.diff, binary: binaryOnly(worktreeText, worktreeBinary), binaryPaths: worktreeBinary, truncated: worktree.truncated },
			index: { diff: index.diff, binary: binaryOnly(indexText, indexBinary), binaryPaths: indexBinary, truncated: index.truncated }
		});
	} catch (error) {
		if (isNotARepo(error)) return ok({ repo: false });
		return gitError(error);
	}
}


/** Bound one model-facing text block, marking the truncation. */
function clampForModel(text, max) {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n… (truncated at ${max} characters)`;
}

/**
 * Read the change set one generation mode describes.
 * @param rawCwd - session workspace directory.
 * @param mode - `staged`, `unstaged`, or `all`.
 * @param signal - transport cancellation.
 * @returns `{ stat, diff }` with `repo` false outside a work tree, or an RPC failure.
 */
async function readChangesForMode(rawCwd, mode, signal) {
	if (mode === "all") {
		// Combining the two sides is exact and works in a repository with no
		// commits yet, where `git diff HEAD` has no HEAD to name.
		const [staged, unstaged] = await Promise.all([
			readDiff(rawCwd, true, signal),
			readDiff(rawCwd, false, signal)
		]);
		if (staged.ok !== true) return staged;
		if (unstaged.ok !== true) return unstaged;
		return ok({
			repo: staged.value.repo === true || unstaged.value.repo === true,
			stat: [staged.value.stat, unstaged.value.stat].filter(Boolean).join("\n"),
			diff: [staged.value.diff, unstaged.value.diff].filter(Boolean).join("\n\n")
		});
	}
	return readDiff(rawCwd, mode === "staged", signal);
}

/**
 * Frame one commit-message request.
 *
 * Without `language` the model is told to match the codebase rather than to
 * prefer either of this panel's locales. With one, that rule is REPLACED by an
 * explicit override: the user asked for a fixed language, and "follow the
 * repository" is exactly the instruction a repository whose comments and past
 * commits are in another language would otherwise win against.
 *
 * @param stat - diffstat text (may be empty).
 * @param diff - unified diff text.
 * @param language - language NAME the message must be written in, from
 *   {@link readLanguage}; undefined follows the repository.
 */
function generationPrompt(stat, diff, language = undefined) {
	const system = [
		"You write one git commit message for the change set below.",
		"Rules:",
		"- Reply with the commit message only: no preamble, no quotes, no Markdown fences.",
		"- One imperative subject line under 72 characters; add a short body only when the change needs it.",
		"- Describe what changed and why, not how.",
		language === undefined
			? "- Write in the language already used by the codebase's comments and existing commit subjects."
			: `- Write the entire commit message — subject and body — in ${language}, and in no other language. The user chose this language explicitly, so it overrides the diff, the code comments and the existing commit subjects even when those are written in a different one. Do not translate the message back.`
	].join("\n");
	const body = [
		"## Diffstat",
		stat !== "" ? stat : "(unavailable)",
		"",
		"## Diff",
		diff !== "" ? diff : "(empty)"
	].join("\n");
	return { system, body };
}

/**
 * Resolve the provider/model route for one generation call.
 * The caller names its session's route; anything unconfirmed is checked against
 * the adapters' advertised catalog before use.
 * @param ctx - context exposing the `llm` service.
 * @param rawProvider - caller-supplied provider route (optional).
 * @param rawModel - caller-supplied model id (optional).
 * @returns `{ provider, model }`.
 * @throws when no usable route exists.
 */
async function resolveLlmRoute(ctx, rawProvider, rawModel) {
	const providers = ctx.llm.listProviders();
	if (!Array.isArray(providers) || providers.length === 0) {
		throw Object.assign(new Error("no LLM provider is configured; add one in Settings > Models"), { pluginCode: "no-provider" });
	}
	const named = typeof rawProvider === "string" && rawProvider !== "" ? providers.find((entry) => entry.id === rawProvider) : undefined;
	const provider = (named ?? providers[0]).id;
	let models = [];
	try {
		models = await ctx.llm.listModels(provider);
	} catch {
		// An adapter that cannot enumerate may still serve an explicitly named model.
		models = [];
	}
	const advertised = Array.isArray(models) ? models : [];
	const wantsNamed = typeof rawModel === "string" && rawModel !== "" && provider === rawProvider;
	let model;
	if (wantsNamed && (advertised.length === 0 || advertised.some((entry) => entry.id === rawModel))) model = rawModel;
	else if (advertised.length > 0) model = advertised[0].id;
	else if (typeof rawModel === "string" && rawModel !== "") model = rawModel;
	if (model === undefined) {
		throw Object.assign(new Error(`provider ${JSON.stringify(provider)} advertises no model to use`), { pluginCode: "no-model" });
	}
	return { provider, model };
}

/**
 * Build the one-shot user message for a generation call.
 * Hand-built rather than imported from `@deepseek-ai/dsh-llm`: this package
 * deliberately declares no `@deepseek-ai/*` runtime imports, because a plugin
 * installed with pnpm `link:` resolves them from its own real source path,
 * where no host tree exists.
 *
 * The shape is the host's documented hand-built one-shot input
 * (`RequestUserInput`): the `user` role plus one text block, and deliberately
 * **no `id` and no `source`**. dsh >= 0.1.7 retired the catch-all `plugin`
 * source kind — `MessageSourceMap` has no such member ("each producer declares
 * its own `kind` in its own module; there is no shared catch-all `plugin`
 * kind", `dsh-llm/lib/types/message.d.ts`), and Session format v4 refuses
 * `{kind:"plugin"}` outright (`dsh-session-format-v3-to-v4`). A one-shot
 * request needs no durable identity: only `provider`/`model`/`messages`/… are
 * read off {@link GenerateOptions}.
 * @param text - model-facing prompt body.
 */
function generationMessage(text) {
	return { role: "user", content: [{ type: "text", text }] };
}

/**
 * Generate a commit message for a change set through the shared LLM service.
 * @param ctx - context exposing the `llm` service.
 * @param prompt - `{ system, body }` from {@link generationPrompt}.
 * @param route - `{ provider, model }` from {@link resolveLlmRoute}.
 * @param signal - cancellation (browser abort plus the server ceiling).
 * @param sessionId - the caller's session, when it has one. Forwarded as
 *   `GenerateOptions.sessionId`; adapters that need session affinity (they
 *   receive it only when it is present — see `dsh-llm-pi-ai`'s options mapping)
 *   reject an unidentified request outright, so an AI draft from the panel must
 *   carry one.
 * @returns the trimmed message.
 * @throws on a terminal stream failure, an output cap hit before any text
 *   existed (`llm-truncated`), or genuinely empty output (`llm-empty`).
 */
async function requestCommitMessage(ctx, prompt, route, signal, sessionId = undefined) {
	const options = {
		provider: route.provider,
		model: route.model,
		messages: [generationMessage(prompt.body)],
		system: prompt.system,
		maxTokens: LLM_MAX_TOKENS,
		signal,
		// Session-labelled routes (an "opencode go"-style gateway is the local
		// example) answer 400 when the request carries no session identity, and
		// the host's pi-ai adapter forwards this field only when it is present.
		...(sessionId === undefined ? {} : { sessionId })
	};
	// Final text comes from the assembled blocks; the delta map is a fallback for
	// an adapter that emits text without a closing `block-end`.
	const blocks = new Map();
	const deltas = new Map();
	let finish;
	for await (const chunk of ctx.llm.stream(options)) {
		if (chunk.type === "text-delta") deltas.set(chunk.index, `${deltas.get(chunk.index) ?? ""}${chunk.text}`);
		else if (chunk.type === "block-end" && chunk.block.type === "text") blocks.set(chunk.index, chunk.block.text);
		else if (chunk.type === "finish") finish = chunk.reason;
	}
	if (finish !== undefined && (finish.kind === "error" || finish.kind === "aborted")) {
		throw Object.assign(new Error(finish.failure.message), { pluginCode: finish.kind === "aborted" ? "cancelled" : "llm-failed" });
	}
	const ordered = (map) => [...map.entries()].sort((left, right) => left[0] - right[0]).map((entry) => entry[1]);
	const message = (blocks.size > 0 ? ordered(blocks) : ordered(deltas)).join("").trim();
	if (message === "") {
		// "Nothing came back" and "the budget ran out before any text did" are
		// different failures with different fixes; a reasoning model hits the
		// second one routinely (its thinking shares `completion_tokens` with the
		// message), so report the cap instead of a misleading generic empty.
		if (finish !== undefined && finish.kind === "max-tokens") {
			throw Object.assign(
				new Error(`the model hit the ${LLM_MAX_TOKENS}-token output cap before writing any commit message (a reasoning model spends that budget on its thinking first)`),
				{ pluginCode: "llm-truncated" }
			);
		}
		throw Object.assign(new Error("the model returned no commit message"), { pluginCode: "llm-empty" });
	}
	return message;
}

/**
 * `generateMessage` endpoint: draft a commit message from the working tree.
 * @param ctx - context exposing the `llm` service.
 * @param rawCwd - session workspace directory.
 * @param rawMode - `staged`, `unstaged`, or `all`.
 * @param rawProvider - caller's provider route (optional).
 * @param rawModel - caller's model id (optional).
 * @param rawSessionId - caller's session id (optional; see
 *   {@link requestCommitMessage} for why a session-scoped caller must send it).
 * @param rawLanguage - language NAME the message must be written in (optional;
 *   absent/`"auto"` follows the repository).
 * @param signal - transport cancellation.
 */
async function gitGenerateMessage(ctx, rawCwd, rawMode, rawProvider, rawModel, rawSessionId, rawLanguage, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	if (rawMode !== undefined && rawMode !== null && !GENERATE_MODES.includes(rawMode)) {
		return fail("invalid-mode", `mode must be one of ${GENERATE_MODES.join(", ")}`);
	}
	if (rawSessionId !== undefined && rawSessionId !== null
		&& (typeof rawSessionId !== "string" || rawSessionId === "" || rawSessionId.length > SESSION_ID_MAX_CHARS)) {
		return fail("invalid-session", "sessionId must be a non-empty string when present");
	}
	const language = readLanguage(rawLanguage);
	if (language.ok !== true) {
		return fail("invalid-language", `language must be a plain language name of at most ${LANGUAGE_MAX_CHARS} characters`);
	}
	const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
	const mode = rawMode ?? GENERATE_MODE_DEFAULT;
	// AI drafting is the plugin's one OPTIONAL capability. Without the host's
	// `llm` service this endpoint answers a stable code — the panel disables the
	// button from `status.generate` and never sends the call — rather than the
	// whole plugin row waiting forever for a service that may never start.
	const llm = optionalLlm(ctx);
	if (llm === undefined) {
		return fail("llm-unavailable", "the host provides no llm service, so AI commit-message drafting is unavailable", { mode });
	}
	// The generation units keep their `{ llm }` context shape (they are unit
	// tested with a stand-in service); only the source of the service changed.
	const llmContext = { llm };
	const changes = await readChangesForMode(rawCwd, mode, signal);
	if (changes.ok !== true) return changes;
	if (changes.value.repo !== true) return fail("not-a-repo", "not a git repository", {});
	if (changes.value.diff === "") {
		return fail("no-changes", generationEmptyHint(mode), { mode });
	}
	let route;
	try {
		route = await resolveLlmRoute(llmContext, rawProvider, rawModel);
	} catch (error) {
		return fail(error.pluginCode ?? "llm-failed", error.message, { mode });
	}
	const prompt = generationPrompt(
		clampForModel(changes.value.stat, LLM_STAT_MAX_CHARS),
		clampForModel(changes.value.diff, LLM_DIFF_MAX_CHARS),
		language.value
	);
	// Bound the call even if the browser goes away without hanging up; the
	// turn's own signal still cancels immediately.
	const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
	const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
	if (combined.aborted) return fail("cancelled", "generation was cancelled", { mode });
	try {
		const message = await requestCommitMessage(llmContext, prompt, route, combined, sessionId);
		return ok({ message, mode, provider: route.provider, model: route.model });
	} catch (error) {
		// The route rides along so the panel can name the provider that failed:
		// a route-level gateway rejection otherwise reads as a plugin bug.
		return fail(error.pluginCode ?? "llm-failed", error instanceof Error ? error.message : String(error), {
			mode,
			provider: route.provider,
			model: route.model
		});
	}
}

/** The actionable, mode-aware wording for an empty change set. */
function generationEmptyHint(mode) {
	if (mode === "staged") return "no staged changes; stage them first (or generate from unstaged/all changes)";
	if (mode === "unstaged") return "no unstaged changes";
	return "no changes in the working tree";
}

/**
 * Dispatch one endpoint call.
 * @param ctx - plugin context (its `llm` service is optional; see {@link optionalLlm}).
 * @param endpoint - endpoint name (already path-validated).
 * @param payload - the client-request payload (`{ args }`).
 * @param signal - abort signal cancelling the git child or the LLM stream.
 */
async function dispatch(ctx, endpoint, payload, signal) {
	const args = payload !== null && typeof payload === "object" && payload.args !== null && typeof payload.args === "object"
		? payload.args
		: {};
	switch (endpoint) {
		case "status":
			return gitStatus(args.cwd, signal, optionalLlm(ctx) !== undefined);
		case "branches":
			return gitBranches(args.cwd, signal);
		case "checkout":
			return gitCheckout(args.cwd, args.branch, signal);
		case "createBranch":
			return gitCreateBranch(args.cwd, args.branch, args.base, signal);
		case "fetch":
			return gitFetch(args.cwd, signal);
		case "pull":
			return gitPull(args.cwd, signal);
		case "stage":
			return gitStage(args.cwd, signal);
		case "stash":
			return gitStash(args.cwd, args.message, args.includeUntracked, signal);
		case "stashPop":
			return gitStashPop(args.cwd, args.ref, signal);
		case "discard":
			return gitDiscard(args.cwd, args.path, args.origPath, signal);
		case "headMessage":
			return gitHeadMessage(args.cwd, signal);
		case "diff":
			return gitFileDiff(args.cwd, args.path, args.origPath, signal);
		case "commit":
			return gitCommit(args.cwd, args.message, signal, args.amend === true);
		case "push":
			return gitPush(ctx, args.cwd, args.sessionId, signal);
		case "log":
			return gitLog(args.cwd, args.count, signal);
		case "generateMessage":
			return gitGenerateMessage(ctx, args.cwd, args.mode, args.provider, args.model, args.sessionId, args.language, signal);
		default:
			return fail("unknown-endpoint", `unknown git endpoint ${JSON.stringify(endpoint)}`);
	}
}

/**
 * Plugin body: mount the `/dsh-git-rpc` channel on the web server and speak the
 * Connection RPC wire protocol (see the file header for why the route is
 * self-owned on dsh >= 0.1.5-rc.1).
 * @param ctx - plugin context with `webServer` and `connection` (declared above);
 *   `llm` is optional and read per call through {@link optionalLlm}.
 */
function apply(ctx) {
	// The channel runs git against caller-supplied absolute paths, so it must
	// never mount unfenced: the connection service's Host/Origin + browser-cookie
	// check is the only gate. `requestRejection` is the >= 0.1.5-rc.1 form of that
	// check. An older host without it still gets no channel (this throws), but
	// note the throw is *stderr-only* for the operator: dsh-app-boot treats
	// non-required rows as optional, so this row is skipped with a warning rather
	// than failing the boot. Never downgrade the guard to a pass-through.
	const connection = ctx.get("connection");
	if (connection === undefined || typeof connection.requestRejection !== "function") {
		throw new Error(`${name}: this plugin requires dsh >= 0.1.5-rc.1 (connection.requestRejection is unavailable, so /dsh-git-rpc could not be fenced)`);
	}
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: RPC_CHANNEL,
		handler: async (req, res) => {
			// The host's own router matches on `new URL(req.url, "http://x").pathname`,
			// so an absolute-form request target (a proxy in front of dsh web) must
			// resolve here too. Origin-form targets are kept verbatim: `endpointFromPath`
			// is the stricter reader (it rejects `.`/`..`/empty segments and anything
			// outside the client's own segment pattern), and routing the raw target
			// through the URL parser first would silently normalize a traversal
			// attempt into a different endpoint instead of refusing it.
			const rawTarget = String(req.url ?? "/");
			const pathname = rawTarget.startsWith("/") ? rawTarget : new URL(rawTarget, "http://x").pathname;
			const endpoint = endpointFromPath(pathname);
			if (endpoint === undefined) {
				sendEnvelope(res, 404, rpcError("invalid-request", "not-found", "not found", {}));
				return;
			}
			// The connection service owns the Host/Origin fence and the browser
			// session cookie; a plugin channel must not bypass it.
			const rejection = connection.requestRejection(req);
			if (rejection !== undefined) {
				res.statusCode = rejection;
				res.end(rejection === 401 ? "unauthorized" : "forbidden");
				return;
			}
			if (req.method !== "POST") {
				res.statusCode = 405;
				res.setHeader("allow", "POST");
				res.end();
				return;
			}
			const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
			if (contentType !== "application/json") {
				sendEnvelope(res, 415, rpcError("invalid-request", "gateway/bad-request", "content type must be application/json", {}));
				return;
			}
			let text;
			try {
				text = await readBoundedBody(req, RPC_MAX_BODY_BYTES);
			} catch {
				sendEnvelope(res, 400, rpcError("invalid-request", "gateway/bad-request", "body read failed", {}));
				return;
			}
			if (text === undefined) {
				sendEnvelope(res, 413, rpcError("invalid-request", "gateway/bad-request", "request body too large or unreadable", {}));
				return;
			}
			let message;
			try {
				message = JSON.parse(text);
			} catch {
				sendEnvelope(res, 400, rpcError("invalid-request", "gateway/bad-request", "body is not JSON", {}));
				return;
			}
			// Same outer-envelope contract as client-connection clientRequestSchema.
			if (message === null || typeof message !== "object" || Array.isArray(message) || message.type !== "client-request"
				|| typeof message.rpcId !== "string" || typeof message.method !== "string" || !("payload" in message)) {
				sendEnvelope(res, 400, rpcError("invalid-request", "gateway/bad-request", "invalid client-request message", {}));
				return;
			}
			if (message.method !== endpoint) {
				sendEnvelope(res, 200, rpcError(message.rpcId, "gateway/bad-request",
					`method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`, {}));
				return;
			}
			// Cancel the git child when the browser drops the request.
			const controller = new AbortController();
			const abort = () => { controller.abort(); };
			req.on("aborted", abort);
			res.on("close", () => { if (res.writableEnded !== true) abort(); });
			let result;
			try {
				result = await dispatch(ctx, endpoint, message.payload, controller.signal);
			} catch (error) {
				sendEnvelope(res, 200, rpcFull(message.rpcId, fail("internal-error", error instanceof Error ? error.message : String(error))));
				return;
			}
			sendEnvelope(res, 200, rpcFull(message.rpcId, result));
		}
	}), `dsh-git: POST ${RPC_CHANNEL}/*`);
}

// `apply`/`inject`/`name` are the Cordis plugin face. The remaining exports are
// the units worth testing directly: the generation units (a route path reads a
// diff through git first, so `generateMessage` needs a real repository to reach
// them) and the commit-message normalizer (pure, and the exact place the
// subject+body regression lived).
export { apply, clampForModel, generationPrompt, inject, name, normalizeCommitMessage, pushPlan, readLanguage, requestCommitMessage, resolveLlmRoute };
