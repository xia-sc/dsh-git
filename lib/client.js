/**
 * @dsh-plugins/dsh-git — browser half (dsh.client bundle).
 *
 * Two seats, one shared store:
 *
 *   - `conversation.input.dock` → GitDockLine: a compact status PILL rendered
 *     LEFT-ALIGNED in the row band above the composer card (the textarea's
 *     top-left, no full-width banner): branch summary, or "not a git
 *     repository". Clicking it toggles the workbench panel. It follows the
 *     CURRENT session's workspace directory — clicking different sessions /
 *     workspaces in the sidebar re-binds it in real time.
 *   - `shell.overlay` → GitFloatingPanel: renders NOTHING while collapsed (no
 *     floating bubble that could cover the input box) and the full Git
 *     workbench when expanded, positioned above the composer card.
 *
 * All Git work happens on the host through `/dsh-git-rpc` (mounted by
 * lib/index.js); this bundle only renders and calls `ctx.connection.rpc`.
 * The bundle is hand-written against the client module table (seed words
 * only: `react`), so it ships without a build step.
 */
window.__ModuleLoader__.load({
	id: "@dsh-plugins/dsh-git",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var React = require("react");

		var name = "dsh-git";
		/** Required client services (activation gating for the loader entry). */
		var inject = ["slots", "connection", "locale"];

		/** Locale namespace owned by this plugin. */
		var NS = "dshGit";

		var zh = {
			"panel.title": "Git",
			"panel.collapse": "收起",
			"refresh.aria": "刷新 Git 状态",
			"branch.aria": "当前 Git 分支",
			"switch.aria": "切换分支",
			"switch.dirtyWarn": "有 {count} 个未提交文件（如 {paths}），切换分支可能被 git 拒绝，请先提交或暂存",
			"switch.force": "仍要切换",
			"group.local": "本地分支",
			"group.remote": "远程分支",
			"loading": "读取中…",
			"notRepo": "当前工作区不是 Git 仓库",
			"detached": "游离 HEAD",
			"dirty": "{count} 个未提交更改",
			"aheadBehind": "领先 {ahead} / 落后 {behind}",
			"action.fetch": "拉取更新",
			"action.pull": "拉取合并",
			"action.commit": "提交",
			"action.push": "推送",
			"commit.placeholder": "提交信息…",
			"commit.empty": "请输入提交信息",
			"changes.title": "变更（{count}）",
			"changes.none": "工作区干净",
			"log.title": "最近提交",
			"log.none": "暂无提交",
			"busy.fetch": "拉取中…",
			"busy.pull": "拉取合并中…",
			"busy.commit": "提交中…",
			"busy.push": "推送中…",
			"busy.checkout": "切换中…",
			"output.ok": "操作成功",
			"dock.aria": "打开 Git 面板",
			"status.modified": "修改",
			"status.added": "新增",
			"status.deleted": "删除",
			"status.renamed": "重命名",
			"status.copied": "复制",
			"status.untracked": "未跟踪",
			"status.conflict": "冲突",
			"status.type-changed": "类型变更",
			"status.changed": "变更"
		};

		var en = {
			"panel.title": "Git",
			"panel.collapse": "Collapse",
			"refresh.aria": "Refresh Git status",
			"branch.aria": "Current git branch",
			"switch.aria": "Switch branch",
			"switch.dirtyWarn": "{count} uncommitted file(s) (e.g. {paths}) may block the switch — commit or stash first",
			"switch.force": "Switch anyway",
			"group.local": "Local",
			"group.remote": "Remote",
			"loading": "Loading…",
			"notRepo": "This workspace is not a git repository",
			"detached": "detached HEAD",
			"dirty": "{count} uncommitted change(s)",
			"aheadBehind": "{ahead} ahead / {behind} behind",
			"action.fetch": "Fetch",
			"action.pull": "Pull",
			"action.commit": "Commit",
			"action.push": "Push",
			"commit.placeholder": "Commit message…",
			"commit.empty": "Enter a commit message",
			"changes.title": "Changes ({count})",
			"changes.none": "Working tree clean",
			"log.title": "Recent commits",
			"log.none": "No commits yet",
			"busy.fetch": "Fetching…",
			"busy.pull": "Pulling…",
			"busy.commit": "Committing…",
			"busy.push": "Pushing…",
			"busy.checkout": "Switching…",
			"output.ok": "Operation succeeded",
			"dock.aria": "Open Git panel",
			"status.modified": "modified",
			"status.added": "added",
			"status.deleted": "deleted",
			"status.renamed": "renamed",
			"status.copied": "copied",
			"status.untracked": "untracked",
			"status.conflict": "conflict",
			"status.type-changed": "type changed",
			"status.changed": "changed"
		};

		/** React.createElement shorthand. */
		function h(type, props) {
			var children = Array.prototype.slice.call(arguments, 2);
			return React.createElement.apply(React, [type, props].concat(children));
		}

		/** Compact inline styles tuned to the shell overlay / composer dock. */
		var S = {
			panel: {
				position: "fixed",
				// Sit above the composer card so the expanded panel never covers
				// the input box (the input.left pill sits in the tool row).
				bottom: 168,
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 30,
				width: 400,
				maxWidth: "calc(100vw - 24px)",
				maxHeight: "60vh",
				display: "flex",
				flexDirection: "column",
				border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))",
				borderRadius: 12,
				background: "var(--dsw-alias-bg-base, #1e1e1e)",
				boxShadow: "var(--dsw-shadow-lv2, 0 8px 32px rgba(0,0,0,0.45))",
				overflow: "hidden",
				pointerEvents: "auto"
			},
			header: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "8px 12px",
				borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2))",
				flex: "none",
				cursor: "move",
				userSelect: "none",
				touchAction: "none"
			},
			title: {
				fontSize: 13,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, #e5e7eb)",
				flex: "1",
				minWidth: 0,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			body: {
				flex: "1",
				minHeight: 0,
				padding: "10px 12px 12px",
				overflowY: "auto"
			},
			row: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				margin: "6px 0"
			},
			warn: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				margin: "6px 0",
				padding: "6px 8px",
				borderRadius: 8,
				background: "var(--dsw-alias-state-warning-tertiary, rgba(245,158,11,0.14))",
				border: "1px solid var(--dsw-alias-state-warning-secondary, rgba(245,158,11,0.4))",
				color: "var(--dsw-alias-state-warning-primary, #f59e0b)",
				fontSize: 12,
				lineHeight: "16px"
			},
			chip: {
				background: "var(--dsw-alias-surface-tertiary, rgba(127,127,127,0.12))",
				color: "var(--dsw-alias-label-secondary, #c8ccd2)",
				borderRadius: 999,
				padding: "0 8px",
				fontWeight: 500,
				fontSize: 12,
				lineHeight: "20px",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			dirty: {
				color: "var(--dsw-alias-state-warn-primary, #f0a020)",
				fontWeight: 600,
				fontSize: 12
			},
			meta: {
				color: "var(--dsw-alias-label-quaternary, #6b7280)",
				fontSize: 12
			},
			button: {
				background: "var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,0.14))",
				border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))",
				borderRadius: 8,
				color: "var(--dsw-alias-label-secondary, #c8ccd2)",
				font: "inherit",
				fontSize: 12,
				lineHeight: "22px",
				padding: "0 10px",
				cursor: "pointer",
				flex: "none"
			},
			buttonPrimary: {
				background: "var(--dsw-alias-state-business-primary, #4f8cff)",
				border: "1px solid transparent",
				borderRadius: 8,
				color: "#fff",
				font: "inherit",
				fontSize: 12,
				lineHeight: "22px",
				padding: "0 10px",
				cursor: "pointer",
				flex: "none"
			},
			buttonDisabled: {
				opacity: 0.5,
				cursor: "default"
			},
			select: {
				// colorScheme makes the NATIVE dropdown listbox follow the page
				// theme (dark list on dark pages) instead of the OS default
				// white; option/optgroup styles above reinforce it.
				colorScheme: "light dark",
				background: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.1))",
				border: "1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,0.25))",
				borderRadius: 8,
				color: "var(--dsw-alias-label-secondary, #c8ccd2)",
				font: "inherit",
				fontSize: 12,
				lineHeight: "20px",
				padding: "2px 8px",
				maxWidth: 220,
				cursor: "pointer",
				flex: "1",
				minWidth: 0,
				outline: "none"
			},
			input: {
				background: "transparent",
				border: "1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,0.25))",
				borderRadius: 8,
				color: "var(--dsw-alias-label-primary, #e5e7eb)",
				font: "inherit",
				fontSize: 12,
				lineHeight: "20px",
				padding: "2px 8px",
				flex: "1",
				minWidth: 0,
				outline: "none"
			},
			sectionTitle: {
				fontSize: 12,
				fontWeight: 600,
				color: "var(--dsw-alias-label-tertiary, #9aa0a6)",
				margin: "10px 0 4px",
				cursor: "pointer",
				userSelect: "none"
			},
			changeRow: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 12,
				lineHeight: "20px",
				color: "var(--dsw-alias-label-secondary, #c8ccd2)",
				padding: "1px 0",
				minWidth: 0
			},
			changePath: {
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				flex: "1",
				minWidth: 0
			},
			statusTag: {
				flex: "none",
				fontSize: 11,
				lineHeight: "16px",
				padding: "0 6px",
				borderRadius: 4,
				background: "var(--dsw-alias-surface-tertiary, rgba(127,127,127,0.12))"
			},
			logRow: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 12,
				lineHeight: "20px",
				color: "var(--dsw-alias-label-secondary, #c8ccd2)",
				padding: "1px 0",
				minWidth: 0
			},
			logSha: {
				flex: "none",
				color: "var(--dsw-alias-state-business-primary, #4f8cff)",
				fontFamily: "monospace"
			},
			output: {
				marginTop: 8,
				padding: "6px 10px",
				borderRadius: 8,
				fontSize: 12,
				lineHeight: "18px",
				wordBreak: "break-word",
				maxHeight: 160,
				overflowY: "auto",
				whiteSpace: "pre-wrap"
			},
			outputOk: {
				background: "var(--dsw-alias-state-success-tertiary, rgba(52,199,89,0.12))",
				color: "var(--dsw-alias-state-success-primary, #34c759)"
			},
			outputError: {
				background: "var(--dsw-alias-state-error-tertiary, rgba(239,68,68,0.12))",
				color: "var(--dsw-alias-state-error-primary, #ef4444)"
			},
			dockWrap: {
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				maxWidth: "100%",
				fontSize: 12,
				lineHeight: "20px",
				color: "var(--dsw-alias-label-tertiary, #9aa0a6)",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
				cursor: "pointer"
			}
		};

		/** Truncate a display string. */
		function shortText(value, max) {
			var text = typeof value === "string" ? value : String(value);
			return text.length > max ? text.slice(0, max - 1) + "…" : text;
		}

		/** Call one /dsh-git-rpc endpoint. */
		function rpc(ctx, endpoint, args) {
			return ctx.connection.rpc.call("/dsh-git-rpc", endpoint, { args: args || {} });
		}

		/**
		 * Shared Git store: one load per cwd (deduplicated), real-time rebind on
		 * session/workspace change, and post-action refresh so every seat (panel
		 * + dock) sees the same truth. Module-level singleton per apply().
		 */
		function createGitStore(ctx) {
			var verbs = {
				status: function (cwd) { return rpc(ctx, "status", { cwd: cwd }); },
				branches: function (cwd) { return rpc(ctx, "branches", { cwd: cwd }); },
				checkout: function (cwd, branch) { return rpc(ctx, "checkout", { cwd: cwd, branch: branch }); },
				fetch: function (cwd) { return rpc(ctx, "fetch", { cwd: cwd }); },
				pull: function (cwd) { return rpc(ctx, "pull", { cwd: cwd }); },
				commit: function (cwd, message) { return rpc(ctx, "commit", { cwd: cwd, message: message }); },
				push: function (cwd) { return rpc(ctx, "push", { cwd: cwd }); },
				log: function (cwd) { return rpc(ctx, "log", { cwd: cwd, count: 10 }); }
			};

			function idleState() {
				return {
					cwd: null,
					phase: "idle",
					repo: false,
					branch: null,
					detached: false,
					oid: null,
					upstream: null,
					ahead: 0,
					behind: 0,
					dirty: 0,
					changes: [],
					local: [],
					remote: [],
					commits: [],
					error: null,
					busy: null,
					lastResult: null,
					panelOpen: false
				};
			}

			var state = idleState();
			var listeners = new Set();
			var seq = 0;
			var inflight = null;

			function emit(next) {
				state = next;
				for (var fn of Array.from(listeners)) {
					try { fn(); } catch (error) { console.error("[dsh-git] store listener threw:", error); }
				}
			}

			function getSnapshot() { return state; }

			function subscribe(fn) {
				listeners.add(fn);
				return function () { listeners.delete(fn); };
			}

			function applyData(nextCwd, status, branches, log) {
				var sv = status && status.ok === true ? status.value : null;
				var bv = branches && branches.ok === true ? branches.value : null;
				var lv = log && log.ok === true ? log.value : null;
				if (sv === null) {
					return Object.assign(idleState(), {
						cwd: nextCwd,
						phase: "error",
						error: status && status.error ? String(status.error.message || "git status failed") : "git status failed",
						panelOpen: state.panelOpen
					});
				}
				return Object.assign(idleState(), {
					cwd: nextCwd,
					phase: "ready",
					repo: sv.repo === true,
					branch: sv.branch || null,
					detached: sv.detached === true,
					oid: sv.oid || null,
					upstream: sv.upstream || null,
					ahead: typeof sv.ahead === "number" ? sv.ahead : 0,
					behind: typeof sv.behind === "number" ? sv.behind : 0,
					dirty: typeof sv.dirty === "number" ? sv.dirty : 0,
					changes: Array.isArray(sv.changes) ? sv.changes : [],
					local: bv !== null && Array.isArray(bv.local) ? bv.local : [],
					remote: bv !== null && Array.isArray(bv.remote) ? bv.remote : [],
					commits: lv !== null && Array.isArray(lv.commits) ? lv.commits : [],
					panelOpen: state.panelOpen
				});
			}

			function doRefresh(cwd) {
				var mySeq = ++seq;
				emit(Object.assign({}, state, { cwd: cwd, phase: cwd ? "loading" : "idle", error: null }));
				if (!cwd) return Promise.resolve();
				return Promise.all([
					verbs.status(cwd),
					verbs.branches(cwd),
					verbs.log(cwd)
				]).then(function (results) {
					if (mySeq !== seq) return;
					emit(applyData(cwd, results[0], results[1], results[2]));
				}).catch(function (error) {
					if (mySeq !== seq) return;
					emit(Object.assign(idleState(), {
						cwd: cwd,
						phase: "error",
						error: error && error.message ? String(error.message) : String(error),
						panelOpen: state.panelOpen
					}));
				});
			}

			function refresh(cwd) {
				if (inflight !== null && inflight.cwd === cwd) return inflight.promise;
				var promise = doRefresh(cwd);
				inflight = { cwd: cwd, promise: promise };
				promise.finally(function () {
					if (inflight !== null && inflight.cwd === cwd) inflight = null;
				}).catch(function () {});
				return promise;
			}

			/** Run one action; on success force a fresh load; surfaces lastResult. */
			function act(name, run) {
				emit(Object.assign({}, state, { busy: name, lastResult: null }));
				return run().then(function (res) {
					var result = res && res.ok === true
						? { kind: "ok", text: res.value && res.value.message ? String(res.value.message) : null }
						: { kind: "error", text: res && res.error && res.error.message ? String(res.error.message) : "operation failed" };
					emit(Object.assign({}, state, { busy: null, lastResult: result }));
					if (res && res.ok === true) {
						var cwd = state.cwd;
						return refresh(cwd);
					}
					return Promise.resolve();
				}).catch(function (error) {
					emit(Object.assign({}, state, {
						busy: null,
						lastResult: { kind: "error", text: error && error.message ? String(error.message) : String(error) }
					}));
				});
			}

			function setPanelOpen(open) {
				emit(Object.assign({}, state, { panelOpen: open === true }));
			}

			return {
				getSnapshot: getSnapshot,
				subscribe: subscribe,
				refresh: refresh,
				act: act,
				setPanelOpen: setPanelOpen,
				verbs: verbs
			};
		}

		/** Theme-matched colors for the native branch <select> dropdown list. */
		var OPTION_STYLE = {
			background: "var(--dsw-alias-bg-base, #1e1e1e)",
			color: "var(--dsw-alias-label-secondary, #c8ccd2)"
		};
		var OPTGROUP_STYLE = {
			background: "var(--dsw-alias-bg-base, #1e1e1e)",
			color: "var(--dsw-alias-label-tertiary, #9aa0a6)",
			fontWeight: 600
		};

		/** One branch option list; remote picks carry the DWIM-able short name. */
		function branchOptions(state, t) {
			var local = state.local.map(function (entry) {
				return h("option", { key: "l:" + entry.name, value: entry.name, style: OPTION_STYLE }, entry.name + (entry.current ? " ✓" : ""));
			});
			var remote = state.remote.map(function (entry) {
				return h("option", { key: "r:" + entry.name, value: entry.short, style: OPTION_STYLE }, entry.short);
			});
			var children = [];
			if (local.length > 0) children.push(h("optgroup", { key: "lg", label: t("group.local"), style: OPTGROUP_STYLE }, local));
			if (remote.length > 0) children.push(h("optgroup", { key: "rg", label: t("group.remote"), style: OPTGROUP_STYLE }, remote));
			return children;
		}

		/**
		 * Floating workbench entry (shell.overlay). Renders nothing while
		 * collapsed — the persistent status lives in the input.left pill, and
		 * this panel appears only when the user expands it from that pill.
		 * Follows the current session cwd.
		 */
		function GitFloatingPanel(props) {
			var store = props.store;
			var t = props.t || function (key, params) {
				return key + (params ? " " + JSON.stringify(params) : "");
			};
			var useSessions = props.useSessions;
			// useSessions is a selector hook (useSyncExternalStoreWithSelector):
			// the selector argument is REQUIRED — a bare useSessions() crashes
			// with "selector is not a function".
			var sessions = useSessions(function (s) { return s; });

			// NOTE: the shell's seed react-dom is an experimental 18.3.1-next
			// build where React.useSyncExternalStore misbehaves (returns
			// undefined / throws), so subscribe through the classic
			// useState + useEffect pattern instead — safe on any React.
			var stateRef = React.useState(function () { return store.getSnapshot(); });
			var state = stateRef[0];
			var setState = stateRef[1];
			React.useEffect(function () {
				var unsubscribe = store.subscribe(function () {
					setState(store.getSnapshot());
				});
				return unsubscribe;
			}, [store]);

			var currentId = sessions && sessions.current !== undefined ? sessions.current : undefined;
			var cwd = currentId !== undefined && sessions && sessions.byId ? (sessions.byId[currentId] || {}).cwd : undefined;

			React.useEffect(function () {
				if (cwd !== state.cwd) store.refresh(cwd);
			}, [cwd, store]);

			var messageRef = React.useState("");
			var message = messageRef[0];
			var setMessage = messageRef[1];
			var changesOpenRef = React.useState(false);
			var changesOpen = changesOpenRef[0];
			var setChangesOpen = changesOpenRef[1];
			var logOpenRef = React.useState(false);
			var logOpen = logOpenRef[0];
			var setLogOpen = logOpenRef[1];

			// Branch the user picked while the tree is dirty: the pre-check
			// shows a warning instead of switching immediately; the switch only
			// runs via the "switch anyway" button (or once the tree is clean).
			var pendingRef = React.useState(null);
			var pendingBranch = pendingRef[0];
			var setPendingBranch = pendingRef[1];

			// ── draggable panel (header is the drag handle) ─────────────
			// Default: centered above the composer (S.panel). After the first
			// drag, switch to explicit left/top so the panel stays where the
			// user dropped it. Double-click the header to snap back.
			var panelRef = React.useRef(null);
			var dragPosRef = React.useState(null);
			var dragPos = dragPosRef[0];
			var setDragPos = dragPosRef[1];

			function clampDragPos(left, top, width, height) {
				var vw = (typeof window !== "undefined" && window.innerWidth) || 1920;
				var vh = (typeof window !== "undefined" && window.innerHeight) || 1080;
				var w = width || 400;
				var hh = height || 200;
				var maxLeft = Math.max(0, vw - Math.min(w, 120));
				var maxTop = Math.max(0, vh - 40);
				return {
					left: Math.min(Math.max(0, left), maxLeft),
					top: Math.min(Math.max(0, top), maxTop)
				};
			}

			function onPanelHeaderMouseDown(event) {
				if (event.button !== undefined && event.button !== 0) return;
				var target = event.target;
				if (target && target.closest) {
					try { if (target.closest("button,select,input,textarea,a")) return; } catch (ignore) {}
				} else if (target && /^(BUTTON|SELECT|INPUT|TEXTAREA|A)$/.test(target.tagName || "")) {
					return;
				}
				var panelEl = panelRef.current;
				if (!panelEl || !panelEl.getBoundingClientRect) return;
				var doc = (typeof document !== "undefined") ? document : null;
				if (!doc || !doc.addEventListener) return;
				var rect = panelEl.getBoundingClientRect();
				var startX = event.clientX;
				var startY = event.clientY;
				var baseLeft = rect.left;
				var baseTop = rect.top;
				if (event.preventDefault) event.preventDefault();
				function onMove(e) {
					var c = clampDragPos(
						baseLeft + (e.clientX - startX),
						baseTop + (e.clientY - startY),
						rect.width, rect.height
					);
					setDragPos(c);
				}
				function onUp() {
					doc.removeEventListener("mousemove", onMove);
					doc.removeEventListener("mouseup", onUp);
					try { doc.body.style.userSelect = ""; doc.body.style.cursor = ""; } catch (ignore2) {}
				}
				doc.addEventListener("mousemove", onMove);
				doc.addEventListener("mouseup", onUp);
				try { doc.body.style.userSelect = "none"; doc.body.style.cursor = "grabbing"; } catch (ignore3) {}
			}

			function onPanelHeaderTouchStart(event) {
				var touches = event.touches;
				if (!touches || touches.length !== 1) return;
				var target = event.target;
				if (target && target.closest) {
					try { if (target.closest("button,select,input,textarea,a")) return; } catch (ignore) {}
				}
				var panelEl = panelRef.current;
				if (!panelEl || !panelEl.getBoundingClientRect) return;
				var doc = (typeof document !== "undefined") ? document : null;
				if (!doc || !doc.addEventListener) return;
				var rect = panelEl.getBoundingClientRect();
				var touch = touches[0];
				var startX = touch.clientX;
				var startY = touch.clientY;
				var baseLeft = rect.left;
				var baseTop = rect.top;
				function onMove(e) {
					var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
					if (!t) return;
					if (e.preventDefault) e.preventDefault();
					var c = clampDragPos(
						baseLeft + (t.clientX - startX),
						baseTop + (t.clientY - startY),
						rect.width, rect.height
					);
					setDragPos(c);
				}
				function onEnd() {
					doc.removeEventListener("touchmove", onMove);
					doc.removeEventListener("touchend", onEnd);
					doc.removeEventListener("touchcancel", onEnd);
				}
				doc.addEventListener("touchmove", onMove, { passive: false });
				doc.addEventListener("touchend", onEnd);
				doc.addEventListener("touchcancel", onEnd);
			}

			var panelStyle = dragPos ? Object.assign({}, S.panel, {
				left: dragPos.left,
				top: dragPos.top,
				bottom: "auto",
				transform: "none"
			}) : S.panel;

			if (!cwd || state.cwd !== cwd) {
				// No session yet (or rebinding): nothing floats over the input.
				return null;
			}

			var busy = state.busy;
			var busyLabel = busy ? t("busy." + busy) : null;

			// ── collapsed state: render nothing ─────────────────────────────
			// No floating bubble: the persistent status lives in the input.left
			// pill; this panel only appears when the user clicks that pill.
			if (!state.panelOpen) return null;

			// ── expanded panel ───────────────────────────────────────────────
			var header = h("div", {
				style: S.header,
				onMouseDown: onPanelHeaderMouseDown,
				onTouchStart: onPanelHeaderTouchStart,
				onDoubleClick: function () { setDragPos(null); },
				title: "拖动移动面板（双击复位）",
				"data-dsh-git": "panel-drag"
			}, [
				h("span", { key: "title", style: S.title }, "⎇ " + t("panel.title")),
				h("span", { key: "cwd", style: S.meta, title: cwd }, shortText(cwd, 60)),
				h("button", {
					key: "refresh",
					type: "button",
					style: S.button,
					disabled: busy !== null,
					onClick: function () { store.refresh(state.cwd); },
					"aria-label": t("refresh.aria"),
					title: t("refresh.aria")
				}, "↻"),
				h("button", {
					key: "collapse",
					type: "button",
					style: S.button,
					onClick: function () { store.setPanelOpen(false); },
					"aria-label": t("panel.collapse"),
					title: t("panel.collapse")
				}, "–")
			]);

			var bodyChildren = [];
			if (state.phase === "loading" || state.phase === "idle") {
				bodyChildren.push(h("div", { key: "loading", style: S.meta }, t("loading")));
			} else if (state.phase === "error") {
				bodyChildren.push(h("div", { key: "error", style: { color: "var(--dsw-alias-state-error-primary, #ef4444)", fontSize: 12, lineHeight: "18px" } }, shortText(state.error, 240)));
			} else if (!state.repo) {
				bodyChildren.push(h("div", { key: "norepo", style: S.meta }, t("notRepo")));
			} else {
				// status line
				var statusLine = [];
				var branchText = state.branch;
				if (!branchText && state.detached) {
					branchText = t("detached") + (state.oid ? " " + state.oid.slice(0, 7) : "");
				}
				statusLine.push(h("span", { key: "chip", style: S.chip, title: branchText || cwd }, branchText || "—"));
				if (state.dirty > 0) {
					statusLine.push(h("span", { key: "dirty", style: S.dirty, title: t("dirty", { count: state.dirty }) }, "● " + state.dirty));
				}
				if (state.ahead > 0 || state.behind > 0) {
					statusLine.push(h("span", { key: "ab", style: S.meta }, "↑" + state.ahead + " ↓" + state.behind));
				}
				if (state.upstream) {
					statusLine.push(h("span", { key: "up", style: S.meta, title: state.upstream }, shortText(state.upstream, 40)));
				}
				bodyChildren.push(h("div", { key: "status", style: S.row }, statusLine));

				// branch switcher — dirty-tree pre-check: selecting a branch while
				// the tree has uncommitted changes shows a warning instead of an
				// immediate switch; the user decides (commit/stash, or force).
				var selectChildren = [h("option", { key: "ph", value: "", disabled: true, style: OPTION_STYLE }, branchText || "—")];
				Array.prototype.push.apply(selectChildren, branchOptions(state, t));
				bodyChildren.push(h("div", { key: "branch", style: S.row }, [
					h("select", {
						key: "sel",
						style: S.select,
						value: state.branch || "",
						disabled: busy !== null,
						onChange: function (event) {
							var value = event.target.value;
							if (!value || value === state.branch) { setPendingBranch(null); return; }
							if (state.dirty > 0) { setPendingBranch(value); return; }
							store.act("checkout", function () { return store.verbs.checkout(state.cwd, value); });
						},
						"aria-label": t("switch.aria")
					}, selectChildren)
				]));
				if (pendingBranch !== null && state.dirty > 0) {
					var samplePaths = state.changes.slice(0, 3).map(function (change) { return change.path; }).join("、");
					if (samplePaths === "") samplePaths = "…";
					if (samplePaths.length > 60) samplePaths = samplePaths.slice(0, 57) + "…";
					bodyChildren.push(h("div", { key: "dirtywarn", style: S.warn }, [
						h("span", { key: "txt", style: { flex: "1", minWidth: 0 } },
							t("switch.dirtyWarn", { count: state.dirty, paths: samplePaths })),
						h("button", {
							key: "force",
							type: "button",
							style: Object.assign({}, S.button, busy !== null ? S.buttonDisabled : null),
							disabled: busy !== null,
							onClick: function () {
								var target = pendingBranch;
								setPendingBranch(null);
								store.act("checkout", function () { return store.verbs.checkout(state.cwd, target); });
							}
						}, busy === "checkout" ? t("busy.checkout") : t("switch.force"))
					]));
				}

				// network + commit row
				bodyChildren.push(h("div", { key: "net", style: S.row }, [
					h("button", {
						key: "fetch",
						type: "button",
						style: Object.assign({}, S.button, busy !== null ? S.buttonDisabled : null),
						disabled: busy !== null,
						onClick: function () { store.act("fetch", function () { return store.verbs.fetch(state.cwd); }); }
					}, busy === "fetch" ? t("busy.fetch") : t("action.fetch")),
					h("button", {
						key: "pull",
						type: "button",
						style: Object.assign({}, S.button, busy !== null ? S.buttonDisabled : null),
						disabled: busy !== null,
						onClick: function () { store.act("pull", function () { return store.verbs.pull(state.cwd); }); }
					}, busy === "pull" ? t("busy.pull") : t("action.pull")),
					h("button", {
						key: "push",
						type: "button",
						style: Object.assign({}, S.buttonPrimary, busy !== null ? S.buttonDisabled : null),
						disabled: busy !== null,
						onClick: function () { store.act("push", function () { return store.verbs.push(state.cwd); }); }
					}, busy === "push" ? t("busy.push") : t("action.push"))
				]));

				bodyChildren.push(h("div", { key: "commit", style: S.row }, [
					h("input", {
						key: "msg",
						type: "text",
						style: S.input,
						value: message,
						placeholder: t("commit.placeholder"),
						disabled: busy !== null,
						onChange: function (event) { setMessage(event.target.value); },
						onKeyDown: function (event) {
							if (event.key === "Enter" && message.trim() !== "" && busy === null) {
								doCommit();
							}
						}
					}),
					h("button", {
						key: "commit",
						type: "button",
						style: Object.assign({}, S.buttonPrimary, busy !== null || message.trim() === "" ? S.buttonDisabled : null),
						disabled: busy !== null || message.trim() === "",
						title: message.trim() === "" ? t("commit.empty") : undefined,
						onClick: doCommit
					}, busy === "commit" ? t("busy.commit") : t("action.commit"))
				]));

				function doCommit() {
					var text = message.trim();
					if (text === "" || busy !== null) return;
					setMessage("");
					store.act("commit", function () { return store.verbs.commit(state.cwd, text); });
				}

				// changes (diffstat) — collapsible
				var changesRow;
				if (state.changes.length === 0) {
					changesRow = h("div", { key: "none", style: S.meta }, t("changes.none"));
				} else {
					var shown = changesOpen ? state.changes : state.changes.slice(0, 8);
					changesRow = h("div", { key: "list" }, shown.map(function (change, index) {
						return h("div", { key: index, style: S.changeRow }, [
							h("span", { key: "tag", style: S.statusTag }, t("status." + change.status)),
							h("span", { key: "path", style: S.changePath, title: change.path }, change.path)
						]);
					}));
					if (state.changes.length > shown.length) {
						changesRow = h("div", { key: "list" }, [
							changesRow,
							h("button", {
								key: "more",
								type: "button",
								style: S.button,
								onClick: function () { setChangesOpen(!changesOpen); }
							}, changesOpen ? "▴" : "▾ " + (state.changes.length - shown.length))
						]);
					}
				}
				bodyChildren.push(h("div", { key: "changes", style: S.sectionTitle, onClick: function () { setChangesOpen(!changesOpen); } }, (changesOpen ? "▾ " : "▸ ") + t("changes.title", { count: state.changes.length })));
				bodyChildren.push(h("div", { key: "changesBody" }, changesRow));

				// recent commits — collapsible
				var logRows;
				if (state.commits.length === 0) {
					logRows = h("div", { key: "none", style: S.meta }, t("log.none"));
				} else {
					var logShown = logOpen ? state.commits : state.commits.slice(0, 5);
					logRows = h("div", { key: "list" }, logShown.map(function (commit, index) {
						return h("div", { key: index, style: S.logRow, title: commit.subject }, [
							h("span", { key: "sha", style: S.logSha }, commit.sha),
							h("span", { key: "subj", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1", minWidth: 0 } }, commit.subject)
						]);
					}));
					if (state.commits.length > logShown.length) {
						logRows = h("div", { key: "list" }, [
							logRows,
							h("button", {
								key: "more",
								type: "button",
								style: S.button,
								onClick: function () { setLogOpen(!logOpen); }
							}, logOpen ? "▴" : "▾ " + (state.commits.length - logShown.length))
						]);
					}
				}
				bodyChildren.push(h("div", { key: "logTitle", style: S.sectionTitle, onClick: function () { setLogOpen(!logOpen); } }, (logOpen ? "▾ " : "▸ ") + t("log.title")));
				bodyChildren.push(h("div", { key: "logBody" }, logRows));
			}

			// last operation output
			if (state.lastResult) {
				bodyChildren.push(h("div", {
					key: "output",
					style: Object.assign({}, S.output, state.lastResult.kind === "ok" ? S.outputOk : S.outputError)
				}, state.lastResult.text || t("output.ok")));
			}
			if (busy) {
				bodyChildren.push(h("div", { key: "busy", style: S.meta }, busyLabel));
			}

			return h("div", { "data-dsh-git": "panel", style: panelStyle, ref: panelRef }, [
				header,
				h("div", { key: "body", style: S.body }, bodyChildren)
			]);
		}

		/**
		 * Input-dock pill (conversation.input.dock): a compact status capsule,
		 * left-aligned above the composer card (textarea top-left); clicking
		 * toggles the workbench panel. Reads the same store, so it stays in
		 * sync with the panel and with session switches.
		 */
		function GitDockLine(props) {
			var store = props.store;
			var t = props.t || function (key, params) {
				return key + (params ? " " + JSON.stringify(params) : "");
			};
			var useSessions = props.useSessions;
			// useSessions is a selector hook (useSyncExternalStoreWithSelector):
			// the selector argument is REQUIRED — a bare useSessions() crashes
			// with "selector is not a function".
			var sessions = useSessions(function (s) { return s; });

			// Classic subscription pattern (see GitFloatingPanel for why).
			var stateRef = React.useState(function () { return store.getSnapshot(); });
			var state = stateRef[0];
			var setState = stateRef[1];
			React.useEffect(function () {
				var unsubscribe = store.subscribe(function () {
					setState(store.getSnapshot());
				});
				return unsubscribe;
			}, [store]);

			var currentId = sessions && sessions.current !== undefined ? sessions.current : undefined;
			var cwd = currentId !== undefined && sessions && sessions.byId ? (sessions.byId[currentId] || {}).cwd : undefined;

			React.useEffect(function () {
				if (cwd !== state.cwd) store.refresh(cwd);
			}, [cwd, store]);

			if (!cwd || state.cwd !== cwd) return null;

			var text;
			if (state.phase === "loading" || state.phase === "idle") {
				text = "⎇ " + t("loading");
			} else if (state.phase === "error" || !state.repo) {
				text = "⎇ " + t("notRepo");
			} else {
				var branchText = state.branch;
				if (!branchText && state.detached) {
					branchText = t("detached") + (state.oid ? " " + state.oid.slice(0, 7) : "");
				}
				text = "⎇ " + (branchText || "—");
				if (state.dirty > 0) text += " ●" + state.dirty;
				if (state.ahead > 0 || state.behind > 0) text += " ↑" + state.ahead + " ↓" + state.behind;
			}

			// Left-aligned compact pill in the row band ABOVE the composer card
			// (conversation.input.dock). The padding-left mirrors the centered
			// card's left margin, so the pill hugs the textarea's top-left
			// corner instead of floating at the conversation column's edge.
			return h("div", {
				style: {
					boxSizing: "border-box",
					display: "flex",
					justifyContent: "flex-start",
					width: "100%",
					paddingLeft: "calc((100% - var(--dsh-composer-card-max-width, 778px)) / 2)",
					margin: "2px 0"
				},
				"data-dsh-git": "dock-row"
			}, h("button", {
				type: "button",
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					maxWidth: 220,
					padding: "1px 10px",
					borderRadius: 999,
					border: "1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,0.25))",
					background: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.12))",
					color: "var(--dsw-alias-label-secondary, #c8ccd2)",
					font: "inherit",
					fontSize: 12,
					lineHeight: "20px",
					cursor: "pointer",
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis",
					userSelect: "none"
				},
				"data-dsh-git": "dock",
				title: cwd,
				"aria-label": t("dock.aria"),
				onClick: function () { store.setPanelOpen(!state.panelOpen); }
			}, text));
		}

		/**
		 * Client plugin body.
		 * @param ctx - client root context (slots, connection, locale).
		 */
		function apply(ctx) {
			ctx.effect(function () {
				return ctx.locale.register(NS, { zh: zh, en: en });
			}, "dsh-git: dictionaries");

			var store = createGitStore(ctx);

			ctx.slots.inject("shell.overlay", function () {
				return ctx.slots.register({
					name: "shell.overlay",
					id: "dsh-git-panel",
					order: 10,
					locale: NS,
					inject: function () {
						return { store: store };
					}
				}, GitFloatingPanel);
			});

			ctx.slots.inject("conversation.input.dock", function () {
				return ctx.slots.register({
					name: "conversation.input.dock",
					id: "dsh-git-pill",
					order: 20,
					locale: NS,
					inject: function (sessionId) {
						return { store: store };
					}
				}, GitDockLine);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
