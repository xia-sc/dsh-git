# @dsh-plugins/dsh-git

[English](./README.en.md) | 中文

DeepSeek Harness Web GUI 的完整 Git 管理插件，形态为一个**可折叠的悬浮面板**，
**实时跟随当前会话的工作区**——在侧边栏点击不同的会话/工作区，面板会瞬间
重新绑定到对应仓库。

**支持的工作流：** 分支切换 · 拉取更新(fetch) · 拉取合并(pull，仅快进) ·
提交(commit) · 推送(push) · 状态(status) · 最近提交 · 未提交文件列表 ·
基于某分支新建分支。

## 界面

- **悬浮面板**（`shell.overlay`）：折叠时不渲染任何元素（不会遮挡输入框）；
  展开后是完整的 Git 工作台（状态行、带 **脏树预检** 的分支切换器——在有
  未提交修改时选择分支，会先显示受影响文件列表警告而不是直接切换，并提供
  "仍要切换"按钮；fetch/pull/commit/push 操作；可折叠的变更列表与最近提交
  列表；上次操作输出）。面板**可通过顶栏拖动**（按住带 Git 标题的那一行，
  拖到哪里就停在哪里，不会拖出视口；顶栏上的按钮/输入框不会触发拖动；
  双击顶栏回到居中位置）。
  分支切换器旁边的"＋ 新建分支"按钮会展开一个内联表单：新分支名 + 基分支
  选择器（本地分支或 `origin/feature/x` 这样的完整远端引用）——确认后从
  该基分支创建新分支并切换过去。
- **输入框胶囊**（`conversation.input.dock`）：输入框左上角的紧凑型左对齐
  状态胶囊（分支摘要，或"当前工作区不是 Git 仓库"）；点击它展开/收起悬浮面板。
- 两处界面共享同一个 store，状态永远一致，并都会随当前会话（及其 cwd）
  切换而重新绑定。

## 架构

一个双面 npm 包：

| 半边 | 文件 | 职责 |
| --- | --- | --- |
| 宿主 | `lib/index.js` | Cordis 插件（bundle 行 `dsh-git`），在自己的 `ctx.webServer` 上注册 `/dsh-git-rpc` 前缀路由，收发浏览器 `connection.rpc.call` 的同一套 Connection RPC 信封，并复用 connection 服务的 Host/Origin + 浏览器会话围栏（`connection.requestRejection`）。端点：`status`、`branches`、`checkout`、`createBranch`、`fetch`、`pull`、`commit`、`push`、`log`。所有 git 调用都走 `execFile`（无 shell）、带超时（本地 30s / 网络 120s）、严格入参校验。 |
| 浏览器 | `lib/client.js` | `dsh.client` bundle（服务于 `/plugins/@dsh-plugins/dsh-git/client.js`）：悬浮面板 + dock 行 + 共享 store，对照模块表手写（仅依赖 `react`）。 |

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

## 安装

```sh
dsh plugin --profile web add https://github.com/xia-sc/dsh-git
```

然后**重启 `dsh web`**（bundle 行与浏览器 roster 在启动时组合）。刷新后，
当前会话工作区是 git 仓库时，输入框上方会出现 dock 胶囊，点击即可展开面板。

要求 **dsh ≥ 0.1.5-rc.1**（宿主半自持 `/dsh-git-rpc` 路由，见上文架构说明）。

卸载：

```sh
dsh plugin --profile web remove @dsh-plugins/dsh-git
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
控制字符）；`remote` 为普通单段；提交信息以 `--message=<msg>` 形式传递
（含控制字符会被拒绝）。

| 端点 | 参数 | 结果（`value`） |
| --- | --- | --- |
| `status` | `{ cwd }` | `{ repo, branch, detached, oid, upstream, ahead, behind, dirty, changes: [{status, path}] }` |
| `branches` | `{ cwd }` | `{ repo, current, local: [{name, current, upstream, sha}], remote: [{name, short}] }` |
| `checkout` | `{ cwd, branch }` | `{ branch, detached, oid, message? }`，经 `git switch --guess`；浏览器会预检脏树并提前警告；因"本地修改会被覆盖"被拒绝时会带上可读前缀。 |
| `createBranch` | `{ cwd, branch, base? }` | `{ branch, detached, oid, message? }`，经 `git switch --create <branch> <base>`（缺省 base 即 HEAD）；从基分支创建新分支并切换过去。 |
| `fetch` | `{ cwd, remote? }` | `{ message }`（120s 超时） |
| `pull` | `{ cwd }` | `{ message }`，经 `git pull --ff-only`（绝不隐式合并） |
| `commit` | `{ cwd, message }` | `{ message }`；未配置 `user.name/email` 时报 `missing-author` 错误 |
| `push` | `{ cwd }` | `{ message }`（120s 超时） |
| `log` | `{ cwd, count? }` | `{ repo, commits: [{sha, author, subject, refs}] }`（钳制 1..50） |

## 设计决策与边界

- **pull 固定 `--ff-only`**：不产生意外的合并提交；冲突以错误形式呈现，
  由用户在自己的工具里解决。
- **commit 不暂存**：只提交已暂存的内容（`git add` 请在自己的工具里完成）。
- **push/pull 凭据**来自系统（Git Credential Manager / SSH agent）；插件
  绝不碰凭据存储。
- **插件绝不修改 git config**；缺 author 时给出明确错误而不是悄悄补写。
- 面板操作是普通 UI 行为（和 Cordis 面板一样），不会写入会话日志 /
  模型提示词。

## 开发说明

- 浏览器 bundle 为手写（无构建步骤）；改 `lib/client.js` 刷新即生效
  （no-cache），改宿主半需要重启 `dsh web`。
- 测试：
  - `node test/smoke.mjs` —— 路由/信封/端点分发/入参校验（不 spawn git：会话沙箱
    拦截子进程管道 stdio）；
  - `node test/host-mount.mjs` —— 在真实 Cordis + 真实 `dsh-client-connection`
    上挂载插件行（从 `DSH_HOME` 的 profile 解析 DSH 包，找不到则 SKIP）；
  - `node test/render.mjs` —— 双界面真实 React SSR 渲染（需要一份 react/react-dom，
    可用 `DSH_GIT_REACT_ROOT` 指定，找不到则 SKIP）。
  - 也提供 `npm test`（依次跑三个）。
  git 命令集对照运行中的服务端做端到端验证。
