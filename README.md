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
| 宿主 | `lib/index.js` | Cordis 插件（bundle 行 `dsh-git`），通过 `ctx.connection.rpc.handle` 挂载 `/dsh-git-rpc` 通道（`authority: "trusted-host"`）。端点：`status`、`branches`、`checkout`、`createBranch`、`fetch`、`pull`、`commit`、`push`、`log`。所有 git 调用都走 `execFile`（无 shell）、带超时（本地 30s / 网络 120s）、严格入参校验。 |
| 浏览器 | `lib/client.js` | `dsh.client` bundle（服务于 `/plugins/@dsh-plugins/dsh-git/client.js`）：悬浮面板 + dock 行 + 共享 store，对照模块表手写（仅依赖 `react`）。 |

## 安装

```sh
dsh plugin --profile web add https://github.com/xia-sc/dsh-git
```

然后**重启 `dsh web`**（bundle 行与浏览器 roster 在启动时组合）。刷新后，
当前会话工作区是 git 仓库时，输入框下方会出现 dock 行。

卸载：

```sh
dsh plugin --profile web remove @dsh-plugins/dsh-git
```

## RPC 约定（`/dsh-git-rpc`）

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
- 测试：`node test/smoke.mjs`（校验/接线，不 spawn git——会话沙箱拦截
  子进程管道 stdio）与 `node test/render.mjs`（双界面真实 React SSR 渲染）。
  git 命令集对照运行中的服务端做端到端验证。
