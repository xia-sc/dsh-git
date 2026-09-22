# 宿主版本兼容性笔记（`@xia-sc/dsh-git`）

给维护者和 agent 的**踩坑档案**：宿主 dsh 升级后本插件"静默失效"的已知原因、确认它的手法、
当时的修法，以及守护它的测试。**每新增一条按同一体例写：症状 → 证据 → 根因 → 修法 → 守护测试。**

这不是通用说明：硬约束看 `AGENTS.md`，功能与端点契约看 `README.md` / `README.en.md`。

## 0. 宿主换版后的排查顺序

按这个顺序走，能最快把"插件坏了"和"宿主换 API 了"分开；每一步的判据都写明了。

1. **默认门禁**：`npm test`。其中 `test/host-mount.mjs` 会在真 Cordis + 真 `dsh-client-connection` 上挂一次
   插件行，并用宿主自己的 zod schema 校验插件手写的信封；`test/slot-mount.mjs` 会用真的
   `dsh-client-ui-slots` / `dsh-client-ui-renderer` 挂一次两个座位（两者找不到 profile 时都 SKIP）。
2. **宿主半是否活着**：拿 `dsh web` 启动时打印的 token 换 cookie，再打一次端点。
   `401 unauthorized` = 路由在、围栏在（正常）；`404` = 路由压根没挂上；`200` + 正常 JSON = 宿主半完好。

   ```powershell
   $null = Invoke-WebRequest -Uri "http://127.0.0.1:3080/?token=<dsh web 打印的 token>" -SessionVariable sess
   Invoke-WebRequest -Uri "http://127.0.0.1:3080/dsh-git-rpc/status" -Method POST -ContentType application/json `
     -Headers @{Origin="http://127.0.0.1:3080"} -WebSession $sess -SkipHttpErrorCheck `
     -Body '{"type":"client-request","rpcId":"probe","method":"status","payload":{"args":{"cwd":"<绝对路径的仓库>"}}}'
   ```

3. **客户端半是否挂上**：client inspect 的 `Slots.listSubTree`，`root: shell.overlay` /
   `conversation.input.dock` 看 `dsh-git` 的条目是否在、是否 `active: true`。
   *这个 inspect 工具在本机会偶发卡死*；卡死就走第 4 步取证，别在那里等。
4. **浏览器真正跑的是哪份代码**：`GET /` 的 HTML 里有 `globalThis["__DSH_BOOT__"]`，列出每个客户端入口的
   `url`（带内容哈希 `rev`，URL 里的 `&` 记得加引号）。按 URL 抓下来的字节就是浏览器执行的东西，
   和本仓库 `lib/client.js` 直接对比即可判定"是不是我这份代码"：

   ```powershell
   $html = (Invoke-WebRequest -Uri "http://127.0.0.1:3080/" -WebSession $sess).Content   # 找 __DSH_BOOT__
   Invoke-WebRequest -Uri "http://127.0.0.1:3080/plugins/??@deepseek-ai/dsh-api-session-controller/client.js&rev=<rev>" `
     -WebSession $sess
   ```

5. **真 GUI 复现**：`$env:DSH_GIT_UI_URL="http://127.0.0.1:3080/?token=<token>"; node test/ui/verify-diff.mjs`。
   它第一句就要求 `[data-dsh-git="dock"]` 存在，所以只要它跑到后面，就说明胶囊回来了。
   （沙箱里 playwright 起 Chrome 会 `spawn EPERM`，见 `AGENTS.md` §8。）

## 1. dsh ≥ 0.1.6-alpha.2：当前会话不再出现在 sessions 列表快照里

### 症状

胶囊和面板**一起静默消失**：输入框上方什么都没有，控制台没有任何报错，宿主端点一切正常，
slot inspect 里 `dsh-git-panel` / `dsh-git-pill` 两个条目**仍然是 `active: true`**。
（数据流还在，只是取不到 cwd，两个组件各自 `return null`。）

### 证据

- `useSessions` 的快照类型是 `SessionListState`；0.1.6-alpha.2 的定义
  （`@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/service.d.ts`）只有
  `ids` / `byId` / `phase` / `subagentsByParent` / `jobsBySession`，**没有 `current`**。
- 浏览器实际收到的 bundle 里同样是 `createSnapshotStore({ids:[],byId:{},phase:"pending",…})`，
  `projectList()` 也只 `set({ids,byId,phase,subagentsByParent,jobsBySession})` —— 按第 0 步第 4 项可直接复核。
- 当前会话被挪到了两处协作：
  - `@deepseek-ai/dsh-client-ui-workspace` 的 `UiWorkspaceService.selection`：一个
    `createSnapshotStore({}, {persist:{name:"dsh.sessions.current"}})`，`replaceMain()` 写
    `{sessionId, subagentAddress?}`；
  - `@deepseek-ai/dsh-client-ui-session` 的 `apply()`：`ctx.slots.provideRoot({hooks:{sessions, sessionStatus},
    keyedHooks:{sessionRetainInfo}})` + `ctx.slots.installScope("session", service.adapter)`；
    `UiSession.publishMain()` 按 `retainedBy.mainView > 0` 推出当前会话，写进 `adapter.current`。
- `SlotScopeAdapter.current` 是有文档的接口（`@deepseek-ai/dsh-client-ui-slots` 的 `renderer.d.ts`）：
  "Default binding inherited by scoped entries"，`StandardSourceBinding.key` 是作用域身份、`props` 里带
  `sessionId`。但它**只沿 `SessionProvider` 向下投递**，根作用域的 `shell.overlay` 拿不到；
  `ctx.sessions`（`ISessions`）上也没有任何"当前会话"API。**根作用域座位无解，这是关键。**
- 旁证：`dsh-cc-studio` 的客户端也读 `s.current`（其 `lib/client.js` 里 `useSessions(s => s.current || null)`，
  且因为 `props.useSessions` 存在而永远走这一支），**同一原因很可能也失效**（本仓库只读了它的源码，没验运行时）。

### 根因

两个界面此前都做 `sessions.current → byId[id].cwd`：面板（`shell.overlay`，根作用域）与胶囊
（`conversation.input.dock`，会话作用域）各查一次。字段没了以后 `cwd === undefined`，
胶囊 `return null`、面板 `return null`。

### 修法（当前实现）

**会话绑定归会话作用域座位所有**：

- 胶囊：框架给会话作用域座位 `sessionId` prop（`ScopeStandardProps` 的 `SessionStandardProps`），
  它再从 `useSessions` 快照取 `byId[sessionId].cwd`，调 `store.bindSession(sessionId, cwd)`。
  这个 `sessionId` 正是渲染器从 `adapter.current` 投下来的同一个身份。
- store：`sessionId` 与 `cwd` 一起成为共享状态（`idleState()` 里带 `sessionId`，`doRefresh` 的 emit 也带上），
  `bindSession` 只在值真变了时才重新拉取。
- 面板：只读 store 的 `sessionId` / `cwd`；`sessionId` 另外用于取该会话的 `modelSelection` 投影定 AI 起草路由。
- **嵌入式会话要排除**：右栏的 chat 标签是另一处 `conversation.input.dock` 宿主，它有自己的会话绑定。
  只有主视图那个座位能改工作台绑定的仓库，判据用快照里的 `byId[id].retainedBy.mainView`（ui-session 自己
  就是用这个信号推当前会话）；**快照不带这个计数时按主视图放行**（旧宿主不能因此连胶囊都没了）。

### 别再改回去

- 不要把"哪一边读会话、哪一边读 store"反转，也不要让根作用域面板自己去找当前会话（找不到）。
- 不要换成 `ctx.uiWorkspace.selection`：那是 TS `private` 字段，且要自己订阅，属于私有实现。
- 胶囊里也别把 `retainedBy.mainView` 判据换成硬编码的"主视图"，那需要引入新的宿主 prop 依赖；
  用快照里已有的字段最省事，也最容易 fail-open。

### 守护它的测试

- `test/render.mjs`：SSR 夹具里未绑定 store → 两个座位都渲染空；`bindSession("s1","C:/repo")` 后胶囊出
  pill（`sessionId` 与 `useSessions().byId.s1.retainedBy.mainView = 1`）；把会话换成
  `retainedBy:{gateway:1}`（嵌入式）→ 既不渲染、也不重绑 store。**改夹具时别忘了 `retainedBy`。**
- `test/ui/verify-diff.mjs`：真 GUI 回归，第一句就是"胶囊必须存在"，跑通即覆盖本次回归。

## 2. dsh ≥ 0.1.5-rc.1：外部插件不能再调 `connection.rpc.handle()`

- **症状**：插件整体**挂载失败**（不是静默）：`cannot get property "webServer" without inject`。
- **根因**：`HostConnectionService.rpc` 闭包持有的是 connection 插件**自己的** Context（`inject` 只有
  `["credentials"]`），注册时执行 `owner.effect(() => owner.webServer.register(route))`，而该插件只在内部的
  `ctx.inject(["webServer"], …)` 作用域里取得到 `webServer`——调用方 inject 什么都没用。
- **修法**：宿主半**自持 `/dsh-git-rpc` 前缀路由**，自己收发与 `/api` 相同的 Connection RPC 信封；
  请求围栏仍交给 connection 服务的 `connection.requestRejection`，安全等级与 `/api` 一致。
  详细论证见 `lib/index.js` 头部注释与 `README.md` 的「为什么自持 HTTP 路由」。
- **守护**：`test/host-mount.mjs`（真 Cordis + 真 Connection 服务）。

## 3. 环境噪声（不是插件的锅，别被带偏）

- profile 的 `@deepseek-ai/*` 可能是**悬空 junction**（指向已被删掉的旧 nvm 版本或已被清理的 npx 缓存）。
  安装树换版本时会出现，但不影响浏览器实际执行的 bundle —— 判定"浏览器跑的是哪份代码"只认第 0 步第 4 项。
- client inspect 工具（`Slots` / `Service`）在本机会偶发**卡死**；用第 0 步第 4 项的 HTTP 取证替代。
- 受限沙箱里 playwright 起 Chrome 会 `spawn EPERM`（`--remote-debugging-pipe` 要命名管道），
  需要放开文件/沙箱策略或换未受限终端，见 `AGENTS.md` §8。

## 4. dsh ≥ 0.1.7-alpha.1

2026-09 全量审计的结论：插件在这一版上**挂得上、跑得通**（宿主半自持路由的 401 围栏、浏览器半两个座位、
diff 面板、信封 schema 全部在真宿主/真浏览器里验过）。本节只记"再改回去就会静默坏"的耦合与判据，
体例同上：症状 → 证据 → 根因 → 修法 → 守护测试。

### 4.1 一次性 LLM 消息必须是没有 `id`/`source` 的 `RequestUserInput`

- **症状（若改回去）**：今天不炸，但它已经不在宿主的声明范围内；一旦请求侧加校验、或这条消息被
  持久化，整条 AI 起草就失败。
- **证据**：0.1.7 的 `dsh-llm/lib/types/message.d.ts` 里 `MessageSourceMap` 只有
  `user|model|tool|system-prompt`，注释明写 *"there is no shared catch-all `plugin` kind"*；
  手工构造的一次性输入被定义为 `RequestUserInput { role, content, id?: never, source?: never }`
  （`dsh-llm/lib/types/types.d.ts`）；Session format v4 更是硬拒 —— `dsh-session-format-v3-to-v4`
  只在 v3 迁移时把 `kind:"plugin"` 改写掉，写入 v4 时直接 `SessionFormatError`。
  0.1.6-alpha.2 的 `packages/llm/llm/src/message.ts` 里 `plugin` 还是合法成员，所以这是宿主删掉的词汇。
- **根因**：老代码按 0.1.6 的形状写 `{id, role, content, source:{kind:"plugin",plugin}}`；0.1.7 只读
  `provider/model/messages/…`，非 assistant 消息的 `source` 根本不会被读（所以当时"看起来没事"）。
- **修法**：`generationMessage()` 返回 `{ role: "user", content: [{ type: "text", text }] }`，
  不留 `id`、不留 `source`。
- **守护**：`test/generate.mjs` 断言消息无 `id`、无 `source`、键集恰为 `content,role`。

### 4.2 会话作用域的 LLM 调用必须带 `sessionId`

- **症状**：点「✨ AI 生成」拿到的是网关错误（本机 opencode 系路由：`400 … MissingSessionID`），
  或者网关以 200 + 空流回应、界面显示「模型没有返回提交信息」。
- **证据**：`dsh-llm-pi-ai` 只在 `options.sessionId !== undefined` 时才把它交给 pi-ai
  （`...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) }`），
  而 pi-ai 用它生成会话亲和头（`anthropic-messages.js` 的 `x-session-affinity` 等）。
  本机 `settings.yaml.imported` 的 `llm-pi-ai.providers` 全是 opencode 系，因此条条命中。
  注意 0.1.6-alpha.2 的适配器里**根本没有 `sessionId`**：这是插件一直存在的缺口，不是换版回归。
- **修法**：面板把 `state.sessionId` 传进 `generateMessage` → `GenerateOptions.sessionId`；
  端点校验"非空字符串、≤ 200 字符"（`invalid-session`），缺省时行为不变。
- **附带效应**：带上 `sessionId` 后，`dsh-session-checkpoint-policy` 会在模型调用前 flush 该会话
  （持久性屏障，良性）；`dsh-agent-loop` 的 invariant 与 `dsh-session-title` 仍会跳过一次性请求。
- **守护**：`test/generate.mjs`（转发 / 缺省）、`test/render.mjs`（verb 载荷）、`test/smoke.mjs`
  （`invalid-session` 矩阵 + "缺省不得拒绝"）。

### 4.3 会话列表快照里**只有 `byId` 可以依赖**

- 0.1.7 的 `SessionListState` 是 `{ ids, byId, phase, projectionsBySession }`；COMPAT §1 记的
  `subagentsByParent` / `jobsBySession` 在整棵 0.1.7 树里 **0 命中**（已 grep 复核）。
- 插件只读 `byId[sessionId]` 的 `cwd` / `retainedBy.mainView` / `projectionValues` —— 都没变，所以安全。
- `modelSelection` 投影现在有**两个面**：行上的 `projectionValues`（0.1.6+）与快照的
  `projectionsBySession[id].values`（0.1.7+）。`sessionModelRoute()` 先读行、再读共享记录，
  少读一面就会静默丢掉用户已经选好的路由。
- **守护**：`test/render.mjs` 的 `sessionModelRoute` 断言（两面、`next` 优先、缺省为 null）。

### 4.4 RPC 目标是"文档相对"的，而路由按绝对前缀注册（根挂载假设）

- 0.1.7 浏览器端改成 `send(`${channel}/${endpoint}`.slice(1))`（0.1.6 是
  `new URL(…, resolveBase())`），index 注入的 base 也从 `<base href="/">` 变成 `<base href="./">`。
- 在根挂载（`/` 或 `/index.html`）下二者等价，实测正常；子目录部署会同时打坏宿主自己的 `/api`，
  所以**不改代码**，只记这个假设。宿主自己的路由按 `new URL(req.url, "http://x").pathname` 匹配，
  本插件对 origin-form 目标保留原始字符串（更严格，拒绝 `..`），只对 absolute-form 目标做 URL 解析。

### 4.5 `llm` 是硬 inject，但它不是宿主的"必需启动项"

- `dsh-app-boot` 的 `requiredStartupEntryIds` 只有 `webserver/connection/modules/agent-loop/…`，
  **不含 `llm`**；非必需行挂载失败只打一行 stderr。若 `dsh-llm` 起不来，本插件会一直 PENDING，
  结果就是"胶囊和面板一起凭空消失"，而 `dsh web` 自己正常启动。
- 同理：`apply()` 里"拿不到 `requestRejection` 就抛"的围栏 guard 也只会是警告，不会拒绝启动。
  **保留**这个 guard（绝不能放行未围栏通道），但排查时要知道它只出现在 stderr 里。

### 4.6 面板几何常量是"量出来的"，不是契约

- `S.panel.bottom = 168` 与 `DIFF_PANEL_HEIGHT` 里的 `184px` 是对 composer 栈（卡片 + 工具行 +
  dock 带）的实测值；ui-conversation 把这块几何放在自己的模块 CSS 里（`--dsh-composer-stack-gap` 等），
  没有公开契约。输入框高度变了就要重新量这两处（面板靠 `bottom` 定位，两个数一起动）。
- 胶囊用 `max-width: var(--dsh-composer-card-max-width, 778px)` + `margin: 0 auto` 对齐输入框
  （内置 QueueDock 同款写法）。该变量是 ui-conversation 的内部变量，0.1.7 还多了一套 embedded 值；
  改名不会报错，只会静默退回 778px。

### 4.7 环境噪声（§3 的具体数字）

- profile 的 `@deepseek-ai` 共 258 项，其中 **17 个悬空 junction**，指向三个根：
  `nvm\v26.9.0`（244）、`nvm\v22.23.1`（8）、`D:\tool\npm\cache\_npx\1e7f6d9597241db0`（5）。
  悬空的包含 `dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-web` 等。
- profile 顶层的 `react` / `react-dom` 也是悬空 junction，所以 `test/render.mjs` 会回落到插件自己的
  `node_modules/react`（打印 `react from (node resolution)`）——**它没跑在 shell 真正 seed 的那份 React 上**。
- `profiles/web/node_modules/@deepseek-ai` 是**空目录**：`test/host-mount.mjs` 的 `findDshRoot()`
  是靠第二个候选根（`profiles/node_modules`）才找到宿主包的。
