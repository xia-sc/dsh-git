# AGENTS.md — 给在本仓库工作的 Agent 的说明书

面向在本仓库里干活的 AI agent（以及人类协作者）。**只写这个仓库特有的东西**：通用编程常识、
以及 `README.md` 已经讲清楚的功能介绍与 RPC 契约，这里不重复。

- 包名 `@xia-sc/dsh-git`，DeepSeek Harness Web GUI 的 Git 插件（双面包：宿主半 + 浏览器半）。
- 安装方式：`dsh plugin --profile web add @xia-sc/dsh-git`（npm）或
  `dsh plugin --profile web add https://github.com/xia-sc/dsh-git`（源码），之后**重启 `dsh web`**。
  两个渠道同源（npm 上是同名 tag 的产物），发布流程见 §7。
- 功能说明、端点契约、设计决策看 `README.md`（中文主文档）/ `README.en.md`。
- **宿主换版兼容性**（升级 dsh 后"静默失效"的已知原因、排查顺序、修法与守护测试）看 `COMPAT.md`。
  换版后先读它，别在这里堆版本故事。
- 当前版本见 `package.json`。

## 1. 目录与职责

| 路径 | 职责 | 注意 |
| --- | --- | --- |
| `lib/index.js` | 宿主半：Cordis 插件行 `dsh-git`，自持 `/dsh-git-rpc` 前缀路由，端点分发（`dispatch`）、入参校验、`runGit`、`ok`/`fail` 信封 | 只有宿主半边的东西；改它必须重启 `dsh web` |
| `lib/client.js` | 浏览器半：**手写产物，无构建步骤**，一个 `__ModuleLoader__.load` factory 里装着全部 UI + store + diff 渲染 | 禁止引进构建链；改它刷新页面即生效 |
| `cordis.patch.yml` | 组合层 patch：一条 `insert` 行（`id: dsh-git` / `name: '@xia-sc/dsh-git'`） | **故意不写 `inject`**——模块导出的 `inject` 才是 Cordis 读的声明 |
| `test/smoke.mjs` | 路由/信封/端点分发/入参校验 + 客户端 bundle 结构；**不 spawn git** | 默认门禁，`npm test` 第一个 |
| `test/host-mount.mjs` | 在真 Cordis + 真 `dsh-client-connection` 上挂载插件行，并用**宿主自己的 zod schema** 校验手写信封（真路由处理器 + 假 req/res；从 `DSH_HOME` 的 profile 解析；找不到就 SKIP） | 宿主换版后先跑这个 |
| `test/slot-mount.mjs` | 用**真** `SlotCore`/`SlotRegistry` + 真渲染器把两个座位挂起来（真 Cordis、真 `useSessions`/`sessionId`/`locale` 座位、无 `data-slot-error`） | 浏览器半的换版守护；SSR 跑不到 effect（见文件头），找不到宿主包就 SKIP |
| `test/generate.mjs` | AI 起草提交信息的纯单元：路由解析、prompt、截断、流式拼装、失败码 | 不 spawn git |
| `test/render.mjs` | 双界面真实 React SSR：两个座位、提交区控件、diff 解析器与行渲染、`act()` 回传 | 需要 `react`/`react-dom`，见 §5 |
| `test/diff.mjs` | **端到端**：真临时仓库跑 `diff` 端点（两侧、未跟踪文件/目录、重命名配对、删除、二进制、截断、校验） | 需要 spawn git，不在 `npm test` 内 |
| `test/commit.mjs` | **端到端**：真临时仓库走 `commit` 端点，用 `git log --format=%B` 逐字节比对 | 同上 |
| `test/ui/*.mjs` | 手动浏览器脚本（playwright-core 打真实 GUI），`verify-diff.mjs` 是差异面板的回归 | 需要认证 URL，见 §8 |
| `COMPAT.md` | 宿主版本兼容性笔记：每条按「症状 → 证据 → 根因 → 修法 → 守护测试」记，外加换版后的排查顺序 | 换版/静默失效时先读它；版本故事只写这里 |
| `.github/workflows/publish.yml` | 唯一一条 CI：推 `vX.Y.Z` tag → 校验 tag 与 `package.json` 一致 → `npm test` → `npm publish --provenance`（OIDC trusted publishing；没登记时用 `NPM_TOKEN` secret） | 不装依赖、不打包（§3.1）；认证的一次性配置见 §7 |

## 2. 常用命令

```powershell
npm test                  # smoke → host-mount → slot-mount → generate → render（不 spawn git）
node test/smoke.mjs       # 单独跑；改任何文件后最快的门禁
npm run test:diff         # 端到端 diff（必须能 spawn git，见 §8）
npm run test:commit       # 端到端 commit
$env:DSH_GIT_REACT_ROOT = "<含 react 与 react-dom 的 node_modules>"   # render 测试前置
node test/render.mjs
node test/ui/verify-diff.mjs            # 默认 fixture 拦截，验证客户端半边
$env:DSH_GIT_UI_LIVE = "1"; node test/ui/verify-diff.mjs   # 打真端点（需先重启 dsh web）
```

没有 lint、没有 typecheck、没有 PR 检查（`.github/` 里只有一条发布 workflow，见 §7）；
没有 eslint/prettier/tsconfig。**门禁仍然是测试**，别指望自动化兜底。

## 3. 硬约束（违反了会静默坏掉）

### 3.1 浏览器半写的就是最终产物，且模块表里只有 `react`

`lib/client.js` 靠 `window.__ModuleLoader__.load({ id, factory })` 自注册，factory 收到的 `require`
**只能解析 `react`**（`test/smoke.mjs` 会对其它 spec 直接抛 `unexpected require`）。因此：

- 不要 `require("react-dom")`、不要 `import` 任何东西、不要引入 JSX 或构建步骤；
- 组件用 `h(type, props, ...children)`（对 `React.createElement` 的包装），样式全部走模块内的 `S` 内联样式表；
- 需要的能力自己实现（diff 解析与渲染就是这么来的）。

### 3.2 宿主半不导入任何 `@deepseek-ai/*` 运行时包

宿主半只用 `node:` 内置模块 + 已经导入的 `@deepseek-ai/cordis`。以 pnpm `link:` 方式安装时，宿主包
无法从插件的真实源码路径解析，声明这类导入会让插件**在加载期就崩**。`llm` 走注入的服务，不用 import。

### 3.3 宿主 `inject` 是硬依赖，且 `connection.rpc.handle()` 对外部插件不可用

- `lib/index.js` 顶部：`inject = ["webServer", "connection", "llm"]`。缺 `webServer` 路由挂不上；缺 `connection`
  没有围栏；缺 `llm` AI 起草不可用。
- dsh ≥ 0.1.5-rc.1 起，外部插件调用 `ctx.connection.rpc.handle()` 会以
  `cannot get property "webServer" without inject` 挂载失败（原因见 `lib/index.js` 头部注释与 README）。
  本插件的做法是**自持 `/dsh-git-rpc` 路由**并自己收发同一套 Connection 信封。
  （来龙去脉见 `COMPAT.md` §2。）
- **绝不能去掉围栏**：`connection.requestRejection(req)` 的 Host/Origin + 浏览器会话检查是这个通道唯一的安全门，
  它的安全等级必须与 `/api` 完全一致。`apply()` 里若拿不到 `requestRejection` 会主动抛错，不要改成降级放行。
- 新增端点要同时改三处：`dispatch` 的 `case`、README 的端点表、以及 `test/smoke.mjs` 的校验矩阵。

### 3.4 宿主与客户端生效时机不同

| 改了 | 怎么生效 |
| --- | --- |
| `lib/client.js` | 刷新页面（服务端 no-cache） |
| `lib/index.js` | **必须重启 `dsh web`**，否则界面会显示 `unknown git endpoint "<新端点>"` |
| `cordis.patch.yml` / `package.json` 的 `dsh` 段 | 重启 `dsh web`（浏览器 roster 与 bundle 行在启动时组合） |

**不要为了验证去重启用户正在使用的 `dsh web`**——那个进程同时承载着当前会话。要么请用户重启，
要么先用 `test/diff.mjs` 这类直接驱动路由处理器的测试覆盖宿主改动。

### 3.5 所有 git 调用：`execFile`、无 shell、带超时、严格校验

- 一律经 `runGit(cwd, args, signal, timeoutMs, stdin, allowExit)`；参数是数组，绝不拼字符串进 shell；
  本地 30s、网络（fetch/pull/push）120s；输出上限 32MB。
- 入参在跑 git 之前校验：`cwd` 必须绝对；`branch` 匹配 `^[A-Za-z0-9][A-Za-z0-9._/-]*$`；`remote` 是单段；
  `path` 必须仓库内相对路径（见 `normalizedPath`：拒绝绝对路径、`..`、前导 `-`、控制字符、首尾空白）。
- `git diff --no-index` 把"两边不同"报成退出码 1，所以 `runGit` 有 `allowExit` 参数；别把非零退出码
  一律当成失败，也别为了绕过它去改 git 行为。
- **只读端点必须只读**：`diff` 只跑 `git diff` / `git ls-files`，不写 index、不动工作区、不改配置。

### 3.6 错误码约定

线上 `error.code` **恒为 `"internal"`**（Connection 信封只要求它是字符串），插件自己的诊断码放在
`error.details.code`（如 `invalid-cwd`、`invalid-path`、`unknown-endpoint`、`no-changes`…），客户端按这个码做本地化。
新增失败分支时两处都要给：人类可读的 `message` + 稳定的诊断码。

### 3.7 行为边界（README 已承诺，别悄悄改）

- **`commit` 不隐式暂存**：只提交已暂存内容；想全提交用「暂存全部」（`git add --all`）。
- **`pull` 恒 `--ff-only`**：不产生意外合并提交。
- **绝不修改 git config**；缺 `user.name/email` 时报 `missing-author`，不要替用户补写。
- **绝不碰凭据**：push/pull 用系统凭据管理器 / SSH agent。
- 面板操作是普通 UI 行为，不写会话日志、不进模型提示词；AI 起草只填输入框，不自动提交。

## 4. 浏览器半的结构（改它之前先读这段）

- 单 factory，顺序大致是：i18n 字典（`zh`/`en` + `NS = "dshGit"`）→ `h()` 与 `S` 样式表 → `rpc()`/`createGitStore`
  → diff 解析与渲染 → `GitDiffPane` → `GitFloatingPanel` → `GitDockLine` → `apply()`。
- 两个座位共用一个 store：`shell.overlay`（`id: dsh-git-panel`，悬浮面板）与 `conversation.input.dock`
  （`id: dsh-git-pill`，输入框胶囊）。两处共享同一个 `createGitStore(ctx)` 实例，状态必须永远一致。
- **会话绑定归会话座位所有**：`conversation.input.dock`（会话作用域，框架给 `sessionId` prop）负责把
  `sessionId` + `cwd` 绑进 store（`store.bindSession`），根作用域的 `shell.overlay` **只读 store**，
  自己不去找"当前会话"。**别反转这两边**——0.1.6-alpha.2 起根作用域根本查不到当前会话，
  反转的后果是胶囊与面板一起**静默**消失。完整原因、证据与判据见 `COMPAT.md` §1。
- 状态订阅用 `useState + useEffect`（**不要用 `useSyncExternalStore`**）。理由不是"seed 是坏的"——
  渲染器给标准 hook（`useSessions`）用的就是 `useSyncExternalStoreWithSelector`，且优先用 React 自带实现
  （`dsh-client-ui-renderer/lib/client.js` 的 `exports.useSyncExternalStore = void 0 !== e.useSyncExternalStore ? …`）；
  这样写只是让本 store 的订阅不依赖 seed 里那份 uSES 实现。别再把它写成"18.3.1-next 会返回 undefined"。
- 所有面向用户的字符串都进 `NS` 字典（zh + en 两份，键必须对齐）；面板宽度/颜色等一律用主题变量
  `var(--dsw-alias-*, <fallback>)`，别写死颜色。
- **两栏布局与宽度手柄**：`selected` 非空时 body 变成 `[左栏 300][diff pane]`；宽度手柄是**面板最右侧那条边**
  （绝对定位的 `panel-resize`），拖拽时先把面板锚定到当前左边缘再改宽度（居中的面板是 `translateX(-50%)`，
  不锚定的话指针与边会差 2 倍距离）。宽度算式里的常量（`DIFF_LEFT_PANE_WIDTH`、`PANEL_BORDER_WIDTH`、
  `DIFF_MIN_WIDTH`）与 CSS 必须一致，面板用 `box-sizing: border-box`——这几处错一个就会出现"差 24px/2px"。
  面板盒子统一由 `panelBoxStyle(selected, diffWidth)` 算（单栏 = 内容高度 + 400px；两栏 = `DIFF_PANEL_HEIGHT`
  **固定高度** + 左栏 + 边框 + diff）。**两栏必须固定高度，不能只给 maxHeight**：面板 `bottom` 定位、高度跟
  内容走时，diff 异步读回来那一刻面板会长高、整个面板往上跳——这就是"点开 diff 闪一下"。`DIFF_PANEL_HEIGHT`
  取 `min(72vh, calc(100vh - 184px))`，短窗口也不会顶出视口；`test/render.mjs` 直接断言两栏的
  `height === maxHeight === DIFF_PANEL_HEIGHT`。
- diff 渲染的关键规则：`--- `/`+++ ` **只在 hunk 之外**认作文件头（hunk 内以 `--` 开头的删除行仍是改动）；
  未换行时行宽取 `max-content`（底色铺满横向滚动），换行时置 0（否则 `pre-wrap` 永不生效）；换行属性要写在
  文本 span 上（它自带 `white-space: pre`，写在行上会被覆盖）。
- **`data-dsh-git` 是测试钩子**，改名等于改测试：`dock`、`dock-row`、`panel`、`panel-drag`、`panel-left`、
  `panel-resize`、`output`、`output-toggle`、`output-detail`、`changes`、`changes-header`、`changes-body`、
  `changes-more`、`log`、`log-header`、`log-body`、`log-more`、`change-row`、`diff`、`diff-header`、`diff-body`、
  `diff-row`、`diff-close`、`diff-wrap`、`diff-copy`、`diff-reload`、`diff-scope-worktree`、`diff-scope-index`、
  `diff-empty`、`diff-binary`、`diff-untracked`；行还有 `data-kind`、选中行有 `data-active`。
- **列表区块是两张卡片**（`sectionView`）：标题行 = chevron + 文案 + 计数胶囊，整段折叠；`all=false` 时只显示
  前 `CHANGES_PREVIEW`/`LOG_PREVIEW` 行并在底部给「显示全部 N 项」。**折叠与展开预览是两个 state**
  （`changesOpen`/`changesAll`），别合并回一个——合并过的那版箭头在"列表明明在屏幕上"时指向"收起"，就是
  用户说的"折叠逻辑有点问题"。section 默认展开，空列表用 `empty` 文案（别在标题里塞 count 之外的参数）。
- **同一个工作区的重读不许清空界面**：`doRefresh` 里 `keep = cwd === state.cwd && phase === "ready"` 时保持
  `phase` 不变、只置 `refreshing`，否则点 ↻ / 操作后的重读会把工作台收成一行 loading 再弹回来（"界面跳一下"）。
  注意 `refreshing` 必须由 `idleState()` 复位，别只靠 emit。
- **配色只用主题真的定义过的 alias token**：Inspect Theme 报的 13 个是一个子集，完整名字在
  `dsh-client-ui-theme` 的生成 CSS 里（`grep '--dsw-alias-<name>:'`）。改配色前先核对一遍——用不存在的
  名字（如 `--dsw-alias-surface-tertiary`、`--dsw-alias-separator-primary`、`--dsw-alias-label-quaternary`）
  不会报错，只会静默落到兜底的硬编码 rgba，浅色主题下就露馅。淡色底一律
  `color-mix(in srgb, <token> N%, transparent)`（harness 自己就在用 `color-mix`）。状态标签用
  `changeTagStyle(status)`：`background` 是 `color-mix(currentColor…)`，所以新增状态只要给一个 token。
- **两个颜色陷阱**（都踩过）：
  1. `--dsw-alias-brand-primary` 是**反相强调色**（浅色主题=近黑 `neutral-bluish-1000`，深色主题=近白
     `neutral-bluish-50`），不是蓝。主按钮必须用 harness 自己的搭配：
     `background: var(--dsw-alias-button-primary-fill)` + `color: var(--dsw-alias-label-primary-foreground)`
     （深色主题里就是「白底深字」）。曾经写成 `brand-primary + #fff`，结果深色主题下深字/白字同色 →
     推送是一个白块、提交是一个空灰块。
  2. 真正当"蓝"来用的 token 是 `--dsw-alias-state-business-primary`（deepseek 蓝）与 `--dsw-alias-link`；
     高亮/选中/重命名这类强调一律用它们，别用 `brand-primary`。
- **操作反馈（`output`）永远在 body 最上边，且只占一行**：push 的 sideband banner 动辄三四行，放在最下边会
  掉到变更列表之下（400px 面板里等于没人看得见），直接铺开又会把通知变成一屏 git 提示。所以卡片 =
  「本地化短句（`output.<action>`，store 不持有 `t`，由面板按 `action` 翻译）+ `详情 ▾` 折叠的 git 原始输出」。
  只有 git 真有输出（`message` 非空）时才出现 `output-toggle`；失败时短句是诊断的首 160 字符、全文进详情。
  **新增一个 `store.act("<action>", …)` 就要同时加 zh/en 的 `output.<action>` 文案**，否则界面会显示键名。
  宿主的 `fetch`/`pull`/`push`/`stage` 在 git 无输出时返回空串（不再编 "push complete" 这类英文占位）。
- **按钮组一律等宽分栏**（`S.grow` + `S.rowTight`）：网络工具条三个、提交卡片工具行三个。按钮基准高度 26px、
  圆角 7、`box-sizing: border-box`——加新按钮时沿用 `S.button`/`S.buttonPrimary`，别再手写一堆只差宽度
  的内联样式（那正是"排列杂乱"的来源）。
- **git 的 `message` 文本在 `rpc()` 边界剥 ANSI**（`stripAnsiEscapes`）：远端会给自己的 banner 上色
  （Gitee 甚至先发一个截断的 `ESC[0`），DOM 里没有字形可渲染，只剩 `[0[01;33m` 这种参数当正文显示。
  只剥 `value.message` / `error.message`，**diff body 与路径一律不动**（内容必须逐字节保真）。
- `exports.__internals` 是**给 `test/render.mjs` 的测试出口**（解析器、行渲染、`GitDiffPane`、`DIFF_ROW`、
  `stripAnsiEscapes`、`outputView`、`sectionView`、`changeTagStyle`、`panelBoxStyle`、`DIFF_PANEL_HEIGHT`、
  `sessionModelRoute`）。SSR 不跑 effect，所以面板自己的读取无法用静态渲染驱动，只能这样测；运行时不要用它。
- **AI 起草的请求必须带会话身份**：面板把 `state.sessionId` 交给 `generateMessage` 端点，宿主放进
  `GenerateOptions.sessionId`——部分网关（opencode 系）要求会话亲和头，而宿主只在请求带 `sessionId` 时
  才转给适配器。模型路由由 `sessionModelRoute()` 从**两个投影面**取（行上的 `projectionValues` 与
  快照的 `projectionsBySession[id].values`），两面都不能少，否则静默回落。
- 面板的"自动刷新"由 `dataVersion` 驱动：它是 `cwd | oid | branch | dirty | 每个文件的 XY 字母与路径`。
  带上 XY 是因为 `git add` 恰好不改文件数量与 dirty 计数——只按数量做签名，暂存后打开的 diff 不会重读。

## 5. 测试怎么写

- **不 spawn git 的五个**是默认门禁：加端点/校验就加到 `test/smoke.mjs`；加纯逻辑就进 `test/generate.mjs`
  或 render 的解析器断言；加 UI 就进 `test/render.mjs`（SSR，能覆盖结构、文案、解析与行渲染）；
  改宿主/座位契约就指望 `test/host-mount.mjs`（信封 schema）与 `test/slot-mount.mjs`（真座位注册）——两者
  没有 profile 时都打印 SKIP 并退 0。
- **必须 spawn git 的**（`test/diff.mjs` / `test/commit.mjs`）单独成文件并加 `npm run test:xxx`，
  不要塞进 `npm test`——沙箱里子进程管道 stdio 会 EPERM（见 §8）。
- `test/render.mjs` 需要一份真实 `react`/`react-dom`，解析顺序：`DSH_GIT_REACT_ROOT` → `$DSH_HOME/profiles/web/node_modules`
  → `$DSH_HOME/profiles/node_modules` → 一个 npx 缓存路径 → 常规 node 解析；全都没有时**打印 SKIP 并退 0**（不要改成失败）。
- UI 脚本用 `playwright-core` + 本机 Chrome（`node_modules` 是 gitignore 的，`npm install --no-save playwright-core`
  即可），靠 `data-dsh-git` 钩子定位。`test/ui/verify-diff.mjs` 默认拦截 `/dsh-git-rpc/diff` 用 fixture 验证客户端，
  `DSH_GIT_UI_LIVE=1` 才打真端点；`DSH_GIT_UI_WORKSPACE` 选工作区，`DSH_GIT_UI_URL`/`DSH_GIT_UI_STORAGE_STATE` 过认证。
- 测 git 行为要**真起 git**：临时仓库、`core.autocrlf=false`、`mkdtemp` + `finally rm`。重命名这类事只有真 git
  能暴露（只给新路径的 pathspec 会退化成整文件新增），别用 mock 假装。
- **门禁是跨平台的，CI 跑 `ubuntu-latest`**：`test/smoke.mjs` 里的 `cwd` 一律用 `join(tmpdir(), …)` 造绝对路径
  ——`cwd` 是用 `path.isAbsolute` 校验的，写成 `C:/valid/abs` 只有 Windows 认，换到 Linux 会得到 `invalid-cwd`
  而断言要的是别的东西。反向那条可以留：`normalizedPath` 里有 `^[A-Za-z]:`，所以 evil list 里的
  `C:/Windows/win.ini` 在两种系统都会被拒。**`test/ui/*.mjs` 仍然只能在 Windows 手动跑**（硬编码了本机
  Chrome 路径），但它们不在门禁内。

## 6. 本地验证清单

1. `npm test`（或至少 `node test/smoke.mjs`）。
2. 改了宿主半 → `npm run test:diff` / `test:commit`；再请用户重启 `dsh web` 后在真实 GUI 里点一遍。
3. 改了浏览器半 → 刷新页面，用 playwright（MCP 浏览器或 `test/ui/*.mjs`）真点一遍：开面板 → 点变更行 → 看
   `[data-dsh-git="diff"]` 是否出现、行数/`+N −M` 是否与 `git diff --numstat` 一致 → 再点收起 → 拖右边缘 → 双击复位。
4. 改了两栏/宽度相关的常量 → 量一遍真实像素（面板宽 = 左栏 + 边框 + diff；拖 120px 就应正好变 120px）。
5. 动了界面 → 顺手更新 `test/ui/*.png` 截图（仓库里就是提交这几个截图的）。

## 7. 发版流程

1. 改 `package.json` 的版本号（当前 0.6.1）。
2. 跑全部门禁：`npm test` + `npm run test:diff` + `npm run test:commit`。
3. 提交：中文一行主题 + 分节正文，沿用既有前缀（`feat:` / `fix:` / `docs:` / `chore:`）。正文按
   「宿主半 / 浏览器半 / 测试 / 界面文案」分节写清改了什么与为什么。
4. `git push origin master`。
5. 附注标签：`git tag -a vX.Y.Z -m "vX.Y.Z — 一句话中文"`；`git push origin vX.Y.Z`。
   **推 tag 就等于发布**：`.github/workflows/publish.yml` 先校验 tag 与 `package.json` 一致，再跑
   `npm test`（`prepublishOnly` 会再跑一次，两处都是这道门禁），最后 `npm publish --provenance` 发到 npm。
   `--access public` 只由 `package.json` 的 `publishConfig` 决定，别再在 workflow 里写第二处。
6. GitHub Release：`gh release create vX.Y.Z --title "<中文一句话，不带版本号>" --notes-file <文件>`。
   正文按既有 release 的体例：怎么用 → 各半改了什么 → 设计取舍 → 顺手修掉的问题 → **验证**（带真实数字的表格）
   → 安装/升级。可以引用仓库里的截图（`https://github.com/xia-sc/dsh-git/blob/master/test/ui/xxx.png?raw=true`）。
7. npm 与 GitHub 两个渠道同源，版本号必须一致——所以 tag 名（去掉 `v`）要和 `package.json` 相同，
   这也是 workflow 第一步校验的东西。

### CI 排错

- **workflow 文件不合法时运行根本不会启动**：Actions 页面只写 `Invalid workflow file: <file>#L1`，
  真实行列在那条注解里（点开看的到），**别去猜认证**。踩过的坑：GitHub Actions 表达式**只认单引号**
  （`startsWith(github.ref, 'refs/tags/')`；写成双引号会让整个文件判定非法），而报错行号指向 L1 只会误导。
- **发布之后别立刻用 `npm view` 判"到底发没发"**：registry/CDN 的 packument 缓存会滞后几分钟。
  0.5.2 就被这个坑骗过一轮——第一次 tag 运行其实**已经发布成功**，我 `npm view` 读到的是旧缓存（0.5.1），
  于是误判成"被幂等跳过"、白改了一次判断逻辑，第二次运行反倒真的重复发布并撞 403。
  **权威判据是 registry 里的 `gitHead`**（指向发布那次 checkout 的提交），不是`npm view` 的即时输出。
- 因此 workflow 里那条预检只用来省一次上传，**真正的幂等**是「`npm publish` 报
  *cannot publish over the previously published versions* 就当作成功」——重指 tag、手动重跑、
  预检被缓存骗到时都不会变红。
- 公开仓库的运行页 HTML 里能翻到注解与状态（`octicon-check-circle` / `octicon-x-circle`）；
  自己加的 `::notice::` 也会显示在注解区，比 `echo` 有用（**步骤日志需要登录才能看**）。
  `api.github.com` 在本机被 Egress 挡住（502）时，这是唯一能读 CI 结果的入口。

### npm 认证（一次性配置，配置过就不用再管）

- **首包只能在本机交互式发布**：trusted publisher 要求包已经存在（对不存在的包 `npm trust` 会
  回 `E404 Package not found`；`--dry-run` 只在本地校验、不打服务端，别被它骗过），而
  `npm publish` 是 2FA 操作，非交互式 shell 里会 `EOTP`。所以在自己的终端跑一次：

  ```sh
  npm publish          # 在仓库根目录；prepublishOnly 会先跑门禁，2FA 走浏览器/OTP
  ```

- 包存在之后再登记 **trusted publishing**（之后的 tag 全交给 CI，用 OIDC 换一次性凭据，
  带 provenance，既不需要本机发布也不需要长期密钥）：

  ```sh
  npm trust github @xia-sc/dsh-git --file publish.yml --repo xia-sc/dsh-git --allow-publish
  ```

  `npm trust` 需要 npm ≥ 11.5.1，`--allow-publish` 少了就不许发布；同样是 2FA 操作。
- 备用：仓库 Settings → Secrets 里配 `NPM_TOKEN`（有发布权限的 **granular** token；classic token
  已被 npm 吊销）。workflow 里有这个 secret 就用它，没有就落到 OIDC；但 npm 正在收紧"绕过 2FA
  的 token 直接发布"，长期解只有 OIDC。
- workflow 是**幂等**的：`package.json` 里那个版本已经在 registry 上就跳过发布——所以本机先发过
  0.5.1 之后再推 `v0.5.1` tag，那次运行是绿的（只跑门禁，不重复发）。
- 私有仓库发不出 provenance：那种情况把 workflow 里的 `--provenance` 去掉。

## 8. 这个环境（Windows / DSH 会话沙箱）的坑

- **子进程管道 stdio 会被拦**：Node 里 `execFile`/`spawn` 默认 `stdio: "pipe"` 在受限沙箱里报 `spawn EPERM`，
  于是两个端到端测试跑不了。**用 pwsh 直接调 git 是可以的**（管道由 PowerShell 建立），所以临时验证可以
  `git -C <repo> diff --numstat` 之类先手工对一遍数；真要跑端到端测试就请用户放开沙箱或在普通终端跑。
- git 的 `core.autocrlf` 会刷 `LF will be replaced by CRLF` 警告，属正常；提交进仓库的仍是 LF。
- 本机开发装法：`C:\Users\<user>\.dsh\profiles\web\package.json` 里以 `link:E:/dsh/plugin/dsh-git` 引用本目录，
  所以改了文件就是改了"已安装的插件"，不需要重新 `dsh plugin add`。
- **改包名要连 profile 一起改**：`cordis.patch.yml` 里的行名就是包名，Loader 从 profile 解析这个
  specifier。从 `@dsh-plugins/dsh-git` 改成 `@xia-sc/dsh-git` 之后，profile 里那条 `link:` 的键和
  `dsh.profile.bundles` 里的名字都得换成新名，否则下次 `dsh web` 启动解析不到模块，插件（含胶囊/面板）会消失。
  正规做法是 `dsh plugin --profile web remove <旧名>` 再 `dsh plugin --profile web add E:/dsh/plugin/dsh-git`
  （会一并更新 lockfile）；也可以只手改三处：`profiles/web/package.json` 的依赖键与 bundles 名、
  `profiles/web/node_modules/@xia-sc/dsh-git` 指向本目录的链接。改完**必须重启 `dsh web`**——
  运行中的进程用的是启动时组合的旧行名，重启前浏览器会加载到"自注册 id 与 boot 表条目 id 不一致"的 bundle，
  客户端半边静默不挂载（宿主半还在，端点照常 200，容易误判）。
- 真实 GUI 在 `http://127.0.0.1:3080`。新起的无头浏览器**默认过不了认证**（`dsh web` 会用一次性 token 换
  cookie，cookie 名里带 token）：要么用已登录的浏览器（如 MCP 的 playwright 实例），要么把 `dsh web`
  打印的那个带 token 的 URL 传进来。
- 会话里的验证可以借 MCP 的 playwright / chrome-devtools：`browser_run_code_unsafe` 能拿到 `page`；
  注意那个 VM 里**没有 Node 全局对象**（`require`/`process`/`fs` 都没有），fixture 要内联在脚本里。

## 9. 已知边界与不做的事

- **不依赖宿主右侧 Sidebar 的标签页 API**（`sidebarRight` / `sidebarRightTabs`）：那一面还在快速迭代，
  diff 的请求与渲染都在插件内自成一体。想改成右栏标签页之前先确认这个前提是否还成立。
- 不做语法高亮（会引入第三方依赖，违反 §3.1）；不做逐文件暂存/丢弃；不做"点最近提交看某个 commit 的 diff"。
- 规模上限：单侧 diff 40 万字符（行边界截断）、单次渲染 1500 行（可展开）、未跟踪目录展开 50 个文件（其余计数提示）。
- 面板状态是内存态：刷新后回到"未选文件"的单栏形态，这是有意的。

## 10. English summary

`@xia-sc/dsh-git` is a two-faced dsh plugin (Cordis host half in `lib/index.js`, hand-written browser
half in `lib/client.js`, no build step, `react` is the only module the factory may require). The host owns
the `/dsh-git-rpc` route and must keep the `connection.requestRejection` fence; it never imports
`@deepseek-ai/*` runtime packages and never writes the index, the working tree, or git config outside the
explicit `stage`/`commit`/`checkout` endpoints. Client edits apply on page refresh, host edits need a
`dsh web` restart. Tests are the only gate: `npm test` runs the five git-free suites (smoke, host-mount,
slot-mount, generate, render); `npm run test:diff`
and `npm run test:commit` are real-git end-to-end tests that need to spawn git (blocked in a confined
sandbox) and are therefore kept out of `npm test`. The one CI workflow (`.github/workflows/publish.yml`)
does nothing but publish: a `vX.Y.Z` tag runs the gate and `npm publish --provenance` (OIDC trusted
publishing, or an `NPM_TOKEN` secret). Releases are a `package.json` bump, a `feat:`/`fix:` commit, an
annotated `vX.Y.Z` tag (which is what publishes to npm) and a `gh release create` with detailed Chinese
notes. UI behaviour is asserted through `data-dsh-git` hooks, so renaming one means updating the tests.
