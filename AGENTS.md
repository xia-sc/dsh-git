# AGENTS.md — 本仓库的 Agent 说明

`@xia-sc/dsh-git`：DeepSeek Harness Web GUI 的 Git 插件（Cordis 宿主半 + **手写**浏览器半，
无构建步骤）。功能与 RPC 契约见 `README.md` / `README.en.md`；当前版本见 `package.json`。

> **兼容性审计笔记只留本地**：`COMPAT.md`、`AUDIT-*.md` 已被 `.gitignore` 排除，**不要提交**。
> 升级 dsh 后若插件"静默失效"，按 §7 的顺序自查；新的排查记录也只写本地文件。

## 1. 文件职责

| 路径 | 说明 |
| --- | --- |
| `lib/index.js` | 宿主半：Cordis 插件行 `dsh-git`，自持 `/dsh-git-rpc` 前缀路由与 Connection 信封，`dispatch` 分发、入参校验、`runGit`、`ok`/`fail`。改它**必须重启 `dsh web`**。 |
| `lib/client.js` | 浏览器半：`__ModuleLoader__.load` factory 内的全部 UI + store + diff 渲染；**改它刷新页面即生效**。 |
| `cordis.patch.yml` | 组合层 patch（一行 `insert`）；**故意不写 `inject`**——模块导出的 `inject` 才是 Cordis 读的。 |
| `test/smoke.mjs` | 路由/信封/分发/校验 + 客户端 bundle 结构；**不 spawn git**。 |
| `test/host-*.mjs`、`test/slot-mount.mjs` | 宿主兼容守护：宿主发现（`host-root.mjs`，含 desktop `app.asar` 提取缓存）、真 Cordis/Connection 挂载（`host-mount.mjs`）、真 `SlotCore` 座位（`slot-mount.mjs`，slots 由 `host-slots.mjs` 按安装版本取）。 |
| `test/generate.mjs` / `test/render.mjs` | AI 起草纯单元 / 双界面真 React SSR（需要 `react`，缺失 SKIP+0）。 |
| `test/diff|commit|push|checkout|stash|discard.mjs` | 真 git 端到端，**不在 `npm test` 内**（沙箱 spawn EPERM）。 |
| `test/ui/*.mjs` | 真 Chrome 脚本：`verify-settings`/`verify-branches`/`verify-auto-refresh`/`verify-git-actions` 离线免认证；`verify-diff` 默认夹具、`DSH_GIT_UI_LIVE=1` 打真端点。 |
| `.github/workflows/publish.yml` | 唯一 CI：`vX.Y.Z` tag → 校验版本一致 → `npm test` → `npm publish --provenance`。 |

## 2. 常用命令

```powershell
npm test                  # smoke → host-mount → slot-mount → generate → render（不 spawn git）
node test/smoke.mjs       # 改任何文件后最快的门禁
npm run test:diff         # 以下六个端到端必须真起 git（普通终端跑，见 §7）
npm run test:commit       #   含 amend / headMessage
npm run test:checkout
npm run test:push         #   含假 sessions/forgeSession 的 forge 发现断言
npm run test:stash
npm run test:discard
$env:DSH_GIT_REACT_ROOT = "<含 react 与 react-dom 的 node_modules>"
node test/ui/verify-settings.mjs   # 离线真浏览器（另：verify-branches / verify-auto-refresh / verify-git-actions）
```

## 3. 硬约束

### 3.1 浏览器半写的就是最终产物
`factory` 收到的 `require` **只能解析 `react`**（smoke 会对其它 spec 抛错）：不要 `react-dom`、
不要 import、不要 JSX/构建链；组件用 `h()`，样式全走模块内 `S`，不要写死颜色（见 §4）。

### 3.2 宿主半不 import `@deepseek-ai/*`
只用 `node:` 内置模块 + 已导入的 `@deepseek-ai/cordis`。以 pnpm `link:` 安装时这类 import 会在
**加载期崩溃**。

### 3.3 `inject` 只放真硬依赖
`inject = ["webServer", "connection"]`。**`llm`、`forgeSession`、`sessions` 一律不进 `inject`**，
每次调用经 `ctx.get(name)` 读取（`optionalService`）：缺失时降级（`status.generate=false`、
`generateMessage` 报 `llm-unavailable`、forge 发现静默跳过），而不是让整行 PENDING（路由不注册 →
面板 405）。围栏 `connection.requestRejection` 不能去掉或降级。

### 3.4 生效时机
client 改动→刷新页面；host 改动/`cordis.patch.yml`/`package.json` 的 `dsh` 段→重启 `dsh web`。
新增端点必须同步改三处：`dispatch` 的 `case`、README 端点表、`test/smoke.mjs` 的校验矩阵。

### 3.5 git 调用
一律 `runGit(cwd, args, signal, timeoutMs, stdin, allowExit)`：数组参数、无 shell、本地 30s /
网络（fetch/pull/push）120s、输出上限 32MB。校验在跑 git 之前：`cwd` 绝对路径；`branch` 匹配
`^[A-Za-z0-9][A-Za-z0-9._/-]*$`；`path` 走 `normalizedPath`（拒绝绝对路径、`..`、前导 `-`、控制字符、
首尾空白）。`git diff --no-index` 以退出码 1 表示"不同"，用 `allowExit` 接住。**只读端点只读**：
`status`/`branches`/`log`/`diff`/`headMessage` 不写 index/工作区/config。

### 3.6 错误码
线上 `error.code` **恒为 `"internal"`**；插件诊断码放 `error.details.code`（`invalid-cwd`、
`invalid-path`、`invalid-message`、`invalid-ref`、`no-changes`、`discard-conflict`、`stash-conflict`…），
`message` 是人类可读文本/ git 原文；客户端按 `details.code` 本地化。

### 3.7 行为边界（README 已承诺）
- **commit 不隐式暂存**；「提交并推送」是显式复合动作（暂存全部→提交→推送），推送失败时用
  `output.commitPushCommittedNotPushed` 说明提交已落地。新增 `store.act("<action>")` 必须补 zh/en 的
  `action.*`/`busy.*`/`output.*`。
- **pull 恒 `--ff-only`**；无上游 push 自动 `--set-upstream`（`pushPlan` 决策，远程顺序
  `remote.pushDefault`→`origin`→唯一 remote；不猜）。**绝不改 git config、不碰凭据**。
- **discard 是唯一删除工作区数据的端点**：只按单条 path；宿主自己重读该路径的 porcelain-v2
  (`-z`) 状态决定 `restore`/`clean`，绝不信任客户端传来的 kind；冲突路径 `discard-conflict` 拒绝；
  未跟踪用 `git clean -f -d`（不加 `-x`）；暂存新增先 unstage 再 clean。浏览器必须行内二次确认。
- **stash 默认不含未跟踪文件**（`-u` 只是端点参数）；`stashPop` 只收 `stash@{N}`；冲突时 git 保留
  条目、冲突留在工作区（`stash-conflict`），工作区会被覆盖时 git 中止（`stash-blocked`）；
  不做 `stash drop`/`apply`。
- **amend 复用 commit 的消息路径**（规范化 + stdin + `--cleanup=whitespace`，只多 `--amend`）；
  无 HEAD 报 `no-commit`；**绝不自动 force push**；amend 开启时 `networkPrimary` 返回
  `{action:null, reason:"amend.conflict"}`。
- **forge 协同只走公开服务**：push 成功后 `ctx.get("forgeSession").discoverBranch(session, remoteUrl, branch)`
  （dsh ≥ 0.2.2；fire-and-forget、不传请求 AbortSignal、`session.header.cwd === cwd` 才绑定、
  sessionId 非法则忽略）。**不伪造 `tool/call`/`tool/result`**（会进模型可见历史）、**不直接写
  plugin record**（需 import `@deepseek-ai/dsh-session`）。服务改名/缺失只退化"不自动发现 PR"。
- 面板操作不写会话日志、不进模型提示词；AI 起草只填输入框，不自动提交。

## 4. 浏览器半要点

- 两个座位共享一个 store：`shell.overlay`（面板）与 `conversation.input.dock`（胶囊）。**会话绑定归
  dock**（`sessionId` prop + `useSessions` 的 cwd → `store.bindSession`）；面板只读 store，别反转
  （根作用域查不到当前会话，反转会让两者一起静默消失）。
- 订阅用 `useState + useEffect`，**不用 `useSyncExternalStore`**。所有用户字符串进 `zh`/`en` 字典
  （键对齐）；颜色只用主题 token：`--dsw-alias-state-business-primary`/`--dsw-alias-link` 才是"蓝"，
  `brand-primary` 是反相强调色（主按钮用 `button-primary-fill` + `label-primary-foreground`）；
  淡色底用 `color-mix(in srgb, <token> N%, transparent)`。
- 布局：`selected` 非空 → `[左栏 300][diff]`，宽度手柄是面板右边缘；两栏**固定高度**
  `DIFF_PANEL_HEIGHT = min(72vh, calc(100vh - 184px))`，`box-sizing: border-box`；常量与 CSS 必须一致。
- diff：`--- `/`+++ ` 只在 hunk 之外认作文件头；不换行 `max-content`、换行置 0 且 `white-space`
  写在文本 span；大 diff 用 `diffWindow` 虚拟滚动（行高三个数同步：`DIFF_ROW_HEIGHT`、
  `S.diffRow.lineHeight`、spacer），换行改用「再显示 N 行」；提示卡在滚动容器外；二进制按文件
  （`binaryPaths`），整侧纯二进制才 `binary: true`。
- `data-dsh-git` 是测试钩子，改名=改测试：`dock`、`dock-row`、`panel`、`panel-drag`、`panel-left`、
  `panel-resize`、`output`、`output-toggle`、`output-detail`、`changes`/`changes-header`/`changes-body`/
  `changes-more`、`log` 同系列、`change-row`、`diff`/`diff-notices`/`diff-header`/`diff-body`/`diff-row`/
  `diff-close`/`diff-wrap`/`diff-copy`/`diff-reload`/`diff-scope-worktree`/`diff-scope-index`/
  `diff-show-more`/`diff-empty`/`diff-binary`/`diff-binary-hidden`/`diff-untracked`、`generate`/
  `generate-unavailable`、`settings`/`settings-backdrop`/`settings-close`/`settings-popover`/
  `settings-language`/`settings-language-text`/`settings-auto-refresh`、`change-discard`/`discard-confirm`/
  `discard-apply`/`discard-cancel`、`stash`/`stash-head`/`stash-header`/`stash-body`/`stash-push`/
  `stash-pop`/`stash-more`、`amend`/`amend-toggle`/`amend-load`；行有 `data-kind`、选中 `data-active`。
- 列表区块 `sectionView`：折叠（`changesOpen`/`logOpen`）与预览（`changesAll`/`logAll`）是两个 state，
  默认展开，更多文案 `section.more`/`section.less`；新增标题按钮放进 `spec.actions`（不能塞进 button）。
- 同工作区重读不清空：`keep` 时保持 `phase`、只置 `refreshing`（`idleState` 负责复位）；
  `act()` 成功/失败都 `refresh()`（失败卡片靠 `lastResult` 保留）。输出卡片永远在 body 第一行：
  本地化短句 + `详情 ▾` 折叠 git 原文；只有 `message` 非空才有 toggle。
- 按钮组等宽（`S.grow` + `S.rowTight`）；主按钮用 `S.buttonPrimary`。网络第三按钮两模式
  `networkPrimary(state, draft, amend)`：有改动+草稿→`commitPush`；否则有未推送提交→`push`；
  否则禁用 + `reason`。
- `message` 文本在 `rpc()` 边界剥 ANSI（`stripAnsiEscapes`），**diff 与路径不动**。
- `__internals` 是 render 测试出口：解析器、`diffWindow`、`GitDiffPane`、`outputView`、
  `branchOptions`/`baseOptions`、`checkoutResult`、`settingsView`、`sectionView`、`changeTagStyle`、
  `panelBoxStyle`、`DIFF_PANEL_HEIGHT`、`sessionModelRoute`、`networkPrimary`、自动刷新的
  `autoRefreshDelay`/`createAutoRefresher`/`frameSignature`/`diffValueSignature`/`readStoredAutoRefresh`/
  `AUTO_REFRESH_*`、stash/discard/amend 的 `stashDraft`/`stashable`/`discardIntent`/
  `discardConfirmView`/`amendView`。
- 设置：提交信息语言与自动刷新都是用户偏好，存 `localStorage`（`dsh-git.commitLanguage` /
  `dsh-git.autoRefresh`），`idleState()` 每次重发（写死默认会被下次 status 重读冲掉）；`settingsOpen`
  放 store。`languageDirective()` 只把语言名交给宿主；`status.generate` 决定起草能力位。
- **自动刷新**：`createAutoRefresher` 由 `apply()` 的 `ctx.effect` 启动（无 `document` 时 no-op）；
  面板打开 4s / 收起 15s、`hidden` 暂停、`busy` 短暂重查、耗时自适应、失败指数退避；
  轮询只调 `status`，签名变化才补 `branches`+`log`，签名相同不 emit；不写 `refreshing`/`phase`。
- **diff 自动重读**：依赖该文件自身的 `changeVersion`（不是整仓签名）；pane 内静默定时重读
  （不 loading、不重置滚动、内容相同不 setState）；文件从 `changes` 消失时 `setSelected(null)`。
- **stash 卡片**：列表来自 `status.stashes`（宿主并行 `git stash list`，`frameSignature` 含 stashes）；
  默认折叠、标题行右侧「＋ 储藏」用 `sectionView` 的 `actions`；未跟踪-only 时禁用；默认消息
  `WIP on <branch>`（**不要**用提交草稿）。
- **discard**：变更行 `✕` 只设置 `pendingDiscard`，确认条在 changes 卡片前；✕ 的 click/keydown
  必须 `stopPropagation`；cwd 变化/目标消失/面板收起清空；冲突行不渲染 ✕。
- **amend**：`amendOn`/`amendLoading`/`amendError` 在组件 state；打开且草稿为空时 `headMessage`
  预填（不覆盖已有草稿），`↻` 可重读；提交走 `act("amend", () => verbs.commit(cwd, text, true))`；
  成功后关开关。覆盖按钮边框必须整条重写 `border`（别用 `borderColor` 盖简写，React 会警告）。
- **forge**：`gitPush` 成功后用 `branch.<name>.remote/.merge`（或 `pushPlan.remote`）+
  `git remote get-url --push` 解析目标，再 `notifyForgeDiscovery`；客户端 `verbs.push(cwd, sessionId)`，
  `doPush`/`doCommitPush` 必须传 `state.sessionId`（null 时省略）。

## 5. 测试

- **默认门禁五个**（不 spawn git）：`smoke`、`host-mount`、`slot-mount`、`generate`、`render`。
  加端点/校验→smoke；加纯逻辑→generate 或 render；加 UI→render（SSR 能覆盖结构/文案/解析）。
- **宿主守护的 SKIP 契约**：宿主根统一由 `test/host-root.mjs` 解析——**只有"这台机器完全没装 dsh"
  才 SKIP+0；"装了却解析不到"必须 FAIL+1**（反证：`DSH_HOME=<空目录>`+`DSH_ASAR=<不存在>`→SKIP；
  `DSH_GIT_DSH_ROOT=<空目录>`→SKIP；`DSH_ASAR=<非 asar 文件>`→FAIL）。`slot-mount` 的 slots 由
  `host-slots.mjs` 取（安装树→`DSH_GIT_SLOTS_ROOT`→按版本缓存→npm 同版本真包 + SRI），不许 stub。
- **真 git 六个**（diff/commit/push/checkout/stash/discard）：临时仓库、`core.autocrlf=false`、
  `mkdtemp`+`finally rm`。重命名只有真 git 能暴露；`push.mjs` 用假 `sessions`/`forgeSession` 断言
  forge 发现（`pushPlan.remote` 与非法 sessionId 在 smoke，wire 载荷在 render）。冲突 pop 必须把另一侧
  **提交**后再 pop（只改工作区会 `stash-blocked`）。
- `render.mjs` 的 react 解析顺序：`DSH_GIT_REACT_ROOT` → `$DSH_HOME/profiles/web/node_modules` →
  `$DSH_HOME/profiles/node_modules` → npx 缓存 → node 解析；全无则 SKIP+0。
- `test/ui/*.mjs` 用 playwright-core + 本机 Chrome（`npm install --no-save playwright-core`），靠
  `data-dsh-git` 钩子；四个离线脚本免认证与 dsh web，`verify-diff` 需认证（`DSH_GIT_UI_URL`/
  `DSH_GIT_UI_STORAGE_STATE`）。本沙箱 `spawn EPERM`，只能普通终端跑。
- **CI 跑 `ubuntu-latest`**：`smoke` 的 `cwd` 用 `join(tmpdir(), …)` 造绝对路径（`C:/...` 只有
  Windows 认）。UI 脚本只 Windows 手动跑，不在门禁内。

## 6. 本地验证与发版

1. `npm test`（至少 `node test/smoke.mjs`）。
2. 宿主半改动 → `test:diff`/`test:commit`/`test:push`/`test:stash`/`test:discard` + 请用户重启
   `dsh web` 后在真 GUI 点一遍。浏览器半改动 → 刷新页面，用 playwright/MCP 真点：开面板 → 点变更行 →
   `[data-dsh-git="diff"]` 出现 → 收起 → 拖右边缘 → 双击复位；设置走 `test:ui:settings`。
3. 发版：改 `package.json` 版本（当前 0.9.1）→ 跑全部门禁 → 中文主题 + 分节正文提交 →
   `git push origin master` → `git tag -a vX.Y.Z -m "…"` + `git push origin vX.Y.Z`（推 tag 即发布：
   workflow 校验 tag/版本、跑 `npm test`、`npm publish --provenance`）→ `gh release create`。
4. CI 排错：workflow 表达式**只认单引号**；发布后别用 `npm view` 判断（缓存滞后），权威判据是
   registry 里的 `gitHead`；`cannot publish over the previously published versions` 视为成功。
   首包必须本机交互式 `npm publish`（trusted publishing 要求包已存在，`npm trust github … --allow-publish`）；
   备用 `NPM_TOKEN`（granular）。

## 7. 本机环境与排查

- **子进程管道 stdio 被拦**：Node `execFile`/`spawn` 默认 `stdio:"pipe"` 报 `spawn EPERM`，所以端到端
  测试跑不了；pwsh 直接调 git 可以（但本地 `git push` 到 bare 仓库在 msys 下也可能被拦）。
- 本机是 **desktop 版**（`DSH_PROFILE=desktop`），插件以 `link:` 源码安装（改仓库后刷新即生效，改
  `lib/index.js` 需重启应用）。GUI URL 读 `$env:DSH_WEB_URL`（端口每进程不同，别写死）；桌面版不打印
  带 token 的 URL，新无头浏览器默认 401——用已登录的 MCP 浏览器，或按本地审计笔记自签会话 cookie。
- 宿主换版排查顺序：`npm test` → `host-mount`/`slot-mount` 是否 FAIL（解析不到宿主）→ 看 plugin
  是否 405（路由没挂上/整行 PENDING）→ 看宿主包版本与 `dsh-client-*` 导出面是否变化。换版记录写本地
  `COMPAT.md`（已 gitignore，不要提交）。
- 本机 `npm test` 首次会联网取 slots 包（SRI 校验，缓存到 `%TEMP%`）；离线用 `DSH_GIT_SLOTS_ROOT`。

## 8. 边界与不做

- 不依赖宿主右侧 Sidebar 标签页 API 的迭代面；diff 两栏与请求都在插件内自带。
- 不做语法高亮（第三方依赖违反 §3.1）、逐文件暂存、提交历史 diff、`stash drop`/`apply`、全部丢弃、
  force push、GUI 写 forge 内部 pushes。规模上限：单侧 diff 40 万字符；未跟踪目录展开 50 个文件。
- 面板状态是内存态：刷新后回到未选文件的单栏形态（有意）。
- 自动刷新是只读轮询；不改 git config、不碰凭据；AI 生成只填输入框。
