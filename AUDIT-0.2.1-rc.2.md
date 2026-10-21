# 兼容性审计：`@xia-sc/dsh-git` 0.7.1 × dsh desktop 0.2.1-rc.2

审计日期：2026-10-21 · 被审代码：`dsh-git` @ 0.7.1（工作区 `master` @ `1c646a8`，bundle 内容与 v0.7.0 / v0.7.1 逐字节相同）。

上一轮同类审计见 `AUDIT-0.2.0-rc.2.md`（0.7.0 × 宿主 0.2.0-rc.2）；两轮的宿主发现、认证、asar 取证手法一脉相承。
本文件是**一次性审计报告**，不是维护文档；"再改回去就会静默坏"的判据已按体例并入 `COMPAT.md` §7。

## 结论

**插件在 0.2.1-rc.2 上功能完好，运行时零回归，`lib/` 不需要任何改动。** 宿主半的自持路由与围栏、浏览器半的两个座位与完整 diff 交互、AI 起草的每个宿主契约，全部在真宿主 / 真浏览器上复核通过。

**需要动手的只有一处，而且不是插件本身：测试基建。** 0.2.1 改了客户端发行形态——把 `dsh-client-ui-slots`（连同 primitives / dockkit / client-store）内联进 `dsh-web-frontend/dist` 的 shell bundle，安装树里不再有这个包；而 `test/slot-mount.mjs` 需要从安装树加载真 `SlotCore`，于是 `npm test` 在 0.2.1 上**第一次跑就红了**。修复已落在本轮：新增 `test/host-slots.mjs`，按安装的 renderer 版本从 npm 取**同版本真包**（安装树优先 → `DSH_GIT_SLOTS_ROOT` → 按版本缓存 → registry），`slot-mount` 恢复全绿，**没有引入任何假 slots 实现**。

| # | 面 | 结论 | 关键证据 |
| --- | --- | --- | --- |
| 1 | 宿主半挂载与围栏 | **通过** | 真 0.2.1 上 `test/host-mount.mjs` 通过；活体 `status`/`log`/`branches`/`diff` 全 200；无 cookie 401、GET 405、未知端点 `unknown-endpoint`、坏 cwd `invalid-cwd` |
| 2 | 浏览器半（真 GUI） | **通过** | 胶囊 `⎇ master` 绑定会话 cwd；面板单栏 400×506 / 两栏 862×619.9（=300+2+560）；diff 解析计数与头部 `+N −M` 一致；**0** slot-error / pageerror / console.error |
| 3 | 分发链 | **通过，逐字节可复现** | boot 图 78 entries，插件 `rev=4c38468d8496` 复算一致；送达 127520 B = 装机 127448 B + 72 B sourcemap 尾，sha256 完全匹配 |
| 4 | LLM 契约 | **通过（静态逐字段）** | `GenerateOptions`/`RequestUserInput`/`StreamChunk`/`FinishReasonMap` 无破坏性变化；`sessionId` 仍被 pi-ai 转发；`generateMessage` 的流消费代码与新 `StreamChunk`（含 `index`）逐字段对齐 |
| 5 | 主题与几何 | **通过** | 插件用到的 17 个主题 token 在 0.2.1 全部解析；composer 5 个变量全在；`bottom:168` 精确到像素 |
| 6 | 测试门禁 | **已修复** | `npm test` 修复前 exit 1（slot-mount），修复后 **exit 0 五套全绿**；三条既有反证配方仍然有效 |
| 7 | 环境/文档事实 | **有漂移** | GUI 端口 **19387 → 1680**（desktop 以 `--port 0` 启动）；0.2.1 首启预览弹层已不可见；`requiredStartupEntryIds` 新增 `web-runtime` |

---

## 一、环境（先钉死"审的到底是哪份代码"）

| 项 | 事实 | 取证 |
| --- | --- | --- |
| 宿主版本 | **0.2.1-rc.2**：提取出的 304 个 `@deepseek-ai/*` 包中 296 个版本号是 `0.2.1-rc.2`，其余是第三方依赖（cordis 4.0.5、cosmokit、schemastery、zod、@tanstack 等） | `resources/runtime/primary-runtime/runtime.json` 的 `desktopVersion`；asar 内每个 `package.json` |
| 宿主进程 / 发行形态 | `DeepSeek Harness.exe`；Electron `app.asar`（182,794,869 B），全部宿主包在 `app.asar\dsh\node_modules\@deepseek-ai` 内 | 进程列表；asar header（自写读取器，`headerSize=readUInt32LE(4)`，dataOffset=8+headerSize） |
| 活着的 profile | **`desktop`**（`DSH_PROFILE=desktop`）；插件以 **npm 安装副本** 安装：`@xia-sc/dsh-git: ^0.7.0` | `%DSH_HOME%\profiles\desktop\package.json` |
| 真 GUI | **`http://127.0.0.1:1680/`**（`DSH_WEB_URL`）；3080 / 19387 均无监听 | `netstat -ano \| findstr :1680`；`GET /` 401（未认证）/ 200（认证后） |
| 装机副本 vs 仓库 | **同一份运行时**：`lib/client.js`（127448 B）、`lib/index.js`（61594 B）、`cordis.patch.yml`（751 B）三文件 **LF 归一后 sha256 完全相同**；工作区原始字节差全部来自 CRLF（130680 / 62982 / 766） | `git cat-file -s` + node 归一哈希；`git diff --quiet v0.7.0..HEAD -- lib/*.js` = 0 |
| 版本号差异 | 装机 `package.json` 是 **0.7.0**，仓库是 0.7.1；但 `git diff v0.7.0..HEAD` 里 **没有 `lib/`**——0.7.1 只改文档、测试与版本号 | `git diff --stat v0.7.0..HEAD` |
| 认证方式 | 桌面版**没有打印出来的 token URL**（launch token 由 Electron 主进程经 IPC 交给内嵌窗口）；本轮用凭证库 `client-connection/browser-session.skey` 的签名密钥**自签会话 cookie**（密钥不落盘、不打印） | `dsh-client-connection/lib/index.js:272-390`（cookie 名 = `dsh-auth-`+sha256(authority)，值 = `v1.<body>.<HMAC>`） |
| Node | `v26.9.0`（跑测试用）；desktop runtime 自带 node 24.21.0 | `node --version`、`versions.json` |
| 审计时间 / 视口 | 2026-10-21 10:10–10:40（Asia/Shanghai）；真浏览器视口 929×861、浅色主题、当前会话为 hero 空会话 | 页面 `innerWidth/innerHeight`、`data-phase=hero` |

---

## 二、逐面实测

### 2.1 门禁

| 套件 | 修复前 | 修复后 | 说明 |
| --- | --- | --- | --- |
| `test/smoke.mjs` | 通过 | 通过 | 路由/信封/端点分发/入参校验 + 客户端 bundle 结构 |
| `test/host-mount.mjs` | 通过 | 通过 | `mounted against @deepseek-ai/dsh-client-connection@0.2.1-rc.2`，手写信封全部通过宿主自己的 zod schema |
| `test/slot-mount.mjs` | **失败（exit 1）** | **通过（exit 0）** | 修复前：`cannot resolve "@deepseek-ai/dsh-client-ui-slots"`；修复后 23 项 ok，`real SlotRegistry 0.2.1-rc.2` |
| `test/generate.mjs` | 通过 | 通过 | 路由、prompt、截断、流式拼装、失败码 |
| `test/render.mjs` | 通过 | 通过 | 两个座位、提交区控件、diff 解析器、`act()` 回传 |
| `npm run test:diff` / `test:commit` | — | **exit 1（环境限制）** | `spawn EPERM`：本会话沙箱禁止子进程管道 stdio（`AGENTS.md` §8 已记录），与本次改动无关，发布前需在普通终端补跑 |
| `npm run test:ui:settings` | — | **exit 1（环境限制）** | `browserType.launch: spawn EPERM`（沙箱禁止拉起 Chrome）；同上 |

### 2.2 宿主半（`lib/index.js`）

契约逐项（对照 `COMPAT.md` §2/§4/§5/§6）：

| 契约 | 0.2.1-rc.2 结论 | 证据 |
| --- | --- | --- |
| `webServer.register(route)` 形状 | **未变**：仍是 `{kind, path, handler}`，**无 `method`**；`kind ∈ exact/prefix`，前缀匹配 `pathname === prefix \|\| startsWith(prefix + "/")`，最长前缀优先；重复 `(kind,path)` 抛错 | `dsh-host-webserver/lib/index.js:321-332, 494-501`；插件自判 `req.method !== "POST"` |
| `connection.requestRejection(req)` | **仍是数字三态**：内部 `admit()` 返回 `{rejection: 401\|403}` / `{peer}`，公开方法 `requestRejection` 把它**投影回数字**（`"rejection" in admission ? admission.rejection : undefined`） | `dsh-client-connection/lib/index.js:737-749` |
| 活体围栏 | 通过：无 cookie **401**、错误 Origin **403**、`GET /dsh-git-rpc/status` **405**（落在插件自己的 method 判定） | 真端点探针（见 §2.7） |
| 自持路由仍必需 | **是**：connection 插件自己的 `inject = ["credentials"]`，`rpc.handle()` 的 `register(owner, …)` 在 `owner.effect(() => owner.webServer.register(…))` 里用**它自己的** ctx；外部插件调用时 `owner.webServer` 仍不可见 ⇒ `cannot get property "webServer" without inject`。`COMPAT.md` §2 的设计不要改回去 | `dsh-client-connection/lib/index.js:727, 855-871, 1013` |
| Connection 信封 schema | **通过**：`test/host-mount.mjs` 在 0.2.1 上把 `client-request` / `failure` / `unknown-endpoint` / 通道外 404 全部过宿主 zod schema；失败信封仍要求 `code:"internal"` + record 型 `details` | `test/host-mount.mjs` 输出 |
| `requiredStartupEntryIds` | **新增一项 `web-runtime`**：现在是 `{agent-loop, webserver, web-runtime, modules, connection, headless-runner, acp, sdk-jsonrpc-server}`；**`llm` 仍不在其中**，非必需行失败仍只 `warn(...)` → stderr（`auditStartupEntries`） | `dsh-app-boot/lib/index.js:4270-4279, 4464-4475` |
| 客户端入口入选条件 | **未变**：`entry.options.name !== entryName \|\| entry.fiber === void 0 \|\| entry.disabled` 才跳过 ⇒ PENDING 的行照样进 boot 图、照样发 `/plugins` 路由 | `dsh-client-modules/lib/index.js:855` |
| `artifactRevision()` | **未变**：`framedHash("plugin-artifact", [mtimeMs, ctimeMs, size])`，sha1 前 12 hex | `dsh-client-modules/lib/index.js:188-200` |
| web 启动审计 | **仍在**：非 active fiber 会被逐条收集并 `throw new Error("web boot: N entries did not activate …")`（缺服务是响的故障） | `dsh-web-frontend/dist/assets/index-CN7NIWNw.js`（`web boot: ${…} entries did not activate`） |
| 会话快照形状 | **未变**：`SessionListState = {ids, byId, phase, projectionsBySession}`；`byId[].cwd` 仍是条件展开的可选字段（宿主仍填）；`retainedBy` 计数、`projectionValues`、`projectionsBySession[id].values` 都在 | `dsh-api-session-controller/lib/types/client/sessions/service.js:73-77, 166, 420-450, 511` |
| `dsh.client.inject` 的 6 个包名 | **都在**，且全部 `platform=web`、`exports["./client"]` 可解析、`immediately` 标记按包不同 | 6 个 `package.json` 逐一核对 |
| cordis 版本 | asar 内 **4.0.5**（profile 里那条 `@deepseek-ai/cordis` = 4.0.4），插件依赖 `^4.0.1` ⇒ **满足** | 两个 `package.json` |

### 2.3 浏览器半（`lib/client.js`，真 GUI 实测）

**座位与组件**

| 检查 | 实测 |
| --- | --- |
| `[data-dsh-git="dock"]`（`conversation.input.dock`） | 存在；干净 `⎇ master`、脏 `⎇ master ●1`；`title="E:\dsh\plugin\dsh-git"`（= 会话 cwd，绑定正确） |
| `[data-dsh-git="panel"]`（`shell.overlay`） | 单栏 **400×506**、两栏 **862×619.9**（= `panel-left 300` + `border 2` + `diff 560`）；`position:fixed; bottom:168px; z-index:30` |
| 错误面 | `[data-slot-error]`=0、`window.onerror`=0、`unhandledrejection`=0、`console.error`=0；加载期唯一 warning 来自别的插件（dsh-whale canvas） |
| 冷启动 | dock 在 **410.7 ms** 后出现；刷新后 `panelOpen=false`（符合"面板状态是内存态"的设计） |

**diff 交互全流程**（用未跟踪的临时文件制造变更；验证后已删）

| 步骤 | 实测 |
| --- | --- |
| 点变更行 → diff 出现 | 469.3 ms；未跟踪目录折叠成一行 `.audit/ 未跟踪` |
| diff 解析 | 19 行 → fileHeader 10 / hunk 2 / add 6 / meta 1，头部 `+6 −0` 与实际行数一致；加一个 326 字符单行文件后 28 行 `+7 −0`（noNewline 1） |
| 两侧切换 | 空侧（`diff-scope-index`）按设计渲染为 **disabled**（`title="这一侧没有改动"`、`opacity:.45`），`diff-empty` 只在"空侧被选中"时渲染、本次不可达——**这是 `lib/client.js:2021-2039` 明确的设计**，不是回归 |
| 宽度拖拽 | 视口 929 宽时默认 862 已被 `clampDiffWidth` 钳到上限 581.5（+120 只增 21.5）；缩小后 **拖 +120 → 面板与 diff 各精确 +120.00**；双击手柄复位、双击标题行取消锚定并居中 |
| 自动换行 | `scrollWidth 2249 → 555`，长行文本 span `white-space: pre → pre-wrap`；关回后复位 |
| 收起 diff | 回单栏 400×506，`panel-left`/`diff`/`panel-resize` 全部移除，无报错 |

**主题与几何**

- 插件消费的 **17 个** token（16 个 `--dsw-alias-*` + `--dsw-shadow-lv2`）在 0.2.1 真页面**全部解析为具体值**（`emptyTokens = []`）。
- composer 5 个变量全在：`--dsh-composer-card-max-width`（本视口解析 712px，插件 `dock-row` 实测 712px ⇒ 被正确消费）、`-dock-inset`、`-side-clearance`、`-text-max-height`、`-stack-gap`。
- `bottom:168` **精确**：面板底边 y=693 = 861−168；两栏高度 619.9 = `min(72vh=619.92, 100vh−184=677)`，`style.height === style.maxHeight`。
- 层叠：`shell.overlay` 容器 z20（`pointer-events:none`）、宿主 frame **无 transform** ⇒ 插件 `position:fixed` 仍以视口为基准；面板自身 z30，在 overlay 内最高。
- **已知边界仍在**：hero 空会话下 composer 栈 `[313.5, 587.5]`、面板 `[187, 693]` ⇒ 面板盖住 hero 输入框（本视口重叠 274px）；常规会话的"0px 重叠"结论沿用 0.2.0 实测（本轮无法在不打扰用户会话的前提下制造常规会话）。

### 2.4 分发链

```
boot.rev = 998d7d50cf4e   release = {"version":"0.2.1-rc.2","commit":"332895e"}   entries = 78
entry  = {"id":"@xia-sc/dsh-git",
          "url":"plugins/??@xia-sc/dsh-git/client.js&rev=4c38468d8496",
          "rev":"4c38468d8496", "inject":[6 个包名]}
```

- **rev 复算**：按 `artifactRevision()` 用**装机副本**的 `mtimeMs=1791511820609.478 / ctimeMs=1791511820617.3904 / size=127448` 复算 = **`4c38468d8496`**，与 boot 图一致。
- **送达字节**：页面内 `fetch(...)` → **127520 B**，= 装机 127448 B + **72 B**（`;\n` + sourcemap 行 + `\n`），sha256 `5601ab7a…` 与"装机文件 + 尾注"重放的结果逐字节相同。
- **三副本关系**：装机 / `HEAD:lib/client.js` / `v0.7.0:lib/client.js` 的 sha256 全部 `b8f43f90…`（127448 B）；工作区副本 130680 B 仅因 CRLF。⇒ 核对 rev 与字节必须用**装机路径**那份。

### 2.5 LLM 契约（逐字段）

| 契约 | 0.2.1-rc.2 结论 | 证据 |
| --- | --- | --- |
| `GenerateOptions` 字段 | **兼容**（`provider/model/messages/system/maxTokens/signal/sessionId` 全在；0.2.1 另有可选的 `reasoningEffort/tools/toolHistory/temperature/stop/purpose`，插件不发即走默认） | `dsh-tool-cordis/lib/types/api-catalog.js:5499`；插件 `lib/index.js:1126-1137` |
| 一次性消息 `RequestUserInput` | **约束仍在**：`{ role:'user', content, id?: never, source?: never }` | `dsh-llm/lib/typert.host.js:528-532` |
| `StreamChunk` | **兼容**：`text-delta{index,text}` / `block-end{index,block}` / `finish{reason}` 都在（另有 `block-start`/`reasoning-delta`/`tool-call-delta`/`usage`，插件忽略）；插件的拼装代码逐字段对齐（`deltas.set(chunk.index, …)` / `blocks.set(chunk.index, chunk.block.text)` / `chunk.reason`） | `dsh-llm/lib/typert.host.js:571-572`；`lib/index.js:1141-1150` |
| `FinishReasonMap` | **兼容**：`stop/tool-calls/max-tokens/aborted/error`，后两者带 `failure`（插件按 `finish.kind === "error"\|"aborted"` 分类） | `dsh-llm/lib/typert.host.js:352-356` |
| 服务方法 | `stream(options)`、`listProviders()`（同步）、`listModels(provider)` 都在 | `api-catalog.js:1370, 1431, 1455` |
| `sessionId` 转发 | **仍在**：`...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) }` | `dsh-llm-pi-ai/lib/index.js:1987` |
| checkpoint flush | **行为未变**：带 `sessionId` 的 LLM 调用前先 flush 该会话 | `dsh-session-checkpoint-policy/lib/index.js:62-73` |

> 本轮**没有**重复打真网关（上一轮 0.2.0 已实测 200/1.96s；本轮 `GenerateOptions`/`StreamChunk` 无破坏性变化，且 `test/generate.mjs` 的单测全绿）。若发布前想要活体证据，按上轮 §2.4 的命令补一次即可（会消耗一次模型额度）。

### 2.6 0.2.1 的发行形态变化：slots 被内联进 shell bundle（**本轮核心发现**）

- asar 全树（18,309 条路径）里**没有** `dsh-client-ui-slots`（也没有 primitives / dockkit / client-store）；提取出的 304 个 `@deepseek-ai` 包里同样没有。
- `dsh-client-ui-renderer/package.json` 把它从 dependencies 挪到 **devDependencies**，但 `renderer/lib/client.js:14` **仍 `require("@deepseek-ai/dsh-client-ui-slots")`**。
- 浏览器里由 shell bundle 的共享模块表供给：`dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 尾部

  ```js
  function SZ(){return {react:sC, "react/jsx-runtime":uC, "react-dom":mC, "react-dom/client":yC,
    "@deepseek-ai/cordis":Fb, zod:Zj, "@tanstack/react-virtual":Yj,
    "@deepseek-ai/dsh-client-store":wI,
    "@deepseek-ai/dsh-client-ui-slots":SI,          // ← 内联实现
    "@deepseek-ai/dsh-client-ui-primitives":zU,
    "@deepseek-ai/dsh-client-ui-dockkit":xZ }}
  ```

  并由 shell 启动时交给模块系统（`this.modules = r.create({boot: t.__DSH_BOOT__, staticModules: SZ(), …})`）。
- **对插件无影响**：`lib/client.js` 只 `require("react")`，槽位能力走 `ctx.slots` 服务（由 renderer 提供），不直接 require 任何客户端包；真 GUI 两个座位已实测正常。
- **对测试有影响**：`test/slot-mount.mjs` 在 node 里驱动真 `SlotRegistry`，需要真 `SlotCore`——安装树没有、页面又不在了。修复见 §三.1。

### 2.7 活体端点（自签 cookie，真 0.2.1 宿主）

| 请求 | 状态 | 响应 |
| --- | --- | --- |
| `POST /dsh-git-rpc/status` | 200 | `{repo:true, branch:"master", oid, upstream:"origin/master", dirty:3, changes:[…]}` |
| `POST /dsh-git-rpc/log` | 200 | 最近提交（含 `HEAD -> master, tag: v0.7.1, origin/master`） |
| `POST /dsh-git-rpc/branches` | 200 | `current:"master"`、local/remote 列表 |
| `POST /dsh-git-rpc/diff` | 200 | 未跟踪文件 `untracked:true`、`+3` 行、`index` 侧空 |
| 无 cookie | **401** | — |
| `GET /dsh-git-rpc/status` | **405** | 空体 |
| 未知端点（body.method 与 path 一致） | 200 | `error.code:"internal"` + `details.code:"unknown-endpoint"` |
| 相对 `cwd` | 200 | `error.code:"internal"` + `details.code:"invalid-cwd"` |
| `POST /`（任意未知路径） | 405 | frontend-static 的非 GET/HEAD 兜底 |

---

## 三、本轮发现的漂移（都不是插件的运行时回归）

### 3.1 【已修·高】`slot-mount` 在 0.2.1 上解析不到 slots，门禁第一次跑就红

- **症状**：`npm test` 在 `test/slot-mount.mjs` 抛 `Error: cannot resolve "@deepseek-ai/dsh-client-ui-slots"`，exit 1。
- **根因**：§2.6 的发行形态变化。`test/slot-mount.mjs` 的 `locate()` 只会在安装树里找包，0.2.1 不再发布它。
- **修法（已落）**：新增 `test/host-slots.mjs`，按**安装的 renderer 版本**获取同版本真包，顺序为
  ① 安装树（≤0.2.0，离线）→ ② `DSH_GIT_SLOTS_ROOT`（权威覆盖，离线逃生）→ ③ `%TEMP%/dsh-git-slots/<version>` 缓存 → ④ npm registry（元数据 + tarball + `dist.integrity` SRI 校验 + 只解包 `package.json` 与 `lib/**`）。
  `test/slot-mount.mjs` 把 slots 从"可选探针"改为硬依赖获取，`seed` 表只登记 bare specifier（与 shell 表一致）。
  **没有引入任何假 slots 实现**——renderer 拿到的仍是真 `SlotCore`；"有宿主却解析不到不得静默 SKIP" 的总原则不变（失败打印三条可操作修法并 exit 1）。
- **验证**：`npm test` exit 0 五套全绿；`SLOT MOUNT TEST PASSED (real SlotRegistry 0.2.1-rc.2: …)`。
  反证配方：`DSH_GIT_SLOT_FIXTURE=embedded` → exit 1（9 项失败）；`DSH_GIT_DSH_ROOT=<空>` → SKIP+0；空 `DSH_GIT_SLOTS_ROOT` / 断网 registry / 非 asar → exit 1。
- **代价（需知情）**：宿主换版后**首次**跑门禁要联网一次（约 1–2 s，31,964 B，SRI 校验），之后走缓存；完全离线用 `DSH_GIT_SLOTS_ROOT` 指到解包目录。CI（无宿主）仍 SKIP，不会触发下载。

### 3.2 【中】环境事实：GUI 端口 19387 → 1680

desktop 版现在以 `--port 0` 启动（每进程临时端口），本轮实测 **1680**；`DSH_WEB_URL` 已指向它，3080 / 19387 均无监听。
`COMPAT.md` §0/§6.1、`AGENTS.md` §8、`test/ui/*.mjs` 的默认 3080 都需要按"从 `DSH_WEB_URL` 取"或显式传参来适配（见 §五）。

### 3.3 【低】0.2.1 的 shell 变化

- **首启「预览版说明」弹层已不可见**：`[role="dialog"]`/`[aria-modal]`/「继续」按钮全为 0；改为 hero 标题组里的常驻「预览版」徽标。`test/ui/verify-diff.mjs` 的"关弹层"探测会**静默跳过**（不报错），逻辑无需改，但意图已空转。
- **工作区选择器未变**：`button[aria-label="选择工作区"]` 仍在（hero 行 `dsh-git`）。
- **`requiredStartupEntryIds` 新增 `web-runtime`**：`llm` 仍不是必需启动项，故 `COMPAT.md` §4.5/§5.1 的"llm 起不来只 stderr + 界面不消失（路由 405 / 胶囊 notRepo）"判据继续成立。

### 3.4 【低·测试基建】`test/ui/verify-diff.mjs` 的桌面版适配点

静态审查结论（未跑浏览器）：
- 默认 `http://127.0.0.1:3080/` **必失效**；且桌面版**没有带 token 的 URL**，认证要走 `DSH_GIT_UI_STORAGE_STATE` 或自签 cookie（cookie 名/payload 绑定 `host:port`，换端口即失效）。
- 0.2.1 首启弹层不弹 → 脚本里的关闭步骤空转（无害）。
- 工作区选择器 `aria-label="选择工作区"` 仍在；建议把固定 3 s 等待改成显式 `waitForSelector`。

### 3.5 【低·既有，非 0.2.1 回归】三个已知边界仍然存在

1. **hero 空会话**下 `bottom:168` 会盖住输入框（本轮 929×861 重叠 274px），常规会话重叠 0px；
2. **宽度钳制上限未取整**：`clampDiffWidth` 的 `available` 不 `round`，可出现 `581.5` 半像素；
3. **未跟踪目录混入二进制文件**时宿主 `isBinaryDiff` 整侧判 `binary:true`，同目录文本 diff 被整体隐藏（`lib/index.js:860-862`，0.7.x 既有）。

---

## 四、必须修改的代码

| 范围 | 结论 |
| --- | --- |
| `lib/index.js`（宿主半） | **零改动**：路由/围栏/信封/LLM 契约全部兼容 |
| `lib/client.js`（浏览器半） | **零改动**：座位、diff、主题、几何全部正常 |
| `test/slot-mount.mjs` + `test/host-slots.mjs`（测试基建） | **已改**（§3.1）：0.2.1 发行形态变化导致的解析失败 |

## 五、建议的后续动作（按收益排序）

1. **（已做）** 把 §3.1 的 slot-core 获取写进 `COMPAT.md` §7 与 `AGENTS.md`（`test/host-slots.mjs`、两个新环境变量、首次联网说明）。
2. **（已做）** 更新 `COMPAT.md` §0 与 `AGENTS.md` §8 的端口事实（1680 / `DSH_WEB_URL`，desktop `--port 0`）。
3. **（待办）** `test/ui/verify-diff.mjs` 的 URL 默认值改为 `process.env.DSH_WEB_URL ?? "http://127.0.0.1:3080/"`，认证走 storage-state/自签 cookie；首启弹层探测保留但注明 0.2.1 起通常不命中。
4. **（建议，未做）** `clampDiffWidth` 的上限 `Math.floor`，消掉半像素宽度。
5. **（建议，未做）** 宿主半 `isBinaryDiff` 改为按文件返回 `binary`（或在 notice 里列出被隐藏的文件名），避免未跟踪目录混入二进制时整侧不可读。
6. **（发布前）** 在普通终端补跑 `npm run test:diff` / `test:commit` / `test:ui:settings`（本会话沙箱 `spawn EPERM`，不能视为通过）。

## 六、未覆盖 / 未能确认

- **常规会话（有历史消息）形态**下的 composer 几何：本轮会话是 hero 空会话，为避免污染用户会话未切换；沿用 0.2.0 审计的"重叠 0px"结论。
- **AI 起草真网关活体**：本轮只做静态契约核对与 `test/generate.mjs` 单测（上一轮 0.2.0 已实测 200/1.96s，契约无变化）。
- **深色主题**：本轮浅色主题，只证"17 个 token 全部解析"，未逐值比对暗色。
- **两侧真实内容对比**：仓库干净且审计禁止 `git add`，已暂存侧为空且按设计不可选。
- **`test:diff` / `test:commit` / `test:ui:settings`**：沙箱 EPERM，未取得本机通过证据。
- **右栏内嵌会话**里的面板锚点与胶囊宽度：未复测（0.2.0 亦未覆盖）。

---

### 附：本轮用到的复核命令

```powershell
# 门禁（修复后）
npm test                                    # exit 0，五套全绿
$env:DSH_GIT_SLOTS_ROOT='<解包目录>'; node test/slot-mount.mjs   # 离线路径
$env:DSH_GIT_SLOT_FIXTURE='embedded'; node test/slot-mount.mjs   # 反证：应 exit 1

# 活体（自签 session cookie 后；cookie 构造见 COMPAT.md §0 第 2 步）
POST /dsh-git-rpc/status | log | branches | diff              # 200 + 数据
POST /dsh-git-rpc/status（无 cookie）                           # 401
GET  /dsh-git-rpc/status                                       # 405
POST /dsh-git-rpc/nope（body.method="nope"）                    # unknown-endpoint
POST /dsh-git-rpc/status（cwd 相对）                            # invalid-cwd

# 分发链
# __DSH_BOOT__ → @xia-sc/dsh-git 的 rev；按 artifactRevision() 用装机文件 stat 复算 → 4c38468d8496
# fetch /plugins/??@xia-sc/dsh-git/client.js&rev=<rev> → 127520 B = 装机 127448 + 72 B sourcemap

# asar 取证（宿主机上 PowerShell 读不了 asar，要自写读取器或复用 test/host-root.mjs 的提取缓存）
# headerSize=readUInt32LE(4)，jsonLength=readUInt32LE(12)，JSON 从 offset 16 开始，dataOffset=8+headerSize
```
