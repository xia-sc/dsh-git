/**
 * @xia-sc/dsh-git — browser half (dsh.client bundle).
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
	id: "@xia-sc/dsh-git",
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
			"branch.new": "新建分支",
			"branch.newTitle": "从某个分支创建新分支",
			"newBranch.placeholder": "新分支名…",
			"newBranch.base": "基于分支",
			"newBranch.create": "创建并切换",
			"newBranch.cancel": "取消",
			"newBranch.empty": "请输入新分支名",
			"group.local": "本地分支",
			"group.remote": "远程分支",
			"loading": "读取中…",
			"notRepo": "当前工作区不是 Git 仓库",
			"detached": "游离 HEAD",
			"dirty": "{count} 个未提交更改",
			"aheadBehind": "领先 {ahead} / 落后 {behind}",
			"action.fetch": "拉取更新",
			"action.pull": "拉取合并",
			"action.stage": "暂存全部",
			"action.generate": "AI 生成",
			"action.commit": "提交",
			"action.push": "推送",
			"generate.mode.staged": "已暂存",
			"generate.mode.unstaged": "未暂存",
			"generate.mode.all": "全部",
			"generate.mode.title": "AI 生成的依据",
			"generate.noChanges": "没有可用的改动",
			"generate.done": "已生成提交信息",
			"generate.noStaged": "没有已暂存的改动，请先点「暂存全部」，或把生成依据改为「未暂存」「全部」",
			"generate.noProvider": "尚未配置模型，请先在 设置 > 模型 中添加",
			"generate.noModel": "该提供方没有可用模型",
			"generate.empty": "模型没有返回提交信息",
			"generate.cancelled": "生成已取消",
			"generate.failed": "生成失败",
			"commit.placeholder": "提交信息（可多行，Ctrl+Enter 提交）…",
			"commit.empty": "请输入提交信息",
			"changes.title": "变更（{count}）",
			"changes.none": "工作区干净",
			"diff.title": "差异",
			"diff.open": "查看差异",
			"diff.close": "关闭差异",
			"diff.resize": "拖动面板右边缘调整差异宽度（双击复位）",
			"diff.scope.worktree": "未暂存",
			"diff.scope.index": "已暂存",
			"diff.scope.title": "对比哪一侧",
			"diff.empty": "这一侧没有改动",
			"diff.emptyHint": "点「{other}」看另一侧",
			"diff.untracked": "未跟踪文件：与空文件对比",
			"diff.binary": "二进制文件，没有可显示的文本差异",
			"diff.truncated": "差异过大，只显示了开头一段",
			"diff.skipped": "另有 {count} 个未跟踪文件未展开",
			"diff.showAll": "显示全部（{count} 行）",
			"diff.wrap": "自动换行",
			"diff.copy": "复制差异",
			"diff.copied": "已复制",
			"diff.refresh": "重新读取差异",
			"diff.loading": "读取差异中…",
			"diff.failed": "读取差异失败",
			"log.title": "最近提交",
			"log.none": "暂无提交",
			"busy.fetch": "拉取中…",
			"busy.pull": "拉取合并中…",
			"busy.stage": "暂存中…",
			"busy.generate": "生成中…",
			"busy.commit": "提交中…",
			"busy.push": "推送中…",
			"busy.checkout": "切换中…",
			"busy.createBranch": "创建分支中…",
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
			"branch.new": "New branch",
			"branch.newTitle": "Create a new branch from a branch",
			"newBranch.placeholder": "New branch name…",
			"newBranch.base": "Base branch",
			"newBranch.create": "Create & switch",
			"newBranch.cancel": "Cancel",
			"newBranch.empty": "Enter a new branch name",
			"group.local": "Local",
			"group.remote": "Remote",
			"loading": "Loading…",
			"notRepo": "This workspace is not a git repository",
			"detached": "detached HEAD",
			"dirty": "{count} uncommitted change(s)",
			"aheadBehind": "{ahead} ahead / {behind} behind",
			"action.fetch": "Fetch",
			"action.pull": "Pull",
			"action.stage": "Stage all",
			"action.generate": "AI draft",
			"action.commit": "Commit",
			"action.push": "Push",
			"generate.mode.staged": "Staged",
			"generate.mode.unstaged": "Unstaged",
			"generate.mode.all": "Everything",
			"generate.mode.title": "What the draft is based on",
			"generate.noChanges": "No changes to draft from",
			"generate.done": "Draft ready",
			"generate.noStaged": "Nothing is staged yet — use Stage all first, or switch the basis to Unstaged / Everything",
			"generate.noProvider": "No model is configured — add one in Settings > Models",
			"generate.noModel": "That provider advertises no model",
			"generate.empty": "The model returned no commit message",
			"generate.cancelled": "Draft cancelled",
			"generate.failed": "Draft failed",
			"commit.placeholder": "Commit message (multi-line allowed, Ctrl+Enter commits)…",
			"commit.empty": "Enter a commit message",
			"changes.title": "Changes ({count})",
			"changes.none": "Working tree clean",
			"diff.title": "Diff",
			"diff.open": "View diff",
			"diff.close": "Close diff",
			"diff.resize": "Drag the panel's right edge to resize the diff (double-click resets)",
			"diff.scope.worktree": "Unstaged",
			"diff.scope.index": "Staged",
			"diff.scope.title": "Which side to compare",
			"diff.empty": "Nothing changed on this side",
			"diff.emptyHint": "Pick “{other}” to see the other side",
			"diff.untracked": "Untracked file: compared against the empty blob",
			"diff.binary": "Binary file — there is no text diff to show",
			"diff.truncated": "Diff too large — only the beginning is shown",
			"diff.skipped": "{count} more untracked file(s) were not expanded",
			"diff.showAll": "Show all ({count} lines)",
			"diff.wrap": "Wrap lines",
			"diff.copy": "Copy diff",
			"diff.copied": "Copied",
			"diff.refresh": "Reload the diff",
			"diff.loading": "Loading the diff…",
			"diff.failed": "Could not read the diff",
			"log.title": "Recent commits",
			"log.none": "No commits yet",
			"busy.fetch": "Fetching…",
			"busy.pull": "Pulling…",
			"busy.stage": "Staging…",
			"busy.generate": "Drafting…",
			"busy.commit": "Committing…",
			"busy.push": "Pushing…",
			"busy.checkout": "Switching…",
			"busy.createBranch": "Creating branch…",
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
				// border-box so `width` below is the OUTER width: the two-pane math
				// (workbench + splitter + diff) and the viewport clamp both count
				// real pixels, and a content-box width silently added the border on
				// top of them.
				boxSizing: "border-box",
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
				touchAction: "none",
				// Painted above the right-edge resize handle, which spans the panel's
				// full height: the header's drag gesture and its buttons own that band.
				position: "relative",
				zIndex: 1
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
			// The commit message is a real multi-line field: an <input type=text>
			// silently strips every line feed, so a drafted subject+body would lose
			// its body before the request was ever sent.
			textarea: {
				background: "transparent",
				border: "1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,0.25))",
				borderRadius: 8,
				color: "var(--dsw-alias-label-primary, #e5e7eb)",
				font: "inherit",
				fontSize: 12,
				lineHeight: "18px",
				padding: "4px 8px",
				flex: "1",
				minWidth: 0,
				outline: "none",
				resize: "vertical",
				overflowY: "auto"
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
				padding: "1px 6px",
				margin: "0 -6px",
				borderRadius: 6,
				minWidth: 0,
				cursor: "pointer"
			},
			changePath: {
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				flex: "1",
				minWidth: 0
			},
			// A change row is the diff viewer's navigation: it has to read as a
			// control, and to show which file the right-hand pane is showing.
			changeRowActive: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 12,
				lineHeight: "20px",
				color: "var(--dsw-alias-label-primary, #e5e7eb)",
				padding: "1px 6px",
				margin: "0 -6px",
				borderRadius: 6,
				minWidth: 0,
				cursor: "pointer",
				background: "var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,0.18))"
			},
			// ── two-pane (changes + diff) layout ────────────────────────────
			// `bodySplit` replaces `body` while a file is selected: the left pane
			// keeps the whole workbench, the splitter is the width handle, and the
			// diff pane owns its own header + scrollport.
			bodySplit: {
				flex: "1",
				minHeight: 0,
				display: "flex",
				flexDirection: "row",
				overflow: "hidden"
			},
			leftPane: {
				flex: "none",
				// border-box: DIFF_LEFT_PANE_WIDTH is the room the workbench really
				// takes, so the pane width math and the panel edge agree.
				boxSizing: "border-box",
				width: 300,
				minWidth: 0,
				padding: "10px 12px 12px",
				// The two panes are separated by this edge instead of a draggable
				// divider: the width handle is the panel's own right edge.
				borderRight: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2))",
				overflowY: "auto"
			},
			// The panel's right edge, as the diff's width handle (the whole panel
			// grows with it; the workbench keeps its width).
			resizeHandle: {
				position: "absolute",
				top: 0,
				right: 0,
				bottom: 0,
				width: 6,
				cursor: "col-resize",
				touchAction: "none",
				background: "transparent"
			},
			resizeHandleActive: {
				background: "var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,0.3))"
			},
			diffPane: {
				flex: "1",
				minWidth: 0,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden"
			},
			diffHeader: {
				flex: "none",
				display: "flex",
				alignItems: "center",
				gap: 6,
				flexWrap: "wrap",
				padding: "8px 10px",
				borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2))"
			},
			diffPath: {
				flex: "1 1 auto",
				minWidth: 0,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				fontSize: 12,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, #e5e7eb)"
			},
			scopeChip: {
				flex: "none",
				lineHeight: "18px",
				padding: "0 8px",
				borderRadius: 999,
				border: "1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,0.25))",
				background: "transparent",
				color: "var(--dsw-alias-label-tertiary, #9aa0a6)",
				font: "inherit",
				fontSize: 11,
				cursor: "pointer"
			},
			scopeChipActive: {
				flex: "none",
				lineHeight: "18px",
				padding: "0 8px",
				borderRadius: 999,
				border: "1px solid transparent",
				background: "var(--dsw-alias-surface-tertiary, rgba(127,127,127,0.18))",
				color: "var(--dsw-alias-label-primary, #e5e7eb)",
				font: "inherit",
				fontSize: 11,
				cursor: "pointer"
			},
			diffScroll: {
				flex: "1",
				minHeight: 0,
				overflow: "auto",
				padding: "6px 0"
			},
			diffRow: {
				display: "flex",
				alignItems: "flex-start",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: 12,
				lineHeight: "18px",
				// `max-content` keeps a long line's row as wide as its text, so the
				// added/removed background runs the whole length of the horizontal
				// scroll. `diffRowView` drops it to 0 when wrapping is on, where it
				// would otherwise prevent the wrap from ever firing.
				minWidth: "max-content",
				width: "100%"
			},
			diffGutter: {
				flex: "none",
				width: 34,
				textAlign: "right",
				paddingRight: 6,
				color: "var(--dsw-alias-label-quaternary, #6b7280)",
				userSelect: "none",
				WebkitUserSelect: "none"
			},
			diffText: {
				flex: "1",
				minWidth: 0,
				paddingRight: 12,
				tabSize: 4,
				whiteSpace: "pre"
			},
			diffAddRow: {
				background: "rgba(52,199,89,0.14)",
				color: "var(--dsw-alias-state-success-primary, #34c759)"
			},
			diffDelRow: {
				background: "rgba(239,68,68,0.14)",
				color: "var(--dsw-alias-state-error-primary, #ef4444)"
			},
			diffHunkRow: {
				background: "rgba(79,140,255,0.12)",
				color: "var(--dsw-alias-state-business-primary, #4f8cff)"
			},
			diffMetaRow: {
				color: "var(--dsw-alias-label-quaternary, #6b7280)"
			},
			diffNotice: {
				margin: "6px 10px",
				padding: "6px 8px",
				borderRadius: 8,
				fontSize: 12,
				lineHeight: "18px",
				background: "var(--dsw-alias-surface-tertiary, rgba(127,127,127,0.12))",
				color: "var(--dsw-alias-label-secondary, #c8ccd2)"
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
				createBranch: function (cwd, branch, base) { return rpc(ctx, "createBranch", { cwd: cwd, branch: branch, base: base }); },
				fetch: function (cwd) { return rpc(ctx, "fetch", { cwd: cwd }); },
				pull: function (cwd) { return rpc(ctx, "pull", { cwd: cwd }); },
				stage: function (cwd) { return rpc(ctx, "stage", { cwd: cwd }); },
				diff: function (cwd, file, origFile) {
					return rpc(ctx, "diff", { cwd: cwd, path: file, origPath: origFile });
				},
				commit: function (cwd, message) { return rpc(ctx, "commit", { cwd: cwd, message: message }); },
				push: function (cwd) { return rpc(ctx, "push", { cwd: cwd }); },
				log: function (cwd) { return rpc(ctx, "log", { cwd: cwd, count: 10 }); },
				generateMessage: function (cwd, mode, provider, model) {
					return rpc(ctx, "generateMessage", { cwd: cwd, mode: mode, provider: provider, model: model });
				}
			};

			/**
			 * The Session this store follows. The session-scoped seat (the input
			 * dock) binds it; dsh >= 0.1.6 removed `current` from the sessions
			 * list snapshot, so the root-scoped panel can no longer find the
			 * current Session by itself and follows this field instead.
			 */
			var sessionId = null;

			function idleState() {
				return {
					sessionId: sessionId,
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
				// A reload is passive: it must not erase the last operation's
				// output line, which `act()` sets *before* refreshing.
				if (sv === null) {
					return Object.assign(idleState(), {
						cwd: nextCwd,
						phase: "error",
						error: status && status.error ? String(status.error.message || "git status failed") : "git status failed",
						panelOpen: state.panelOpen,
						lastResult: state.lastResult
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
					panelOpen: state.panelOpen,
					lastResult: state.lastResult
				});
			}

			function doRefresh(cwd) {
				var mySeq = ++seq;
				emit(Object.assign({}, state, { sessionId: sessionId, cwd: cwd, phase: cwd ? "loading" : "idle", error: null }));
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
						panelOpen: state.panelOpen,
						lastResult: state.lastResult
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

			/**
			 * Bind the store to one Session and its workspace directory. The
			 * session-scoped seat calls this with the identity and cwd the
			 * framework gave it (`sessionId` slot prop + the sessions list it
			 * reads through `useSessions`); everything else — the root-scoped
			 * panel included — then reads the shared store.
			 * @param id - the Session identity, or undefined/null for "none".
			 * @param cwd - that Session's workspace directory, when it has one.
			 * @returns the refresh promise, so tests can await the first load.
			 */
			function bindSession(id, cwd) {
				var nextId = typeof id === "string" && id !== "" ? id : null;
				var nextCwd = typeof cwd === "string" && cwd !== "" ? cwd : null;
				if (nextId === sessionId && nextCwd === state.cwd) return undefined;
				sessionId = nextId;
				if (nextCwd === state.cwd) {
					// Two Sessions can share one workspace: the cwd is unchanged,
					// but the identity the panel resolves its model route from is
					// not, so publish it without another load.
					emit(Object.assign({}, state, { sessionId: sessionId }));
					return undefined;
				}
				return refresh(nextCwd);
			}

			/**
			 * Run one action; on success force a fresh load; surfaces lastResult.
			 * `describe` lets a caller own the wording of both outcomes (used by
			 * generation, where the success value is the message itself and a
			 * failure code maps to a localized string). Resolves with the raw
			 * RPC result so the caller can also act on it.
			 */
			function act(name, run, describe) {
				emit(Object.assign({}, state, { busy: name, lastResult: null }));
				return run().then(function (res) {
					var result = describe
						? describe(res)
						: res && res.ok === true
							? { kind: "ok", text: res.value && res.value.message ? String(res.value.message) : null }
							: { kind: "error", text: res && res.error && res.error.message ? String(res.error.message) : "operation failed" };
					emit(Object.assign({}, state, { busy: null, lastResult: result }));
					if (res && res.ok === true) {
						var cwd = state.cwd;
						return refresh(cwd).then(function () { return res; });
					}
					return res;
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
				bindSession: bindSession,
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
		 * Base-branch options for "new branch from…": local branch names plus
		 * the FULL remote-tracking refs (e.g. `origin/feature/x`) so the host
		 * can resolve them directly as the start point.
		 */
		function baseOptions(state, t) {
			var local = state.local.map(function (entry) {
				return h("option", { key: "l:" + entry.name, value: entry.name, style: OPTION_STYLE }, entry.name + (entry.current ? " ✓" : ""));
			});
			var remote = state.remote.map(function (entry) {
				return h("option", { key: "r:" + entry.name, value: entry.name, style: OPTION_STYLE }, entry.name);
			});
			var children = [];
			if (local.length > 0) children.push(h("optgroup", { key: "lg", label: t("group.local"), style: OPTGROUP_STYLE }, local));
			if (remote.length > 0) children.push(h("optgroup", { key: "rg", label: t("group.remote"), style: OPTGROUP_STYLE }, remote));
			return children;
		}

		/** The row kinds one parsed unified diff can produce. */
		var DIFF_ROW = {
			context: "context",
			add: "add",
			del: "del",
			hunk: "hunk",
			fileHeader: "fileHeader",
			meta: "meta",
			noNewline: "noNewline"
		};

		/** git's own bookkeeping lines, recognized only OUTSIDE a hunk. */
		var DIFF_FILE_HEADER = /^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|old mode |new mode |similarity index|dissimilarity index|rename from |rename to |copy from |copy to |Binary files |GIT binary patch)/;

		/**
		 * Parse one unified diff into renderable rows.
		 *
		 * Line numbers are tracked from each hunk header, so every content row
		 * carries the old and/or the new number it belongs to. `--- `/`+++ ` count
		 * as file headers only outside a hunk: a deleted line whose own text starts
		 * with `--` looks exactly like one, and misreading it would silently drop a
		 * real change.
		 * @param text - unified diff text (several files may be concatenated).
		 * @returns `{ rows, additions, deletions, hunks }`.
		 */
		function parseUnifiedDiff(text) {
			var rows = [];
			var additions = 0;
			var deletions = 0;
			var hunks = 0;
			var oldLine = 0;
			var newLine = 0;
			var inHunk = false;
			var lines = String(text === undefined || text === null ? "" : text).split("\n");
			for (var i = 0; i < lines.length; i += 1) {
				var line = lines[i];
				// git ends a patch with a newline, so the split leaves one empty tail.
				if (i === lines.length - 1 && line === "") continue;
				if (line.indexOf("diff --git ") === 0) {
					inHunk = false;
					rows.push({ kind: DIFF_ROW.fileHeader, text: line, oldLine: null, newLine: null });
					continue;
				}
				if (line.indexOf("@@") === 0) {
					var match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
					if (match !== null) {
						oldLine = Number(match[1]);
						newLine = Number(match[2]);
					}
					hunks += 1;
					inHunk = true;
					rows.push({ kind: DIFF_ROW.hunk, text: line, oldLine: null, newLine: null });
					continue;
				}
				if (!inHunk && DIFF_FILE_HEADER.test(line)) {
					rows.push({ kind: DIFF_ROW.fileHeader, text: line, oldLine: null, newLine: null });
					continue;
				}
				if (line.charAt(0) === "\\") {
					rows.push({ kind: DIFF_ROW.noNewline, text: line, oldLine: null, newLine: null });
					continue;
				}
				var marker = line.charAt(0);
				if (marker === "+") {
					rows.push({ kind: DIFF_ROW.add, text: line.slice(1), oldLine: null, newLine: newLine });
					newLine += 1;
					additions += 1;
				} else if (marker === "-") {
					rows.push({ kind: DIFF_ROW.del, text: line.slice(1), oldLine: oldLine, newLine: null });
					oldLine += 1;
					deletions += 1;
				} else if (marker === " ") {
					rows.push({ kind: DIFF_ROW.context, text: line.slice(1), oldLine: oldLine, newLine: newLine });
					oldLine += 1;
					newLine += 1;
				} else {
					rows.push({ kind: DIFF_ROW.meta, text: line, oldLine: null, newLine: null });
				}
			}
			return { rows: rows, additions: additions, deletions: deletions, hunks: hunks };
		}

		/**
		 * Turn one side of the host's `diff` value into render state: the parsed
		 * rows plus the flags that decide which notices the pane shows. Parsing
		 * happens once per read, not per render, because a diff may be large.
		 * @param side - `{ diff, binary, truncated }` as the host sent it.
		 */
		function parseDiffSide(side) {
			var data = side !== null && typeof side === "object" ? side : {};
			var text = typeof data.diff === "string" ? data.diff : "";
			var parsed = parseUnifiedDiff(text);
			return {
				empty: text.trim() === "",
				binary: data.binary === true,
				truncated: data.truncated === true,
				text: text,
				rows: parsed.rows,
				additions: parsed.additions,
				deletions: parsed.deletions,
				hunks: parsed.hunks
			};
		}

		/** Rows rendered at once before the pane offers "show all". */
		var DIFF_RENDER_MAX = 1500;
		/** Width of the diff pane when a file is opened, and its readable floor. */
		var DIFF_DEFAULT_WIDTH = 560;
		var DIFF_MIN_WIDTH = 240;
		/** Width of the workbench pane, the panel's own border, and its viewport margin. */
		var DIFF_LEFT_PANE_WIDTH = 300;
		var PANEL_BORDER_WIDTH = 2;
		var PANEL_MARGIN = 24;
		/** Grab width of the panel's right-edge resize handle. */
		var PANEL_RESIZE_GRIP = 6;

		/** The last path segment, for chip-sized text. */
		function baseName(file) {
			var text = String(file === undefined || file === null ? "" : file);
			var slash = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
			return slash === -1 ? text : text.slice(slash + 1);
		}

		/**
		 * One row of the diff body: the two line-number gutters, then the text.
		 * Colours come from the theme's state tokens (with rgba fallbacks), so the
		 * added/removed rows stay readable in both light and dark themes.
		 * @param row - a row from `parseUnifiedDiff`.
		 * @param key - React key.
		 * @param wrap - whether long lines wrap instead of scrolling.
		 */
		function diffRowView(row, key, wrap) {
			var style = Object.assign({}, S.diffRow);
			// Unwrapped rows take their natural width so the horizontal scroll runs
			// the patch's full length; a wrapped row must NOT keep `max-content`,
			// or the row stays as wide as its longest line.
			if (wrap === true) style = Object.assign(style, { minWidth: 0 });
			if (row.kind === DIFF_ROW.add) style = Object.assign(style, S.diffAddRow);
			else if (row.kind === DIFF_ROW.del) style = Object.assign(style, S.diffDelRow);
			else if (row.kind === DIFF_ROW.hunk) style = Object.assign(style, S.diffHunkRow);
			else if (row.kind !== DIFF_ROW.context) style = Object.assign(style, S.diffMetaRow);
			var code = row.kind === DIFF_ROW.add ? "+" : row.kind === DIFF_ROW.del ? "-" : row.kind === DIFF_ROW.context ? " " : "";
			var text = code === "" ? row.text : code + row.text;
			// The wrap belongs on the TEXT span: `S.diffText` carries its own
			// `white-space: pre`, which would win over the row's value and leave a
			// wrapped row overflowing anyway.
			var textStyle = wrap === true
				? Object.assign({}, S.diffText, { whiteSpace: "pre-wrap", wordBreak: "break-word" })
				: S.diffText;
			return h("div", {
				key: key,
				style: style,
				"data-dsh-git": "diff-row",
				"data-kind": row.kind
			}, [
				h("span", { key: "old", style: S.diffGutter }, row.oldLine === null || row.oldLine === undefined ? "" : String(row.oldLine)),
				h("span", { key: "new", style: S.diffGutter }, row.newLine === null || row.newLine === undefined ? "" : String(row.newLine)),
				h("span", { key: "text", style: textStyle }, text)
			]);
		}

		/**
		 * The right-hand pane of the workbench: one changed file's unified diff.
		 *
		 * The pane owns its own reads, because its inputs are the selected path
		 * plus a data version the panel computes from the store (staging,
		 * committing, switching a branch, or refreshing all change it, so the open
		 * diff follows the repository without the user clicking anything). The side
		 * of the index shown follows the data by default — unstaged when it has
		 * anything, staged otherwise — and an explicit pick sticks until the file
		 * changes (the panel remounts this pane per file with a React key).
		 *
		 * @param props - `{ store, t, cwd, change, dataVersion, onClose }`.
		 */
		function GitDiffPane(props) {
			var store = props.store;
			var t = props.t;
			var cwd = props.cwd;
			var change = props.change;
			var dataVersion = props.dataVersion;
			var onClose = props.onClose;

			var readRef = React.useState({ phase: "loading", error: null, value: null, worktree: null, index: null });
			var read = readRef[0];
			var setRead = readRef[1];
			// null = follow the data (unstaged if it has anything, else staged).
			var scopeRef = React.useState(null);
			var scope = scopeRef[0];
			var setScope = scopeRef[1];
			var wrapRef = React.useState(false);
			var wrap = wrapRef[0];
			var setWrap = wrapRef[1];
			var copiedRef = React.useState(false);
			var copied = copiedRef[0];
			var setCopied = copiedRef[1];
			var showAllRef = React.useState(false);
			var showAll = showAllRef[0];
			var setShowAll = showAllRef[1];
			var nonceRef = React.useState(0);
			var nonce = nonceRef[0];
			var setNonce = nonceRef[1];
			var seqRef = React.useRef(0);
			var copiedTimer = React.useRef(null);

			var file = change ? change.file : null;
			var origFile = change ? change.origFile : null;

			// One effect owns the read: it bumps the sequence, shows the loading
			// state, and only the newest answer is allowed to land (a stale reply
			// from a previously selected file must never be rendered).
			React.useEffect(function () {
				if (!cwd || !file) return;
				var mySeq = seqRef.current + 1;
				seqRef.current = mySeq;
				setRead({ phase: "loading", error: null, value: null, worktree: null, index: null });
				store.verbs.diff(cwd, file, origFile).then(function (res) {
					if (seqRef.current !== mySeq) return;
					if (!res || res.ok !== true) {
						var message = res && res.error && res.error.message ? String(res.error.message) : t("diff.failed");
						setRead({ phase: "error", error: message, value: null, worktree: null, index: null });
						return;
					}
					var value = res.value !== null && typeof res.value === "object" ? res.value : {};
					if (value.repo === false) {
						setRead({ phase: "error", error: t("notRepo"), value: null, worktree: null, index: null });
						return;
					}
					setRead({
						phase: "ready",
						error: null,
						value: value,
						worktree: parseDiffSide(value.worktree),
						index: parseDiffSide(value.index)
					});
				}).catch(function (error) {
					if (seqRef.current !== mySeq) return;
					setRead({
						phase: "error",
						error: error && error.message ? String(error.message) : t("diff.failed"),
						value: null,
						worktree: null,
						index: null
					});
				});
			}, [cwd, file, origFile, dataVersion, nonce, store]);

			React.useEffect(function () {
				return function () {
					if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
				};
			}, []);

			if (!change || !cwd) return null;

			var worktree = read.worktree;
			var index = read.index;
			var autoScope = worktree !== null && worktree.empty === false ? "worktree" : "index";
			var side = scope === null ? autoScope : scope;
			var active = side === "index" ? index : worktree;
			var otherLabel = side === "index" ? t("diff.scope.worktree") : t("diff.scope.index");
			var pathText = change.path ? String(change.path) : String(change.file);

			function pickScope(kind) {
				setScope(kind);
				setShowAll(false);
			}

			/**
			 * One side chip. A side with nothing in it stays visible — the pair has
			 * to read as a switch — but cannot be picked while it is the other chip.
			 */
			function scopeChip(kind) {
				var target = kind === "index" ? index : worktree;
				var isEmpty = target === null || target.empty === true;
				var isActive = side === kind;
				if (isEmpty && !isActive) {
					return h("button", {
						key: "scope-" + kind,
						type: "button",
						"data-dsh-git": "diff-scope-" + kind,
						"aria-pressed": false,
						style: Object.assign({}, S.scopeChip, { opacity: 0.45, cursor: "default" }),
						disabled: true,
						title: t("diff.empty")
					}, t("diff.scope." + kind));
				}
				return h("button", {
					key: "scope-" + kind,
					type: "button",
					"data-dsh-git": "diff-scope-" + kind,
					style: isActive ? S.scopeChipActive : S.scopeChip,
					title: t("diff.scope.title"),
					"aria-pressed": isActive,
					onClick: function () { pickScope(kind); }
				}, t("diff.scope." + kind));
			}

			function doCopy() {
				var text = active !== null && typeof active.text === "string" ? active.text : "";
				var clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
				if (text === "" || !clipboard || typeof clipboard.writeText !== "function") return;
				clipboard.writeText(text).then(function () {
					setCopied(true);
					if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
					copiedTimer.current = setTimeout(function () { setCopied(false); }, 1500);
				}).catch(function () {});
			}

			var headerChildren = [
				h("span", { key: "path", style: S.diffPath, title: String(change.file) }, shortText(pathText, 90)),
				h("span", { key: "status", style: S.statusTag }, t("status." + change.status))
			];
			if (read.phase === "ready" && active !== null && active.empty === false) {
				headerChildren.push(h("span", { key: "stat", style: S.meta }, "+" + active.additions + " −" + active.deletions));
			}
			headerChildren.push(h("button", {
				key: "close",
				type: "button",
				style: S.button,
				title: t("diff.close"),
				"aria-label": t("diff.close"),
				"data-dsh-git": "diff-close",
				onClick: onClose
			}, "×"));
			headerChildren.push(h("div", {
				key: "tools",
				style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flexBasis: "100%", marginTop: 2 }
			}, [
				scopeChip("worktree"),
				scopeChip("index"),
				h("button", {
					key: "wrap",
					type: "button",
					"data-dsh-git": "diff-wrap",
					style: wrap === true ? S.scopeChipActive : S.scopeChip,
					title: t("diff.wrap"),
					"aria-pressed": wrap === true,
					onClick: function () { setWrap(!wrap); }
				}, t("diff.wrap")),
				h("button", {
					key: "copy",
					type: "button",
					"data-dsh-git": "diff-copy",
					style: S.scopeChip,
					title: t("diff.copy"),
					onClick: doCopy
				}, copied === true ? t("diff.copied") : t("diff.copy")),
				h("button", {
					key: "reload",
					type: "button",
					"data-dsh-git": "diff-reload",
					style: S.scopeChip,
					title: t("diff.refresh"),
					"aria-label": t("diff.refresh"),
					onClick: function () { setNonce(nonce + 1); }
				}, "↻")
			]));

			var bodyChildren = [];
			if (read.phase === "loading") {
				bodyChildren.push(h("div", { key: "loading", style: S.diffNotice }, t("diff.loading")));
			} else if (read.phase === "error") {
				bodyChildren.push(h("div", { key: "error", style: Object.assign({}, S.diffNotice, S.outputError) }, shortText(read.error, 240)));
			} else if (active !== null) {
				var value = read.value !== null && typeof read.value === "object" ? read.value : {};
				if (value.untracked === true) {
					bodyChildren.push(h("div", { key: "untracked", style: S.diffNotice, "data-dsh-git": "diff-untracked" }, t("diff.untracked")));
				}
				if (typeof value.skipped === "number" && value.skipped > 0) {
					bodyChildren.push(h("div", { key: "skipped", style: S.diffNotice }, t("diff.skipped", { count: value.skipped })));
				}
				if (active.truncated === true) {
					bodyChildren.push(h("div", { key: "truncated", style: S.diffNotice }, t("diff.truncated")));
				}
				if (active.binary === true) {
					bodyChildren.push(h("div", { key: "binary", style: S.diffNotice, "data-dsh-git": "diff-binary" }, t("diff.binary")));
				} else if (active.empty === true) {
					bodyChildren.push(h("div", {
						key: "empty",
						style: S.diffNotice,
						"data-dsh-git": "diff-empty"
					}, t("diff.empty") + " · " + t("diff.emptyHint", { other: otherLabel })));
				} else {
					var clipped = active.rows.length > DIFF_RENDER_MAX && showAll !== true;
					var visible = clipped ? active.rows.slice(0, DIFF_RENDER_MAX) : active.rows;
					for (var i = 0; i < visible.length; i += 1) {
						bodyChildren.push(diffRowView(visible[i], "r" + i, wrap === true));
					}
					if (clipped) {
						bodyChildren.push(h("button", {
							key: "all",
							type: "button",
							style: Object.assign({}, S.button, { margin: "8px 10px" }),
							onClick: function () { setShowAll(true); }
						}, t("diff.showAll", { count: active.rows.length })));
					}
				}
			}

			return h("div", { style: S.diffPane, "data-dsh-git": "diff" }, [
				h("div", { key: "head", style: S.diffHeader, "data-dsh-git": "diff-header" }, headerChildren),
				h("div", { key: "scroll", style: S.diffScroll, "data-dsh-git": "diff-body" }, bodyChildren)
			]);
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

			// The session-scoped pill owns the session → cwd binding; this
			// root-scoped seat follows the shared store. dsh >= 0.1.6 no longer
			// carries `current` in the sessions list snapshot — it now selects
			// the current Session through the renderer's scope adapter, which a
			// root-scoped entry cannot read — so `state.sessionId` is the only
			// identity reachable from here.
			var cwd = state.cwd;
			var sessionId = state.sessionId;
			var currentSummary = sessionId !== null && sessions && sessions.byId ? sessions.byId[sessionId] : undefined;

			// The session's own model route, when one is recorded: the durable
			// `modelSelection` projection, pending pick first, last used second.
			// Generation falls back to the host's first registered route.
			var sessionRoute = (function () {
				var selection = currentSummary && currentSummary.projectionValues ? currentSummary.projectionValues.modelSelection : undefined;
				if (!selection) return null;
				var effective = selection.next || selection.lastUsed;
				if (!effective || !effective.provider || !effective.model) return null;
				return { provider: effective.provider, model: effective.model };
			})();

			var messageRef = React.useState("");
			var message = messageRef[0];
			var setMessage = messageRef[1];
			// Draft basis. `staged` is the default because it is the only basis
			// whose content is what the commit below will actually record.
			var generateModeRef = React.useState("staged");
			var generateMode = generateModeRef[0];
			var setGenerateMode = generateModeRef[1];
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

			// "New branch from…" form state: open flag, the new branch name
			// being typed, and the base branch explicitly picked by the user
			// (null = default to the current branch on first open).
			var newBranchOpenRef = React.useState(false);
			var newBranchOpen = newBranchOpenRef[0];
			var setNewBranchOpen = newBranchOpenRef[1];
			var newBranchNameRef = React.useState("");
			var newBranchName = newBranchNameRef[0];
			var setNewBranchName = newBranchNameRef[1];
			var newBranchBaseRef = React.useState(null);
			var newBranchBase = newBranchBaseRef[0];
			var setNewBranchBase = newBranchBaseRef[1];

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

			// ── diff viewer state ───────────────────────────────────────────
			// `selected` is the change the right-hand pane is showing (null = the
			// panel is the plain single-column workbench), `diffWidth` is that
			// pane's width, and the PANEL'S RIGHT EDGE is its handle.
			var selectedRef = React.useState(null);
			var selected = selectedRef[0];
			var setSelected = selectedRef[1];
			var diffWidthRef = React.useState(DIFF_DEFAULT_WIDTH);
			var diffWidth = diffWidthRef[0];
			var setDiffWidth = diffWidthRef[1];
			var resizeHoverRef = React.useState(false);
			var resizeHover = resizeHoverRef[0];
			var setResizeHover = resizeHoverRef[1];

			/**
			 * Widen the pane only as far as the viewport allows.
			 * @param value - the wanted diff width.
			 * @param anchor - the left edge to grow from; defaults to the panel's
			 * current position, or to a symmetric margin while it is centred.
			 */
			function clampDiffWidth(value, anchor) {
				var vw = (typeof window !== "undefined" && window.innerWidth) || 1920;
				var pos = anchor !== undefined ? anchor : dragPos;
				var room = pos === null || pos === undefined ? vw - PANEL_MARGIN : vw - 12 - pos.left;
				var available = room - DIFF_LEFT_PANE_WIDTH - PANEL_BORDER_WIDTH;
				return Math.min(Math.max(DIFF_MIN_WIDTH, Math.round(value)), Math.max(DIFF_MIN_WIDTH, available));
			}

			/**
			 * Start a width drag on the panel's right edge.
			 *
			 * The panel is anchored to its CURRENT left edge first: while it is
			 * centred, widening it moves the right edge by half the growth, so a
			 * centred panel would lag behind the pointer by 2×. Anchoring makes the
			 * edge follow the mouse exactly, and leaves the panel where the user
			 * found it.
			 */
			function onPanelResizeMouseDown(event) {
				if (event.button !== undefined && event.button !== 0) return;
				var doc = (typeof document !== "undefined") ? document : null;
				if (!doc || !doc.addEventListener) return;
				var el = panelRef.current;
				if (!el || !el.getBoundingClientRect) return;
				var rect = el.getBoundingClientRect();
				var anchor = { left: rect.left, top: rect.top };
				var startX = event.clientX;
				var base = diffWidth;
				if (event.preventDefault) event.preventDefault();
				setDragPos(anchor);
				function onMove(e) {
					setDiffWidth(clampDiffWidth(base + (e.clientX - startX), anchor));
				}
				function onUp() {
					doc.removeEventListener("mousemove", onMove);
					doc.removeEventListener("mouseup", onUp);
					try { doc.body.style.userSelect = ""; doc.body.style.cursor = ""; } catch (ignore) {}
				}
				doc.addEventListener("mousemove", onMove);
				doc.addEventListener("mouseup", onUp);
				try { doc.body.style.userSelect = "none"; doc.body.style.cursor = "col-resize"; } catch (ignore2) {}
			}

			function onPanelResizeTouchStart(event) {
				var touches = event.touches;
				if (!touches || touches.length !== 1) return;
				var doc = (typeof document !== "undefined") ? document : null;
				if (!doc || !doc.addEventListener) return;
				var el = panelRef.current;
				if (!el || !el.getBoundingClientRect) return;
				var rect = el.getBoundingClientRect();
				var anchor = { left: rect.left, top: rect.top };
				var startX = touches[0].clientX;
				var base = diffWidth;
				setDragPos(anchor);
				function onMove(e) {
					var touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
					if (!touch) return;
					if (e.preventDefault) e.preventDefault();
					setDiffWidth(clampDiffWidth(base + (touch.clientX - startX), anchor));
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

			// A window that shrank can leave the pane wider than the room it has.
			React.useEffect(function () {
				if (typeof window === "undefined" || !window.addEventListener) return undefined;
				function onResize() {
					setDiffWidth(function (current) { return clampDiffWidth(current); });
				}
				window.addEventListener("resize", onResize);
				return function () { window.removeEventListener("resize", onResize); };
			}, [dragPos]);

			// The viewer follows the session's workspace; keeping a selection across
			// a rebind would show another repository's file.
			React.useEffect(function () {
				setSelected(null);
			}, [cwd]);

			/**
			 * Select one change for the viewer. Clicking the file already showing
			 * closes the pane (the panel returns to its compact single column), and
			 * the first selection opens the full change list — the list is the
			 * viewer's navigation, so leaving it behind "show more" hides half the
			 * feature.
			 */
			function selectChange(change) {
				var file = change.file !== undefined ? change.file : change.path;
				var origFile = change.origFile !== undefined ? change.origFile : null;
				if (selected !== null && selected.file === file && selected.origFile === origFile) {
					setSelected(null);
					return;
				}
				setSelected({
					file: file,
					origFile: origFile,
					status: change.status,
					path: change.path !== undefined ? change.path : file,
					index: change.index,
					worktree: change.worktree
				});
				if (!changesOpen) setChangesOpen(true);
			}

			// Width follows what the panel is showing: the compact single column
			// while nothing is selected, and the two-pane width (workbench + diff)
			// once a file is open. Dragging the panel's right edge is what resizes
			// the diff, so the panel grows and shrinks with it.
			var panelWidth = selected === null ? S.panel.width : DIFF_LEFT_PANE_WIDTH + PANEL_BORDER_WIDTH + diffWidth;
			var panelStyle = Object.assign({}, S.panel, {
				width: panelWidth,
				maxHeight: selected === null ? S.panel.maxHeight : "72vh"
			});
			if (dragPos) {
				panelStyle = Object.assign(panelStyle, {
					left: dragPos.left,
					top: dragPos.top,
					bottom: "auto",
					transform: "none"
				});
			}

			if (cwd === null) {
				// No Session bound (nothing to float over the input).
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
				key: "header",
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
					}, selectChildren),
					h("button", {
						key: "new",
						type: "button",
						style: Object.assign({}, S.button, busy !== null ? S.buttonDisabled : null),
						disabled: busy !== null,
						title: t("branch.newTitle"),
						"aria-label": t("branch.new"),
						onClick: function () {
							if (!newBranchOpen && (newBranchBase === null || newBranchBase === "")) {
								setNewBranchBase(state.branch || (state.local.length > 0 ? state.local[0].name : ""));
							}
							setNewBranchOpen(!newBranchOpen);
						}
					}, busy === "createBranch" ? t("busy.createBranch") : "＋ " + t("branch.new"))
				]));
				if (newBranchOpen) {
					var effectiveBase = newBranchBase || state.branch || "";
					var baseKids = baseOptions(state, t);
					bodyChildren.push(h("div", { key: "newbranch", style: S.row }, [
						h("input", {
							key: "name",
							type: "text",
							style: S.input,
							value: newBranchName,
							placeholder: t("newBranch.placeholder"),
							disabled: busy !== null,
							onChange: function (event) { setNewBranchName(event.target.value); },
							onKeyDown: function (event) {
								if (event.key === "Enter" && newBranchName.trim() !== "" && effectiveBase !== "" && busy === null) {
									doCreateBranch();
								}
							}
						}),
						h("select", {
							key: "base",
							style: S.select,
							value: effectiveBase,
							disabled: busy !== null,
							title: t("newBranch.base"),
							"aria-label": t("newBranch.base"),
							onChange: function (event) { setNewBranchBase(event.target.value); }
						}, baseKids)
					]));
					bodyChildren.push(h("div", { key: "newbranchact", style: S.row }, [
						h("button", {
							key: "create",
							type: "button",
							style: Object.assign({}, S.buttonPrimary, busy !== null || newBranchName.trim() === "" || effectiveBase === "" ? S.buttonDisabled : null),
							disabled: busy !== null || newBranchName.trim() === "" || effectiveBase === "",
							title: newBranchName.trim() === "" ? t("newBranch.empty") : undefined,
							onClick: doCreateBranch
						}, busy === "createBranch" ? t("busy.createBranch") : t("newBranch.create")),
						h("button", {
							key: "cancel",
							type: "button",
							style: S.button,
							disabled: busy !== null,
							onClick: function () { setNewBranchOpen(false); }
						}, t("newBranch.cancel"))
					]));

					function doCreateBranch() {
						var nameText = newBranchName.trim();
						var baseText = effectiveBase;
						if (nameText === "" || baseText === "" || busy !== null) return;
						setNewBranchName("");
						setNewBranchOpen(false);
						store.act("createBranch", function () { return store.verbs.createBranch(state.cwd, nameText, baseText); });
					}
				}
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

				// commit tooling: stage everything, pick the draft basis, draft.
				// Ordering mirrors the real workflow (stage → draft → commit) and
				// keeps the 400px panel readable by splitting the tool row from the
				// message row.
				var noChanges = state.dirty === 0;
				bodyChildren.push(h("div", { key: "commitTools", style: S.row }, [
					h("button", {
						key: "stage",
						type: "button",
						style: Object.assign({}, S.button, busy !== null || noChanges ? S.buttonDisabled : null),
						disabled: busy !== null || noChanges,
						title: noChanges ? t("changes.none") : t("action.stage"),
						onClick: function () { store.act("stage", function () { return store.verbs.stage(state.cwd); }); }
					}, busy === "stage" ? t("busy.stage") : t("action.stage")),
					h("select", {
						key: "mode",
						style: Object.assign({}, S.select, { flex: "none", width: "auto", maxWidth: 96 }),
						value: generateMode,
						disabled: busy !== null,
						title: t("generate.mode.title"),
						"aria-label": t("generate.mode.title"),
						onChange: function (event) { setGenerateMode(event.target.value); }
					}, [
						h("option", { key: "staged", value: "staged", style: OPTION_STYLE }, t("generate.mode.staged")),
						h("option", { key: "unstaged", value: "unstaged", style: OPTION_STYLE }, t("generate.mode.unstaged")),
						h("option", { key: "all", value: "all", style: OPTION_STYLE }, t("generate.mode.all"))
					]),
					h("button", {
						key: "generate",
						type: "button",
						style: Object.assign({}, S.button, busy !== null || noChanges ? S.buttonDisabled : null),
						disabled: busy !== null || noChanges,
						title: noChanges ? t("changes.none") : t("action.generate"),
						onClick: doGenerate
					}, busy === "generate" ? t("busy.generate") : "✨ " + t("action.generate"))
				]));

				bodyChildren.push(h("div", { key: "commit", style: S.row }, [
					h("textarea", {
						key: "msg",
						rows: 2,
						style: S.textarea,
						value: message,
						placeholder: t("commit.placeholder"),
						disabled: busy !== null,
						onChange: function (event) { setMessage(event.target.value); },
						// Enter inserts a newline (a message may have a body); the
						// explicit commit chord is Ctrl/Cmd+Enter.
						onKeyDown: function (event) {
							if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && message.trim() !== "" && busy === null) {
								event.preventDefault();
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

				/**
				 * Word one generation outcome. The host reports a stable code in
				 * `error.details.code`; known codes get a localized sentence and
				 * anything unrecognized falls through to the host's own message.
				 */
				function describeGenerate(res) {
					if (res && res.ok === true) {
						return { kind: "ok", text: t("generate.done") };
					}
					var details = res && res.error && res.error.details ? res.error.details : {};
					var known = {
						"no-changes": details.mode === "staged" ? t("generate.noStaged") : t("generate.noChanges"),
						"no-provider": t("generate.noProvider"),
						"no-model": t("generate.noModel"),
						"llm-empty": t("generate.empty"),
						"cancelled": t("generate.cancelled")
					};
					var text = known[details.code];
					if (text === undefined) {
						text = res && res.error && res.error.message ? String(res.error.message) : t("generate.failed");
					}
					return { kind: "error", text: text };
				}

				function doGenerate() {
					if (busy !== null) return;
					var route = sessionRoute;
					store.act("generate", function () {
						return store.verbs.generateMessage(
							state.cwd,
							generateMode,
							route ? route.provider : undefined,
							route ? route.model : undefined
						);
					}, describeGenerate).then(function (res) {
						if (res && res.ok === true && res.value && res.value.message) {
							setMessage(String(res.value.message));
						}
					});
				}

				// changes (one row per file) — collapsible, and the diff viewer's
				// navigation: clicking a row opens that file's diff on the right.
				var changesRow;
				if (state.changes.length === 0) {
					changesRow = h("div", { key: "none", style: S.meta }, t("changes.none"));
				} else {
					var shown = changesOpen ? state.changes : state.changes.slice(0, 8);
					changesRow = h("div", { key: "list" }, shown.map(function (change, index) {
						var file = change.file !== undefined ? change.file : change.path;
						var origFile = change.origFile !== undefined ? change.origFile : null;
						var isActive = selected !== null && selected.file === file && selected.origFile === origFile;
						return h("div", {
							key: index,
							style: isActive ? S.changeRowActive : S.changeRow,
							role: "button",
							tabIndex: 0,
							title: t("diff.open"),
							"aria-label": t("diff.open") + " " + change.path,
							"data-dsh-git": "change-row",
							"data-active": isActive === true ? "true" : "false",
							onClick: function () { selectChange(change); },
							onKeyDown: function (event) {
								if (event.key === "Enter" || event.key === " ") {
									if (event.preventDefault) event.preventDefault();
									selectChange(change);
								}
							}
						}, [
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

			// Everything the open diff depends on, as one comparable string: a
			// commit moves the oid, a branch switch moves several of these, a
			// session switch changes the cwd, and STAGING moves the per-file index
			// letters. The letters are in here, not just the file count, because
			// `git add` leaves the count and the dirty tally untouched while moving
			// the change from the worktree side to the index side — the exact move
			// the open diff has to follow.
			var dataVersion = [
				state.cwd,
				state.oid,
				state.branch,
				state.dirty,
				state.changes.map(function (change) {
					return (change.index !== undefined ? change.index : " ") + (change.worktree !== undefined ? change.worktree : " ") + change.file;
				}).join(",")
			].join("|");

			// The pane's state chip follows the CURRENT status of the file, not the
			// one captured when it was clicked: staging or committing moves a file
			// between the list's labels while the pane stays open on it.
			var liveSelection = selected;
			if (selected !== null) {
				for (var ci = 0; ci < state.changes.length; ci += 1) {
					var candidate = state.changes[ci];
					var candidateFile = candidate.file !== undefined ? candidate.file : candidate.path;
					var candidateOrig = candidate.origFile !== undefined ? candidate.origFile : null;
					if (candidateFile === selected.file && candidateOrig === selected.origFile) {
						liveSelection = Object.assign({}, selected, { status: candidate.status, path: candidate.path });
						break;
					}
				}
			}

			var body = selected === null
				? h("div", { key: "body", style: S.body }, bodyChildren)
				: h("div", { key: "body", style: S.bodySplit }, [
					h("div", { key: "workbench", style: S.leftPane, "data-dsh-git": "panel-left" }, bodyChildren),
					h(GitDiffPane, {
						// Keyed by file so a new selection starts with fresh view state
						// (side choice, wrapping, "show all") instead of inheriting the
						// previous file's.
						key: "diff:" + selected.file + "\u0000" + (selected.origFile === null || selected.origFile === undefined ? "" : selected.origFile),
						store: store,
						t: t,
						cwd: state.cwd,
						change: liveSelection,
						dataVersion: dataVersion,
						onClose: function () { setSelected(null); }
					})
				]);

			// The diff's width handle IS the panel's right edge: dragging it widens
			// the panel (the workbench keeps its width) and the diff takes the rest.
			// It covers the full height but sits under the header, so the header's
			// own drag and its buttons keep the pointer in that band.
			var resizeHandle = selected === null ? null : h("div", {
				key: "resize",
				"data-dsh-git": "panel-resize",
				style: resizeHover === true ? Object.assign({}, S.resizeHandle, S.resizeHandleActive) : S.resizeHandle,
				role: "separator",
				"aria-orientation": "vertical",
				"aria-label": t("diff.resize"),
				title: t("diff.resize"),
				onMouseDown: onPanelResizeMouseDown,
				onTouchStart: onPanelResizeTouchStart,
				onDoubleClick: function () { setDiffWidth(clampDiffWidth(DIFF_DEFAULT_WIDTH)); },
				onMouseEnter: function () { setResizeHover(true); },
				onMouseLeave: function () { setResizeHover(false); }
			});

			return h("div", { "data-dsh-git": "panel", style: panelStyle, ref: panelRef }, [header, body, resizeHandle]);
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
			// This seat is session-scoped, so the framework hands it the current
			// Session identity; that `sessionId` is the one thing a root-scoped
			// seat (the panel) cannot read for itself under dsh >= 0.1.6.
			var sessionId = props.sessionId;
			var useSessions = props.useSessions;
			// useSessions is a selector hook (useSyncExternalStoreWithSelector):
			// the selector argument is REQUIRED — a bare useSessions() crashes
			// with "selector is not a function".
			var sessions = useSessions(function (s) { return s; });
			var summary = sessionId !== undefined && sessions && sessions.byId ? sessions.byId[sessionId] : undefined;
			var cwd = summary ? summary.cwd : undefined;

			// Embedded Conversations (a right-sidebar chat tab) carry their own
			// Session binding; only the main-view seat may drive the shared
			// workbench, or a subagent chat would pull the panel's repo out from
			// under the Session the user is looking at. `retainedBy.mainView` is
			// the same signal ui-session derives the current Session from; when
			// the snapshot does not carry it (an older host) the seat binds
			// anyway, so the pill never disappears for want of a count.
			var mainView = summary === undefined || summary.retainedBy === undefined || summary.retainedBy === null
				? true
				: (summary.retainedBy.mainView || 0) > 0;

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

			// The pill owns the store's session binding: it is the only seat that
			// knows the current Session's identity and workspace directory.
			React.useEffect(function () {
				if (!mainView) return;
				store.bindSession(sessionId, cwd);
			}, [sessionId, cwd, mainView, store]);

			if (!cwd || !mainView || state.sessionId !== sessionId) return null;

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
		// Test-only surface: the module-loader contract reads `apply`, `inject`,
		// and `name` and ignores everything else, while the render test needs the
		// diff parser and one row renderer without a browser (SSR runs no effects,
		// so the pane's own reads cannot be driven from a static render).
		exports.__internals = {
			parseUnifiedDiff: parseUnifiedDiff,
			parseDiffSide: parseDiffSide,
			diffRowView: diffRowView,
			GitDiffPane: GitDiffPane,
			DIFF_ROW: DIFF_ROW
		};
		return module.exports;
	}
});
