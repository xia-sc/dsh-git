# NON_GOALS.md — 这个插件刻意不做的功能

> 这是一份**设计边界**，不是待办清单。写在这里的功能，维护者通常不会实现；与它冲突的 PR
> 大概率不会被合入——先开 issue 对齐，比写完再被拒更省事。

## 为什么有这份清单

dsh 是一个 Agent 工具，它对 Git 的操作应当**可预期、可恢复、不需要额外的环境知识**。
`@xia-sc/dsh-git` 因此只聚焦高频、低风险的日常动作——拉取、推送、提交、分支管理和查看差异。

凡是会**重写历史**、**不可撤销地删除工作区数据**，或者需要用户再回终端补一步的功能，都留给
终端和专门的 Git 工具。插件不替代 `git` 命令行，只覆盖日常路径。

## 明确不做

| 功能 | 说明 |
| --- | --- |
| **force push** | 任何形式的强制推送（`--force`、`--force-with-lease`、`+refs/...`）都不提供。改写已推送的历史是团队协作里最危险的 Git 操作之一，多数仓库也会拒绝；插件只做普通推送，推送失败时如实说明。 |
| 改写历史的命令 | `rebase`、`reset`、`cherry-pick`、`revert`、`filter-branch` 等不提供。`amend` 是唯一例外，且只改本地：进入前会检查该提交是否已在远程并二次确认，成功后也**不会**自动推送。 |
| 逐文件 / 逐 hunk 暂存 | 只做「暂存全部」。逐行挑选是编辑器与 `git add -p` 的强项，放进面板会让高频路径变复杂。 |
| 全部丢弃 / 批量删除工作区改动 | 丢弃必须逐条、行内二次确认；没有「全部丢弃」。批量删除不可撤销，一旦点错损失整片工作区。 |
| `stash drop` / `apply` / 编辑储藏 | 只做储藏与恢复（`stash pop`）。储藏内容的管理交给终端。 |
| 合并提交 | `pull` 恒 `--ff-only`，不产生意外的合并提交；不提供 `merge`、解决冲突的图形界面。冲突留给用户在自己熟悉的工具里处理。 |
| 历史 diff / 历史编辑 | 只显示最近提交列表；不提供提交之间的差异对比、修改历史提交（`amend` 除外）。 |
| 自动 fetch / pull / commit / push | 自动刷新是**只读**轮询；任何写操作都要用户显式点击。Agent 面板不应该在后台替用户改变仓库状态。 |
| 写 `git config` / 管理凭据 | 从不修改仓库或全局配置，不碰凭据、SSH key、Credential Manager。缺失 `user.name/email` 时报错说明，而不是代写。 |
| 多仓库 / worktree 管理 | 面板跟随当前会话的工作区；不做仓库列表、worktree 增删、子模块管理。 |
| 需要构建链或第三方依赖的 UI 功能 | 浏览器半是手写 bundle，只允许 `require("react")`；语法高亮、富文本编辑器一类功能因此不做。 |

## 边界内的相邻能力（容易被误认为「不做」）

- **修改上次提交**是支持的：只改本地，且已推送时会先警告并二次确认。
- **储藏与恢复**、**单条丢弃**、**分支切换 / 新建 / 从任意 base 创建**都在支持范围内。
- **提交并推送**是显式的复合动作；它不会替你 force push。

## 如果你确实需要

1. 先在 issue 里描述场景、为什么现有工作流不够用，以及你愿意承担哪些取舍；
2. 维护者会按上面的「聚焦日常、可恢复、不碰历史」原则评估；
3. 与这份清单冲突的实现 PR 通常不会被合入——先讨论再动手，避免白费功夫。真的需要这些能力时，
   终端里的 `git` 本身就是最合适的工具。

## In English (short version)

This is a deliberate design boundary, not a backlog. The plugin focuses on everyday, low-risk Git
operations for an agent-driven workflow: pull, push, commit, branch management and diffs. Anything
that rewrites history (force push, rebase, reset, cherry-pick…), deletes work in bulk, or needs a
terminal round-trip is out of scope — the `git` CLI is the right tool for those. `amend` is the one
local exception, guarded by a push check and a confirmation. Feature requests are welcome as issues;
implementation PRs that conflict with this list are unlikely to be merged.
