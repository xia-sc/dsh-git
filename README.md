# @xia-sc/dsh-git

[English](./README.en.md) | 中文

DeepSeek Harness Web GUI 的完整 Git 管理插件，形态为一个**可折叠的悬浮面板**，
**实时跟随当前会话的工作区**——在侧边栏点击不同的会话/工作区，面板会瞬间
重新绑定到对应仓库。

**支持的工作流：** 分支切换 · 拉取更新(fetch) · 拉取合并(pull，仅快进) ·
暂存全部 · 提交(commit，可用 AI 起草提交信息) · 推送(push) · 状态(status) ·
最近提交 · 未提交文件列表 · **点击变更看差异** · 基于某分支新建分支。

## 界面

- **悬浮面板**（`shell.overlay`）：折叠时不渲染任何元素（不会遮挡输入框）；
  展开后自上而下是一条工作流：状态行（未提交计数、领先/落后、上游）→
  带 **脏树预检** 的分支切换器（有未提交修改时选择分支，会先显示受影响文件列表
  警告而不是直接切换，并提供"仍要切换"按钮）→ **网络工具条**（拉取更新 / 拉取合并 /
  推送，三等宽，"推送"是主按钮）→ **提交卡片**（"暂存全部" + AI 生成依据 +
  "✨ AI 生成"三等宽，下面是提交信息输入框（多行文本框，回车换行、Ctrl/Cmd+Enter
  提交）与提交按钮）→ 两张列表卡片。按钮一律**等宽分栏**，不再是一排宽窄不一的按钮。
  **操作反馈固定钉在面板最上边，而且只有一行**——"推送中…"和上次操作的结果都在
  body 的第一行；结果是一个中文短句（"已推送"／"已暂存全部"／"已切换到 xxx"），git 自己的输出
  （push 的 sideband banner、`LF will be replaced by CRLF` 这类提示）收在右侧的"详情 ▾"里，点开才展开，
  不会被变更列表和最近提交顶到看不见的地方。面板**可通过顶栏拖动**（按住带 Git 标题的
  那一行，拖到哪里就停在哪里，不会拖出视口；顶栏上的按钮/输入框不会触发
  拖动；双击顶栏回到居中位置）。
  分支切换器旁边的"＋ 新建分支"按钮会展开一个内联表单：新分支名 + 基分支
  选择器（本地分支或 `origin/feature/x` 这样的完整远端引用）——确认后从
  该基分支创建新分支并切换过去。
- **变更 / 最近提交两张卡片**：变更列表每行是「等宽路径 + 状态色标签」（路径在左，
  所以一列路径对得齐；修改=橙、新增·未跟踪=绿、删除·冲突=红、重命名=蓝，
  当前正在看的那一行整行高亮）；最近提交每行是「短 sha + 主题」。两张卡片的标题行
  （`▾ 变更 12`）点一下整段收起/展开，**默认展开**——面板不该把用户自己的改动藏起来；
  列表超过 8 / 5 行时底部出现「显示全部 N 项」，与折叠是两件事，所以箭头永远指对方向。
- **刷新不闪**：点 ↻ 或任何操作之后的重读都**保留面板内容**（同一个工作区不会退回
  一行 "读取中…" 再弹回来），只在标题栏把刷新按钮置灰并写着"刷新中…"。
- **点击变更看差异**：点变更列表里的任意一行，面板会从 400px 的单栏展开成
  两栏——左边照旧是完整工作台，右边是该文件的 unified diff（见下文
  「差异查看」）。再点同一行、或点差异标题栏的 `×`，就收回单栏。
- **输入框胶囊**（`conversation.input.dock`）：输入框左上角的紧凑型左对齐
  状态胶囊（分支摘要，或"当前工作区不是 Git 仓库"）；点击它展开/收起悬浮面板。
- 两处界面共享同一个 store，状态永远一致，并都会随当前会话（及其 cwd）
  切换而重新绑定。切换工作区会清空已选中的文件——绝不让面板显示别的仓库的内容。
- **git 的文字输出会剥掉 ANSI 颜色码**：远端会给自己的 banner 上色（gitee 的
  `Powered by GITEE.COM` 就是），面板是 DOM 不是终端，ESC 没有字形可渲染，
  不剥就只剩 `[0[01;33m` 这类参数当正文显示。只剥"消息"文本（`message`），
  **diff 内容与文件名一律逐字节保真**。

### 差异查看

点变更列表里的一行，就在右侧显示该文件的 git diff。左侧列表是它的导航：
行高亮表示"正在看这一个"，首次点击会自动把变更列表展开成完整列表。

- **可拖拽调宽**：拖动**面板最右侧那条边**即改差异栏宽度——左栏（工作台）宽度不变，
  面板整体变宽、差异栏跟着长；双击这条边复位。面板始终留在视口内，窗口变窄时
  会自动收回；拖动时面板会就地锚定左边缘，所以指针与这条边是 1:1 跟手的。
- **打开差异时尺寸是稳定的**：一选中文件，面板就定好了高度（两栏都铺到面板底部），
  diff 读回来、切文件、来回点收起都只在栏内滚动，面板本身不会跟着内容跳一下。
- **未暂存 / 已暂存**：默认自动跟随数据——未暂存有内容就显示未暂存，否则显示
  已暂存；顶部两个 chip 可手动切换，空的一侧置灰。同一个文件两边都有改动时，
  一次点击看到的是最关心的那一侧，另一侧一键可达。
- **自动刷新**：暂存、提交、切分支、刷新之后，打开的差异会自己重读——未暂存
  变空时会自动落到已暂存。
- **行号与配色**：左右两列行号（旧/新）取自每个 hunk 头，`+`/`-` 行走主题的
  成功/错误色，hunk 头单独一行，`\ No newline at end of file` 灰显。
- **边界都有明确提示**：这一侧没有改动 / 二进制文件没有文本差异 / 差异过大只
  显示开头一段 / 未跟踪目录里还有 N 个文件未展开 / 读取失败。超过 1500 行的
  差异先渲染前 1500 行，按钮可展开全部（避免一次渲染几万个节点）。
- **未跟踪文件**：与空文件对比，显示成 `new file mode` 的新增 diff；未跟踪
  **目录**会把里面的文件逐个展开（上限 50 个，其余计入提示）。
- **重命名**：同时把旧名与新名作为 pathspec 交给 git，否则 git 无法配对，会把
  一次重命名报成整文件新增。

### 提交区与 AI 起草

提交区按真实操作顺序排列：**暂存全部 → AI 生成 → 提交**。

- **暂存全部**：`git add --all`（含删除与未跟踪文件）。工作区干净时置灰。
  这是"只有未暂存改动、点提交却报错"的正解——提交本身依然**不会**隐式暂存。
- **AI 生成依据**：三选一，决定把哪一部分改动交给模型：
  `已暂存`（默认）、`未暂存`、`全部`。默认 `已暂存`，因为**只有它是本次
  提交真正会记录的内容**——用其他依据生成的描述可能与实际提交不符。
- **✨ AI 生成**：把选中的改动（diffstat + diff，截断后）交给当前会话所选
  模型，生成的提交信息直接填入输入框；不满意可改，也可以直接手写。

生成用的模型路由取当前会话的 `modelSelection` 投影（待生效的选择优先，
其次是上次实际使用），取不到时回落到宿主注册的第一条路由。请求会带上**当前会话 id**
（`sessionId`），因为部分网关（例如本机配置的 opencode 系路由）要求会话亲和头，
而宿主只在请求带 `sessionId` 时才把它转给适配器——不带就会被网关以
`MissingSessionID` 拒掉。失败会以本地化文案显示在"上次操作输出"里
（无可用改动 / 未配置模型 / 生成失败等；未知失败码先给本地化短句，再附宿主的原始诊断）。

## 架构

一个双面 npm 包：

| 半边 | 文件 | 职责 |
| --- | --- | --- |
| 宿主 | `lib/index.js` | Cordis 插件（bundle 行 `dsh-git`），在自己的 `ctx.webServer` 上注册 `/dsh-git-rpc` 前缀路由，收发浏览器 `connection.rpc.call` 的同一套 Connection RPC 信封，并复用 connection 服务的 Host/Origin + 浏览器会话围栏（`connection.requestRejection`）。端点：`status`、`branches`、`checkout`、`createBranch`、`fetch`、`pull`、`stage`、`diff`、`commit`、`push`、`log`、`generateMessage`。所有 git 调用都走 `execFile`（无 shell）、带超时（本地 30s / 网络 120s）、严格入参校验。AI 生成走注入的 `llm` 服务。 |
| 浏览器 | `lib/client.js` | `dsh.client` bundle（服务于 `/plugins/@xia-sc/dsh-git/client.js`）：悬浮面板 + dock 行 + 共享 store，对照模块表手写（仅依赖 `react`）。 |

### 为什么自持 HTTP 路由（dsh ≥ 0.1.5-rc.1）

dsh 0.1.5-rc.1 起，外部插件不能再调用 `ctx.connection.rpc.handle()`：
`HostConnectionService.rpc` 闭包持有的是 **connection 插件自己的 Context**（`inject`
只有 `["credentials"]`），注册时执行
`owner.effect(() => owner.webServer.register(route))`，而该插件只在内部的
`ctx.inject(["webServer"], …)` 作用域里取得到 `webServer`。于是无论调用方 inject 了
什么，这一行都会以 `cannot get property "webServer" without inject` 挂载失败
（0.3.0 正是如此，插件在 0.1.5-rc.1 上装不起来）。本插件因此改为自己注册
`/dsh-git-rpc` 路由、自己实现同一套 RPC 信封；请求围栏仍交给 connection 服务的
`requestRejection`，安全等级与 `/api` 完全一致。`test/host-mount.mjs` 在真实 Cordis +
真实 Connection 服务上守护这一点。

### 会话绑定由会话座位提供（dsh ≥ 0.1.6-alpha.2）

两个界面此前都从 sessions 列表快照里读 `current`（当前会话 id）。0.1.6-alpha.2 把这个
字段去掉了——列表快照只剩 `ids` / `byId` / `phase` / `subagentsByParent` /
`jobsBySession`，当前会话改由渲染器的作用域适配器（`SlotScopeAdapter.current`，由
`retainedBy.mainView` 推出）投递给**会话作用域**的座位，根作用域的 `shell.overlay`
读不到它（症状是胶囊和面板一起静默消失，没有任何报错）。

现在：**胶囊**（`conversation.input.dock`，会话作用域，框架直接给出 `sessionId`）
从 `useSessions` 快照里取该会话的 `cwd`，调用 `store.bindSession(sessionId, cwd)`；
**面板**只读共享 store 的 `sessionId` / `cwd`（它另外用 `sessionId` 取
`modelSelection` 投影来定 AI 起草的路由）。`byId[id].retainedBy.mainView` 用来排除
右栏里的嵌入式会话（子会话 chat），快照不带这个计数时按主视图放行。

## 安装

```sh
dsh plugin --profile web add @xia-sc/dsh-git
```

也可以直接从源码装（两个渠道同源，npm 上的版本就是对应 tag 的产物）：

```sh
dsh plugin --profile web add https://github.com/xia-sc/dsh-git
```

然后**重启 `dsh web`**（bundle 行与浏览器 roster 在启动时组合）。刷新后，
当前会话工作区是 git 仓库时，输入框上方会出现 dock 胶囊，点击即可展开面板。

要求 **dsh ≥ 0.1.5-rc.1**（宿主半自持 `/dsh-git-rpc` 路由，见上文架构说明）。

卸载：

```sh
dsh plugin --profile web remove @xia-sc/dsh-git
```

## RPC 约定（`/dsh-git-rpc`）

浏览器侧通过 `ctx.connection.rpc.call("/dsh-git-rpc", endpoint, { args })` 调用；宿主侧
是本插件自持的 `/dsh-git-rpc/*` 前缀路由，收发与 `/api` 相同的 Connection 信封：

- 请求：`POST /dsh-git-rpc/<endpoint>`，`content-type: application/json`，
  `{ type: "client-request", rpcId, method: <endpoint>, payload: { args } }`
- 响应：`{ type: "server-response", rpcId, result: { ok: true, value } | { ok: false, error } }`
- 围栏：`connection.requestRejection`（Host/Origin + 浏览器会话 Cookie）；非 `POST` → 405，
  非 JSON → 415，请求体超限 → 413，路径不属于本通道 → 404。

载荷使用 `{ args }` 约定。`cwd` 必须是绝对路径；`branch` 匹配
`^[A-Za-z0-9][A-Za-z0-9._/-]*$`（不允许前导 `-`、`..`、`@{`、`\`、空白、
控制字符）；`remote` 为普通单段。提交信息是真正的提交信息：一行主题 +
可选的多行正文。CRLF 会归一为 LF，逐行去掉行尾空白，去掉首尾空行并把连续
空行折叠为一行（因此主题与正文之间那一行空行会保留）；空、超长（>10000
字符）、含控制字符的信息报 `invalid-message`。信息经 stdin 以
`git commit --cleanup=whitespace --file=-` 传入，因此空格、引号、换行、shell
元字符、前导 `-` 都会被原样记录。

| 端点 | 参数 | 结果（`value`） |
| --- | --- | --- |
| `status` | `{ cwd }` | `{ repo, branch, detached, oid, upstream, ahead, behind, dirty, changes: [{status, path, index, worktree, file, origFile}] }`。`path` 是展示串（重命名读作 `old → new`），`file`/`origFile` 是交给 `diff` 的 pathspec，`index`/`worktree` 是 porcelain-v2 的两个字母。 |
| `branches` | `{ cwd }` | `{ repo, current, local: [{name, current, upstream, sha}], remote: [{name, short}] }` |
| `checkout` | `{ cwd, branch }` | `{ branch, detached, oid, message? }`，经 `git switch --guess`；浏览器会预检脏树并提前警告；因"本地修改会被覆盖"被拒绝时会带上可读前缀。 |
| `createBranch` | `{ cwd, branch, base? }` | `{ branch, detached, oid, message? }`，经 `git switch --create <branch> <base>`（缺省 base 即 HEAD）；从基分支创建新分支并切换过去。 |
| `fetch` | `{ cwd, remote? }` | `{ message }`（120s 超时） |
| `pull` | `{ cwd }` | `{ message }`，经 `git pull --ff-only`（绝不隐式合并） |
| `stage` | `{ cwd }` | `{ message }`，经 `git add --all` |
| `diff` | `{ cwd, path, origPath? }` | `{ repo, path, origPath, untracked, skipped, worktree: {diff, binary, truncated}, index: {…} }`。两侧一次读回（`git diff [--cached] --no-ext-diff --no-color -- <path> [<origPath>]`）；`path` 必须是仓库内相对路径（拒绝绝对路径、`..`、前导 `-`、控制字符、首尾空白），非法时报 `invalid-path`。未跟踪路径用 `git diff --no-index -- /dev/null <path>`（容忍退出码 1），未跟踪目录用 `git ls-files --others --exclude-standard` 展开（上限 50 个，其余计入 `skipped`）。单侧超过 40 万字符在行边界截断并置 `truncated`；二进制置 `binary`。**只读**，不碰 index / 工作区 / 配置。 |
| `commit` | `{ cwd, message }` | `{ message }`；未配置 `user.name/email` 时报 `missing-author` 错误 |
| `push` | `{ cwd }` | `{ message }`（120s 超时） |
| `log` | `{ cwd, count? }` | `{ repo, commits: [{sha, author, subject, refs}] }`（钳制 1..50） |
| `generateMessage` | `{ cwd, mode?, provider?, model?, sessionId? }` | `{ message, mode, provider, model }`。`mode` 为 `staged`（默认）/`unstaged`/`all`，非法值报 `invalid-mode`；`sessionId` 为可选的非空字符串（超过 200 字符报 `invalid-session`），面板会带上当前会话 id 供需要会话亲和的网关路由。失败码见 `error.details.code`：`no-changes`、`no-provider`、`no-model`、`llm-truncated`（输出上限用尽、一个字都没写出来）、`llm-empty`、`cancelled`、`llm-failed`。 |

> 失败结果的 `error.code` 在线路上固定为 `"internal"`（Connection 信封只要求它是字符串），
> 插件自己的诊断码放在 `error.details.code`；客户端按该码做本地化文案。
>
> `fetch`/`pull`/`push`/`stage`/`commit` 的 `message` 就是 **git 自己的输出**（已剥掉 ANSI 颜色码）：
> git 什么都没说时是空串，界面用 `output.<action>` 的中文短句做通知、把这段原文放进可展开的"详情"。

## 设计决策与边界

- **pull 固定 `--ff-only`**：不产生意外的合并提交；冲突以错误形式呈现，
  由用户在自己的工具里解决。
- **commit 不暂存**：只提交已暂存的内容。想一次提交全部改动，用提交区的
  "暂存全部"按钮（`git add --all`），而不是让提交隐式暂存。
- **AI 生成会把改动的 diff 发给你配置的模型提供方**——可能是第三方网关。
  这是显式点击"✨ AI 生成"才会发生的联网行为；插件本身不联网。diff 截断到
  12000 字符后发送，且不发送任何仓库外的内容。输出上限 8192 token：思考型
  模型的 reasoning 与正文共用同一份 completion 预算，上限太小会"一个字都没
  写就超限"，此时报 `llm-truncated` 而不是含糊的 `llm-empty`。
- **push/pull 凭据**来自系统（Git Credential Manager / SSH agent）；插件
  绝不碰凭据存储。AI 生成同样不接触凭据——API key 由模型适配器自己解析。
- **插件绝不修改 git config**；缺 author 时给出明确错误而不是悄悄补写。
- **差异查看是纯只读的**：`diff` 端点只跑 `git diff` / `git ls-files`，不写
  index、不动工作区、不改配置；它**不依赖**宿主右侧 Sidebar 那套标签页 API
  （那部分还在快速迭代），而是面板内自带两栏——左侧工作台照旧，右侧差异栏。
  差异渲染也是自己写的（本 bundle 只依赖 `react`）：解析统一 diff、双行号、
  `+`/`-` 配色，不引任何语法高亮依赖。
- **重命名必须同时传旧名与新名**：git 只在旧名也在 pathspec 里时才配对，只给
  新名会把一次重命名报成整文件新增（`test/diff.mjs` 守护这一点）。
- **status 的 porcelain-v2 解析**：`2`（rename/copy）记录的路径在第 10 个字段、
  与旧名以 TAB 分隔，`u`（冲突）记录的路径在第 11 个字段且状态恒为冲突——这
  两处曾按 `slice(8)` / `slice(9)` 取值而错位，现在由 `changeEntry()` 统一构造。
- **插件不导入任何 `@deepseek-ai/*` 运行时包**（只用 `node:` 内置模块和
  `@deepseek-ai/cordis`）。以 pnpm `link:` 方式安装时，宿主包无法从插件的真实
  源码路径解析，声明这类导入会让插件在加载期就崩溃；生成所需的请求构造与流
  式拼装因此就近实现。`test/generate.mjs` 直接测这些单元。
- 面板操作是普通 UI 行为（和 Cordis 面板一样），不会写入会话日志 /
  模型提示词。AI 生成只填输入框，不会自动提交。

## 开发说明

- 浏览器 bundle 为手写（无构建步骤）；改 `lib/client.js` 刷新即生效
  （no-cache），改宿主半需要重启 `dsh web`。
- 测试：
  - `node test/smoke.mjs` —— 路由/信封/端点分发/入参校验（不 spawn git：会话沙箱
    拦截子进程管道 stdio）；
  - `node test/host-mount.mjs` —— 在真实 Cordis + 真实 `dsh-client-connection`
    上挂载插件行（从 `DSH_HOME` 的 profile 解析 DSH 包，找不到则 SKIP）；
  - `node test/generate.mjs` —— AI 生成单元测试：路由解析、prompt 组装、截断、
    流式拼装（block-end 与纯 delta 两条路径）、终止失败/取消/空输出；
  - `node test/render.mjs` —— 双界面真实 React SSR 渲染，含提交区三个控件、
    diff 解析器（行号 / 分类 / `--` 开头的删除行）、行渲染、差异面板标题栏与
    `act()` 的结果回传/本地化（需要一份 react/react-dom，可用
    `DSH_GIT_REACT_ROOT` 指定，找不到则 SKIP）。
  - 也提供 `npm test`（依次跑四个）。
  - `npm run test:commit` —— **端到端**：在临时仓库里真起 git，走插件的
    `/dsh-git-rpc/commit` 路由提交，再用 `git log --format=%B` 逐字节比对提交
    信息（多行、CRLF、中文、前导 `-`、shell 元字符等），并确认非法信息被拒且
    不产生提交。
  - `npm run test:diff` —— **端到端**：临时仓库里逐个验证 `diff` 端点：工作区
    / 已暂存两侧、未跟踪文件与**未跟踪目录**、**重命名配对**、删除、二进制、
    40 万字符截断、以及路径校验与非仓库目录。
  - 后两个都必须 spawn git 的管道 stdio，故**不在 `npm test` 内**——请在没有
    该限制的环境（普通终端）单独运行。
  git 命令集对照运行中的服务端做端到端验证。

## 许可

MIT，见 [LICENSE](LICENSE)。
