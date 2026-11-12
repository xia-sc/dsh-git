# @xia-sc/dsh-git

[English](./README.en.md) | 中文

DeepSeek Harness Web GUI 的 Git 插件：一个**可折叠的悬浮面板** + 输入框旁的**状态胶囊**，
**实时跟随当前会话的工作区**——在侧边栏切换会话，面板与胶囊会立即重绑到对应仓库。

**工作流：** 分支切换 · fetch · pull（仅快进） · 暂存全部 · 提交（可 AI 起草提交信息） ·
推送 · 一键提交并推送 · 储藏 / 恢复 · 丢弃单条改动 · 修改上次提交 · 点击变更看差异 ·
从任意基分支新建分支。

## 界面

### 悬浮面板与胶囊

- **胶囊**（`conversation.input.dock`）常驻输入框左上角，显示分支、脏计数、领先/落后；
  点击展开/收起面板。
- **面板**（`shell.overlay`）折叠时不渲染任何元素（不遮挡输入框），展开后自上而下是一条工作流：
  状态行 → 分支切换器（带脏树预检）→ 网络工具条 → 提交卡片 → 变更卡片 → 储藏卡片 →
  最近提交。面板可拖动（双击顶栏复位），折叠/展开不影响输入。
- **分支切换**：有未提交改动时先给出警告和受影响文件，可「仍要切换」；远端分支显示**完整远程
  引用**（`origin/main`、`upstream/main`），避免多个 remote 同名分支分不清。选远端引用会新建
  同名跟踪分支；同名本地分支已存在时明确报错（HEAD 不动，也不会偷偷 detach）。
- **新建分支**：输入名称 + 选择基分支（本地或完整远端引用），创建并切换过去。
- **两张列表卡片**：变更行 = 等宽路径 + 状态色标签，点击行打开右侧 diff；最近提交 = 短 sha +
  主题。标题行点击折叠/展开，默认展开；超过预览行数时底部提供「显示全部 N 项」。

### 差异查看

- 点变更行，面板从单栏变两栏（左工作台 / 右 unified diff）；再点同一行或 `×` 收回。
- **拖面板右边缘**调 diff 宽度（双击复位）；两栏使用固定高度，diff 异步读回时面板不会跳。
- 未暂存 / 已暂存两侧可切换；空的一侧置灰。默认跟随数据：未暂存有内容看未暂存，否则看已暂存。
- 大 diff 用虚拟滚动（不换行按固定行高，换行改为「再显示 N 行」分页）；行号、`+/-` 配色、
  hunk 头、`\ No newline at end of file` 都有对应渲染；二进制按文件判定并列出被隐藏的文件名。
- 只读：diff 端点只跑 `git diff` / `git ls-files`，不写 index、不动工作区。

### 提交区与 AI 起草

- **暂存全部**（`git add --all`）、AI 起草依据（已暂存 / 未暂存 / 全部）、**✨ AI 生成**三等宽。
- 提交信息是多行输入框（回车换行，Ctrl/Cmd+Enter 提交）；**提交**只提交已暂存内容，从不隐式
  暂存；**提交并推送**是显式复合动作（暂存全部 → 提交 → 推送）。
- **✨ AI 生成**把选中的改动交给当前会话所选模型，生成结果只填入输入框，不自动提交；模型路由取
  当前会话的 `modelSelection` 投影，请求带 `sessionId` 供需要会话亲和的网关使用。
- **提交信息语言（⚙）**：默认「自动」（跟随仓库），也可强制简体中文/繁體中文/English/日本語/
  한국어/Français/Deutsch/Español/Русский 或自定义语言名；选择存在浏览器 `localStorage`
  （`dsh-git.commitLanguage`），对所有工作区生效。
- **操作反馈**固定在 body 第一行、只有一行：本地化短句 + git 原文收在「详情 ▾」里。失败时短句是
  诊断开头，全文仍在详情里。

### 储藏 / 丢弃 / 修改上次提交

- **储藏**：底部「储藏」卡片（默认折叠，标题带计数）列出 `stash@{N}` 与 git 的 subject；
  「＋ 储藏」把已跟踪改动存成一条带 `WIP on <branch>` 消息的储藏；每行「恢复」执行
  `git stash pop` 并删除该条。**未跟踪文件默认不进储藏**（git 自己的行为）；恢复冲突时 git 保留
  条目、冲突留在工作区，面板会说明；工作区会挡住恢复时提示先处理当前改动。
- **丢弃单条改动**：变更行末尾的 `✕` 先弹出**行内确认**（不可撤销）；确认后已跟踪文件回到 HEAD
  （`git restore --staged --worktree`），未跟踪文件/目录直接删除（`git clean -f -d`），打开的差异
  自动收起。冲突文件不显示 `✕`（要在终端解决），且**没有「全部丢弃」**。
- **修改上次提交**：低频操作，折叠在提交按钮下方的一行浅色小字里（不与「暂存全部」同排，避免
  误触）。点开时先向宿主确认**上次提交是否已经在远程**（只读查本地远程跟踪引用，不 fetch）。若
  已推送，面板不会直接进入 amend，而是行内警告并列出远程分支（如 `origin/main`）——改写已发布
  的提交之后推送必须 force push，多数仓库会拒绝；点「仍然修改」才继续。确认后自动预填上次提交
  信息（不覆盖已有草稿，`↻` 可重读），按钮变为「修改提交」。它复用与普通提交通**完全相同**的
  消息规范化与 `--cleanup=whitespace`，只多一个 `--amend`。插件不自动 force push，成功提示里
  写明；amend 开启时「提交并推送」禁用。

### 自动刷新

默认开启：面板打开时每 4 秒、收起后每 15 秒只读轮询一次仓库状态。在编辑器里改文件、在终端里
提交/切分支/fetch 都会自己出现在面板与胶囊上，不再只靠 ↻。

- 轮询只调 `status`（外加必要的 `branches`/`log`），**绝不自动 fetch/pull/push/commit**。
- 数据签名不变时不重绘，不打断正在输入或拖拽；页面切到后台时暂停、切回立即读一次。
- 宿主暂时不可用时指数退避，不把已有界面打成错误页；打开的 diff 静默跟随文件内容重读
  （不闪 loading、不跳滚动）。
- 可在 ⚙ 里关闭（存 `localStorage`，键 `dsh-git.autoRefresh`）；节奏固定，不提供间隔自定义。

### forge 协同（dsh ≥ 0.2.2）

官方 forge-session 只从 `bash`/`pwsh` 工具里的 `git push`/`gh pr create` 输出推断分支与 PR；
面板推送走的是插件自己的 `/dsh-git-rpc/push`，不是 shell 调用。因此推送成功后插件会调用宿主
可选的 `forgeSession.discoverBranch(session, remoteUrl, branch)`，让 Forge 面板与会话摘要发现该
分支的 open PR（来源记为 `discovered`）。

旧宿主、未启用 forge、未配置 provider、本地 remote 或没有当前会话 id 时，这一步静默跳过，
推送行为完全不变。插件**不伪造 shell 工具事件**（那会写进模型可见的会话历史），也不直接写
forge 的内部记录。

## 安装

```sh
# npm（推荐）
dsh plugin --profile web add @xia-sc/dsh-git

# 或直接从源码安装（两个渠道同源）
dsh plugin --profile web add https://github.com/xia-sc/dsh-git
```

然后**重启 `dsh web`**（bundle 行与浏览器 roster 在启动时组合）。要求 **dsh ≥ 0.1.5-rc.1**
（forge 协同需要 0.2.2+ 且宿主启用 forge）。

卸载：

```sh
dsh plugin --profile web remove @xia-sc/dsh-git
```

## 架构

一个双面 npm 包：

| 半边 | 文件 | 职责 |
| --- | --- | --- |
| 宿主 | `lib/index.js` | Cordis 插件行 `dsh-git`，自持 `/dsh-git-rpc` 前缀路由，收发与 `/api` 相同的 Connection RPC 信封，并复用 connection 的 Host/Origin + 会话 Cookie 围栏。所有 git 调用走 `execFile`（无 shell），本地 30s / 网络 120s 超时，严格入参校验。 |
| 浏览器 | `lib/client.js` | `dsh.client` bundle（手写、无构建步骤，仅依赖 `react`）：悬浮面板、胶囊、共享 store、diff 渲染。 |

- **为什么自持 HTTP 路由（dsh ≥ 0.1.5-rc.1）**：该版本起外部插件调用 `ctx.connection.rpc.handle()`
  会因 connection 插件自身的 Context 缺 `webServer` 而挂载失败。本插件改为自己注册路由、自己
  收发同一套信封；围栏仍交给 `connection.requestRejection`，安全等级与 `/api` 一致。
- **会话绑定由会话座位提供（dsh ≥ 0.1.6-alpha.2）**：会话列表快照不再带 `current`，当前会话改由
  渲染器的会话作用域适配器投递。胶囊（会话作用域）读 `useSessions` 取 cwd 并
  `store.bindSession(sessionId, cwd)`；面板（根作用域）只读共享 store，不自己找当前会话。
- **可选能力全部走反射读取**：`llm`、`forgeSession`、`sessions` 都经 `ctx.get(name)` 按需读取，
  **不进 `inject`**——硬依赖会让整行在宿主没起对应服务时一直 PENDING、路由不注册。

## RPC 约定（`/dsh-git-rpc`）

浏览器侧通过 `ctx.connection.rpc.call("/dsh-git-rpc", endpoint, { args })` 调用；宿主侧是本插件
自持的前缀路由，收发与 `/api` 相同的 Connection 信封：

- 请求：`POST /dsh-git-rpc/<endpoint>`，`content-type: application/json`，
  `{ type: "client-request", rpcId, method: <endpoint>, payload: { args } }`
- 响应：`{ type: "server-response", rpcId, result: { ok: true, value } | { ok: false, error } }`
- 围栏：`connection.requestRejection`（Host/Origin + 浏览器会话 Cookie）；非 POST → 405，
  非 JSON → 415，请求体超限 → 413，路径不属于本通道 → 404。

入参约定：`cwd` 必须绝对路径；`branch` 匹配 `^[A-Za-z0-9][A-Za-z0-9._/-]*$`；`path` 是仓库内相对
路径（拒绝绝对路径、`..`、前导 `-`、控制字符、首尾空白）。提交信息按真正的提交信息处理：CRLF→LF、
逐行去行尾空白、去首尾空行、连续空行折叠；空/超长（>10000）/含控制字符报 `invalid-message`；
经 stdin 以 `git commit --cleanup=whitespace --file=-` 传入，因此空格、引号、换行、shell 元字符、
前导 `-` 都会原样记录。

| 端点 | 参数 | 结果 / 说明 |
| --- | --- | --- |
| `status` | `{ cwd }` | `{ repo, branch, detached, oid, upstream, ahead, behind, dirty, generate, stashes: [{ref, subject}], changes: [{status, path, index, worktree, file, origFile}] }`。`path` 是展示串（重命名 `old → new`），`file`/`origFile` 是 pathspec；`generate` 表示宿主是否提供 `llm`；`stashes` 随同一次读取返回（最多 50 条）。 |
| `branches` | `{ cwd }` | `{ repo, current, local: [{name, current, upstream, sha}], remote: [{remote, branch, name, short}] }`。远端项给完整跟踪 ref（`name`）与分支部分；每个 remote 的 `HEAD` 符号引用会被过滤。 |
| `checkout` | `{ cwd, branch }` | `{ branch, detached, oid, message? }`。本地名走 `git switch --guess`；远端跟踪 ref 新建跟踪分支并切换；同名本地分支已存在时 `checkout-remote-conflict` 且 HEAD 不动。 |
| `createBranch` | `{ cwd, branch, base? }` | `{ branch, detached, oid, message? }`，经 `git switch --create <branch> <base>`（缺省 base=HEAD）。 |
| `fetch` | `{ cwd }` | `{ message }`（120s；`git fetch` 没有 remote 参数）。 |
| `pull` | `{ cwd }` | `{ message }`，恒 `git pull --ff-only`。 |
| `stage` | `{ cwd }` | `{ message }`，经 `git add --all`。 |
| `stash` | `{ cwd, message?, includeUntracked? }` | `{ message }`。消息单行（≤200 字符、无控制字符/换行）；缺失/空让 git 写 `WIP on <branch>`；`includeUntracked: true` 才加 `-u`；没有可储藏的已跟踪改动时 git 退出 0，插件改报 `no-changes`。 |
| `stashPop` | `{ cwd, ref }` | `{ message }`。`ref` 只接受 `stash@{N}`（`invalid-ref`）；冲突时冲突留在工作区、条目保留（`stash-conflict`）；工作区会被覆盖时 git 中止（`stash-blocked`）；不存在的条目 `stash-missing`。 |
| `discard` | `{ cwd, path, origPath? }` | `{ message }`。宿主自己读该路径的 porcelain-v2 状态（`-z`）：冲突→`discard-conflict` 拒绝；未跟踪→`git clean -f -d`（不加 `-x`）；暂存新增→先 `restore --staged` 再 clean；其余→`git restore --staged --worktree`（重命名带双 pathspec）。无改动报 `no-changes`。 |
| `diff` | `{ cwd, path, origPath? }` | `{ repo, path, origPath, untracked, skipped, worktree: {diff, binary, binaryPaths, truncated}, index: {…} }`。两侧一次读回；未跟踪用 `git diff --no-index -- /dev/null <path>`（容忍退出码 1）；单侧 40 万字符在行边界截断；二进制按文件判定。**只读**。 |
| `commit` | `{ cwd, message, amend? }` | `{ message }`；`amend: true` 改走 `git commit --amend --cleanup=whitespace --file=-`（无 HEAD 报 `no-commit`）；缺 author 报 `missing-author`。 |
| `headMessage` | `{ cwd }` | `{ message }`（`git log -1 --format=%B`，去尾部空行）；仓库无提交时报 `no-commit`。只读。 |
| `amendCheck` | `{ cwd }` | `{ pushed, refs, upstream }`。`pushed` 由 `git branch -r --contains HEAD` 判定 HEAD 是否已在某个远程跟踪分支上（**只读、不 fetch**）；`refs` 是这些远程 ref（最多 5 个），`upstream` 是当前分支的跟踪上游（可为 null）；无 HEAD 报 `no-commit`。 |
| `push` | `{ cwd, sessionId? }` | `{ message }`（120s）。有上游走普通 `git push`；无上游自动 `git push --set-upstream <remote> <branch>`（远端顺序 `remote.pushDefault` → `origin` → 唯一 remote；否则 `no-remote`）；游离 HEAD 报 `detached-head`。`sessionId` 是可选的 forge 发现提示，非法/未知静默忽略，**不影响推送结果**。 |
| `log` | `{ cwd, count? }` | `{ repo, commits: [{sha, author, subject, refs}] }`（钳制 1..50）。 |
| `generateMessage` | `{ cwd, mode?, provider?, model?, sessionId?, language? }` | `{ message, mode, provider, model }`。`mode` 为 `staged`/`unstaged`/`all`（非法 `invalid-mode`）；`sessionId` 可选（>200 字符 `invalid-session`）；`language` 是语言名（>60 字符或形状非法 `invalid-language`，空/`auto` 表示跟随仓库）。失败码：`llm-unavailable`、`no-changes`、`no-provider`、`no-model`、`llm-truncated`、`llm-empty`、`cancelled`、`llm-failed`。 |

> **错误码约定**：线上 `error.code` 恒为 `"internal"`（Connection 信封要求它是字符串），插件自己的
> 诊断码放在 `error.details.code`，客户端按该码做本地化。
>
> `fetch`/`pull`/`push`/`stage`/`commit`/`stash` 的 `message` 就是 git 自己的输出（已剥 ANSI 颜色
> 码）：git 什么都没说时是空串，界面用 `output.<action>` 短句做通知，原文放进可展开的「详情」。

## 设计决策与边界

> 完整清单与理由见 [`NON_GOALS.md`](./NON_GOALS.md)：**force push**、rebase/reset 等历史改写、
> 全部丢弃、合并提交、自动 fetch/pull/commit/push、写 git config 与凭据管理都不在范围内。

- **commit 不暂存**：只提交已暂存内容；想全提交用「暂存全部」。顶栏「提交并推送」是显式复合
  动作，不改变提交本身的语义；推送失败时提交已落地，提示会明确说明。
- **pull 恒 `--ff-only`**：不产生意外的合并提交。
- **无上游的 push 自动 `--set-upstream`**：这是 git 报错里自己给的建议，创建远端分支并让 git
  记录跟踪关系（插件不手改 config）。
- **绝不修改 git config、绝不碰凭据**：凭据来自系统 Credential Manager / SSH agent；缺
  `user.name/email` 时直接报错，不代写。
- **丢弃不可逆**：只按单条路径、必须二次确认；不做「全部丢弃」；冲突文件拒绝；未跟踪用
  `clean -f -d`（不加 `-x`，ignored 文件不动）。
- **储藏跟着 git 走**：默认不含未跟踪文件；`pop` 冲突保留条目；不做 `stash drop` / `stash apply`。
- **amend 会改写历史**：入口先查 HEAD 是否已推送，已推送则行内二次确认（列出远程分支）后才进入
  amend 模式；不自动 force push，成功提示写明；amend 时禁用复合动作。
- **forge 协同时可选**：只调用宿主公开的 `discoverBranch`（只读查询），缺服务/无 provider 静默跳过；
  不伪造工具事件、不写会话日志、不直接写 forge 内部记录。
- **差异查看是纯只读的**：`diff` 只跑 `git diff` / `git ls-files`，不写 index / 工作区 / 配置；
  不依赖宿主右侧 Sidebar 那套还在迭代的 API，两栏与渲染都在插件内自带（只依赖 `react`，无语法
  高亮）。
- **插件不导入任何 `@deepseek-ai/*` 运行时包**：只用 `node:` 内置模块与 `@deepseek-ai/cordis`；
  `llm`/`forgeSession`/`sessions` 都经 `ctx.get` 可选读取。
- **面板操作不写会话日志、不进模型提示词**；AI 生成只填输入框，不自动提交；自动刷新只做只读轮询。
- 规模上限：单侧 diff 40 万字符（行边界截断）；渲染由虚拟滚动/分页承担；未跟踪目录展开 50 个文件。
- 面板状态是内存态：刷新后回到未选文件的单栏形态（有意）。

## 开发与测试

- **浏览器半** `lib/client.js` 是手写产物、**无构建步骤**：改它刷新页面即生效。
- **宿主半** `lib/index.js` / `cordis.patch.yml`：改完需要**重启 `dsh web`**。
- `npm test`：smoke → host-mount → slot-mount → generate → render（不 spawn git；render 需要
  `react`/`react-dom`，可用 `DSH_GIT_REACT_ROOT` 指定，缺失时 SKIP）。
- 真 git 端到端：`npm run test:diff` / `test:commit` / `test:push` / `test:checkout` /
  `test:stash` / `test:discard`（需要普通终端；受限沙箱会拦子进程管道）。
- 真浏览器脚本（playwright-core + 本机 Chrome，离线、免认证）：`npm run test:ui:settings` /
  `test:ui:branches` / `test:ui:auto` / `test:ui:actions`；`test/ui/verify-diff.mjs` 需认证
  （`DSH_GIT_UI_URL` / `DSH_GIT_UI_STORAGE_STATE`）。
- **版本号** `X.Y.Z`：`X` 用于不兼容的 API/架构变更（dsh 发布 1.x.x 前保持 0）、`Y` 用于新增功能、
  `Z` 仅用于修 Bug 或兼容性优化；细则见 `AGENTS.md` §6。
- 工程约定、坑与发版流程见 `AGENTS.md`；发布由推 `vX.Y.Z` tag 触发 GitHub Actions
  （校验版本一致 → `npm test` → `npm publish --provenance`）。

## 许可

MIT，见 [LICENSE](LICENSE)。
