/**
 * @dsh-plugins/dsh-git — host half.
 *
 * Mounts the `/dsh-git-rpc` Connection RPC channel on the web server. The
 * browser half (lib/client.js) calls the endpoints through
 * `connection.rpc.call("/dsh-git-rpc", endpoint, { args })` with the current
 * session's workspace directory as `args.cwd`:
 *
 *   - `status`    → repo facts: current branch (or detached HEAD), dirty file
 *                   count, ahead/behind vs upstream, uncommitted file list.
 *   - `branches`  → local and remote branch lists.
 *   - `checkout`  → switch branches (git switch --guess; DWIM, never detaches).
 *   - `createBranch` → create a new branch from a base branch and switch to
 *                   it (IDE "new branch from…" semantics).
 *   - `fetch`     → git fetch (optionally a specific remote).
 *   - `pull`      → git pull --ff-only (fast-forward only; conflicts surface
 *                   as errors instead of surprise merges).
 *   - `commit`    → git commit -m with author-config check up front.
 *   - `push`      → git push (current branch's upstream).
 *   - `log`       → recent commit summary lines.
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
 * owns the route, `connection` supplies the request fence.
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
 * Run one git invocation without a shell.
 * @param cwd - working directory (the session workspace).
 * @param args - git arguments (never user-joined into a string; no shell).
 * @param signal - optional transport cancellation (kills the child on abort).
 * @param timeoutMs - per-call timeout.
 * @returns resolved stdout/stderr, or rejects with the exec error augmented
 * with `stdout`/`stderr` text.
 */
function runGit(cwd, args, signal, timeoutMs = GIT_TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		execFile("git", args, {
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
			const wrapped = error instanceof Error ? error : new Error(String(error));
			wrapped.stdout = String(stdout ?? "");
			wrapped.stderr = String(stderr ?? "");
			reject(wrapped);
		});
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
 * Validate a caller-supplied remote name (origin, upstream, …).
 * Plain segment: letters/digits/._- only.
 */
function validRemote(value) {
	if (value === undefined) return true;
	return typeof value === "string" && value.length > 0 && value.length <= 100 && !value.startsWith("-") && !value.includes("..") && /^[A-Za-z0-9._-]+$/.test(value);
}

/**
 * Validate a caller-supplied commit message. Rejects control characters and
 * NUL; allows anything else (including leading dashes — safe because the
 * message is passed as `--message=<msg>`, never as a bare `-m` argument).
 */
function validMessage(value) {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 10000) return false;
	if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
	return true;
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
 * `status` endpoint: repo facts + uncommitted file list for one directory.
 * @param rawCwd - session workspace directory.
 * @param signal - transport cancellation.
 */
async function gitStatus(rawCwd, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	let out;
	try {
		out = await runGit(rawCwd, ["status", "--porcelain=v2", "--branch"], signal);
	} catch (error) {
		if (isNotARepo(error)) return ok({ repo: false });
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
					changes.push({ status: "untracked", path: parts.slice(1).join(" ") });
				} else if (parts[0] === "1") {
					changes.push({ status: labelOf(parts[1]), path: parts.slice(8).join(" ") });
				} else if (parts[0] === "2") {
					const path = parts[8];
					const orig = parts[9];
					changes.push({ status: labelOf(parts[1]), path: orig !== undefined ? `${orig} → ${path}` : path });
				} else if (parts[0] === "u") {
					changes.push({ status: "conflict", path: parts.slice(9).join(" ") });
				}
			}
		}
	}
	return ok({ repo: true, branch, detached, oid, upstream, ahead, behind, dirty, changes });
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
			runGit(rawCwd, ["for-each-ref", "--format=%(refname:short)", "refs/remotes"], signal)
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
	const remote = remotes.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
		// refname:short for a remote-tracking ref is "<remote>/<branch...>".
		// The DWIM-able branch name is the path after the remote segment.
		const stripped = line.replace(/^remotes\//, "");
		const slash = stripped.indexOf("/");
		const short = slash === -1 ? stripped : stripped.slice(slash + 1);
		return { name: line, short };
	});
	const current = local.find((entry) => entry.current)?.name ?? null;
	return ok({ repo: true, current, local, remote });
}

/**
 * `checkout` endpoint: switch the repo at `cwd` to `branch`.
 * @param rawCwd - session workspace directory.
 * @param rawBranch - branch name to switch to.
 * @param signal - transport cancellation.
 */
async function gitCheckout(rawCwd, rawBranch, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	const branch = normalizeBranch(rawBranch);
	if (branch === null) return fail("invalid-branch", "invalid branch name");
	let out;
	try {
		out = await runGit(rawCwd, ["switch", "--guess", branch], signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		const detail = cleanMessage(error);
		// The common refusal: local changes would be overwritten by the switch.
		// Keep git's own words but add context so the panel message is readable.
		if (/local changes to the following files would be overwritten|your local changes would be overwritten/i.test(detail)) {
			return fail("checkout-failed", "本地有未提交的修改会被切换覆盖，git 已拒绝：" + detail, {});
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
	return ok({ branch, detached: false, oid: null, message: out.stderr.trim() !== "" ? out.stderr.trim().slice(0, 500) : null });
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
 * `fetch` endpoint: download remote refs (optionally one remote).
 * @param rawCwd - session workspace directory.
 * @param rawRemote - optional remote name (validated).
 * @param signal - transport cancellation.
 */
async function gitFetch(rawCwd, rawRemote, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	if (!validRemote(rawRemote)) return fail("invalid-remote", "invalid remote name");
	const args = rawRemote === undefined ? ["fetch"] : ["fetch", rawRemote];
	let out;
	try {
		out = await runGit(rawCwd, args, signal, GIT_NET_TIMEOUT_MS);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("fetch-failed", cleanMessage(error), {});
	}
	const detail = [out.stdout, out.stderr].join("\n").trim();
	return ok({ message: detail !== "" ? detail.slice(0, 800) : "fetch complete" });
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
	return ok({ message: detail !== "" ? detail.slice(0, 800) : "pull complete" });
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
 * @param rawCwd - session workspace directory.
 * @param rawMessage - commit message (validated).
 * @param signal - transport cancellation.
 */
async function gitCommit(rawCwd, rawMessage, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	if (!validMessage(rawMessage)) return fail("invalid-message", "commit message is required and must not contain control characters");
	const author = await readAuthor(rawCwd);
	if (author === null) {
		return fail("missing-author", "git user.name / user.email are not configured; set them first (e.g. `git config --global user.name \"you\"` and `git config --global user.email you@example.com`)", {});
	}
	let out;
	try {
		out = await runGit(rawCwd, ["commit", `--message=${rawMessage.trim()}`], signal);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("commit-failed", cleanMessage(error), {});
	}
	const summary = out.stdout.trim() !== "" ? out.stdout.trim().slice(0, 500) : out.stderr.trim().slice(0, 500);
	return ok({ message: summary });
}

/**
 * `push` endpoint: push the current branch to its upstream.
 * @param rawCwd - session workspace directory.
 * @param signal - transport cancellation.
 */
async function gitPush(rawCwd, signal) {
	if (!validCwd(rawCwd)) return fail("invalid-cwd", "a valid absolute working directory is required");
	let out;
	try {
		out = await runGit(rawCwd, ["push"], signal, GIT_NET_TIMEOUT_MS);
	} catch (error) {
		if (isNotARepo(error)) return fail("not-a-repo", "not a git repository", {});
		return fail("push-failed", cleanMessage(error), {});
	}
	const detail = [out.stdout, out.stderr].join("\n").trim();
	return ok({ message: detail !== "" ? detail.slice(0, 800) : "push complete" });
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
 * Uses the classic data/end/error events rather than async iteration: the
 * IncomingMessage async iterator is not a stable path in this runtime.
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
 * Dispatch one endpoint call.
 * @param endpoint - endpoint name (already path-validated).
 * @param payload - the client-request payload (`{ args }`).
 * @param signal - abort signal cancelling the git child.
 */
async function dispatch(endpoint, payload, signal) {
	const args = payload !== null && typeof payload === "object" && payload.args !== null && typeof payload.args === "object"
		? payload.args
		: {};
	switch (endpoint) {
		case "status":
			return gitStatus(args.cwd, signal);
		case "branches":
			return gitBranches(args.cwd, signal);
		case "checkout":
			return gitCheckout(args.cwd, args.branch, signal);
		case "createBranch":
			return gitCreateBranch(args.cwd, args.branch, args.base, signal);
		case "fetch":
			return gitFetch(args.cwd, args.remote, signal);
		case "pull":
			return gitPull(args.cwd, signal);
		case "commit":
			return gitCommit(args.cwd, args.message, signal);
		case "push":
			return gitPush(args.cwd, signal);
		case "log":
			return gitLog(args.cwd, args.count, signal);
		default:
			return fail("unknown-endpoint", `unknown git endpoint ${JSON.stringify(endpoint)}`);
	}
}

/**
 * Plugin body: mount the `/dsh-git-rpc` channel on the web server and speak the
 * Connection RPC wire protocol (see the file header for why the route is
 * self-owned on dsh >= 0.1.5-rc.1).
 * @param ctx - plugin context with `webServer` and `connection` (declared above).
 */
function apply(ctx) {
	// The channel runs git against caller-supplied absolute paths, so it must
	// never mount unfenced: the connection service's Host/Origin + browser-cookie
	// check is the only gate. `requestRejection` is the >= 0.1.5-rc.1 form of that
	// check; an older host without it fails loudly instead of serving an open
	// channel.
	const connection = ctx.get("connection");
	if (connection === undefined || typeof connection.requestRejection !== "function") {
		throw new Error(`${name}: this plugin requires dsh >= 0.1.5-rc.1 (connection.requestRejection is unavailable, so /dsh-git-rpc could not be fenced)`);
	}
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: RPC_CHANNEL,
		handler: async (req, res) => {
			const pathname = String(req.url ?? "/").split("?")[0];
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
				result = await dispatch(endpoint, message.payload, controller.signal);
			} catch (error) {
				sendEnvelope(res, 200, rpcFull(message.rpcId, fail("internal-error", error instanceof Error ? error.message : String(error))));
				return;
			}
			sendEnvelope(res, 200, rpcFull(message.rpcId, result));
		}
	}), `dsh-git: POST ${RPC_CHANNEL}/*`);
}

export { apply, inject, name };
