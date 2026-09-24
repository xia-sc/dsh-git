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

### 4.7 环境噪声（§3 的具体数字；**已过期，见 §5.3**）

- profile 的 `@deepseek-ai` 共 258 项，其中 **17 个悬空 junction**，指向三个根：
  `nvm\v26.9.0`（244）、`nvm\v22.23.1`（8）、`D:\tool\npm\cache\_npx\1e7f6d9597241db0`（5）。
  悬空的包含 `dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-web` 等。
- profile 顶层的 `react` / `react-dom` 也是悬空 junction，所以 `test/render.mjs` 会回落到插件自己的
  `node_modules/react`（打印 `react from (node resolution)`）——**它没跑在 shell 真正 seed 的那份 React 上**。
- `profiles/web/node_modules/@deepseek-ai` 是**空目录**：`test/host-mount.mjs` 的 `findDshRoot()`
  是靠第二个候选根（`profiles/node_modules`）才找到宿主包的。

## 5. dsh ≥ 0.1.7-rc.1

2026-09 全量审计（插件 0.7.0 × 宿主 0.1.7-rc.1）：**零回归，不需要为换版改代码**。
宿主半挂载并持有围栏（活体探针 401，对照路径 404/405）、浏览器半在 rc.1 的客户端 boot 图里且送达字节与
`lib/client.js` **逐字节相同**、两个座位在真 `SlotRegistry` 上注册成功、AI 起草链路的每个宿主契约逐项吻合、
默认门禁与两个端到端 git 套件全绿。完整证据（含逐项文件行号）见仓库里的 `AUDIT-0.1.7-rc.1.md`。

体例同上，但这一版**没有"症状"**：下面记的是"再改回去就会静默坏"的判据、本轮实测到的漂移，以及新增的守护。

### 5.1 已复核、必须保持的耦合

- **路由仍是自持的**：外部插件调 `ctx.connection.rpc.handle()` 在 rc.1 依旧抛
  `cannot get property "webServer" without inject`（该插件 `inject` 只有 `["credentials"]`，
  靠内层 `ctx.inject(["webServer"], …)` 取路由）。**§2 的设计继续必需，不要改回去。**
- **`webServer.register` 的 route 没有 `method` 字段**：rc.1 的 `WebRoute` 只有 `{kind, path, handler}`，
  `kind` 取 `exact`/`prefix`，前缀匹配是 `pathname === prefix || startsWith(prefix + "/")`。
  插件自己判 `req.method !== "POST"`，与之一致。
- **围栏返回的是数字**：`connection.requestRejection(req)` 的类型是 `401 | 403 | undefined`
  （不可信来源 403、未认证 401）。`res.statusCode = rejection` 必须按 number 用——若将来宿主改成返回字符串，
  这里会**静默**写出非法状态码。
- **失败信封必须带 record 型 `details`**：浏览器侧是**手写**校验（不是 zod），除 `type`/`rpcId` 外还要求
  `isRecord(error.details)`。`fail()` 恒给对象、所有 `rpcError(...)` 调用点都传对象，才不至于被浏览器判成
  "invalid server-response failure"。
- **`dsh.client.inject` 是"信息性包名依赖"，不是服务注入**：宿主类型注释明写，且未命中的包名**静默跳过**。
  真正的静默失效路径是客户端自己导出的 `inject = ["slots","connection","locale"]`（服务名）：
  缺提供者时 fiber 被 park，**胶囊与面板一起消失**。
- **`retainedBy.mainView` 未改名**：rc.1 的 `dsh-client-ui-session` 自己就写
  `(…retainedBy.mainView ?? 0) > 0`。`byId[].cwd` / `retainedBy` / `projectionValues` /
  `projectionsBySession[id].values` / `modelSelection{lastUsed,next}` 的形状逐字一致（§1、§4.3 判据不变）。
- **LLM 一次性调用**：`GenerateOptions` 字段、`RequestUserInput`（无 `id`/`source`）、
  `StreamChunk`(`text-delta`/`block-end`/`finish`)、`FinishReasonMap`、`sessionId` 的适配器转发全部不变
  （§4.1、§4.2 继续成立）。
- **`llm` 仍不是必需启动项**：它起不来时本行一直 PENDING，两个界面**静默消失**而 `dsh web` 自身正常
  （§4.5 继续成立；排查先看 stderr）。

### 5.2 本轮实测到的漂移（都不是回归，勿误判为换版坏了）

- **胶囊对齐落后于 rc.1 的新变量**：composer 新增 `--dsh-composer-dock-inset: 8px` 与
  `--dsh-composer-side-clearance: 16px`；宿主的 dock 占用者（QueueDock）用
  `width: calc(100% - 2*clearance - 2*inset)` / `max-width: calc(card-max-width - 2*inset)`，
  而胶囊只按 `max-width: var(--dsh-composer-card-max-width)` 对齐 → **实测宽 16px**（窄列最多 32px）。
  因此 **§4.6 里"胶囊是内置 QueueDock 同款写法"这句已不准确**；另，胶囊的 `778px` 兜底只是真实区间
  （712–952px）里的一个值，别当成真值。
- **面板高度仍是实测值**：`bottom: 168` 与 `DIFF_PANEL_HEIGHT` 里的 `184px` 一起动（§4.6）。
  **已知边界**：该静态 `bottom` 只对空/单行草稿成立——宿主文本区上限
  `--dsh-composer-text-max-height: 336px` 会让 composer 栈长到约 430px，而 shell overlay 层是
  `z-index: 20`、composer 座位是 `auto`，于是**多行草稿时面板会盖住输入框**。这是既有设计局限
  （168 与 30 都是插件自己的常量），不是换版引入。
- **主题 token 零退化**：插件用到的 17 个（16 个 `--dsw-alias-*` + `--dsw-shadow-lv2`）rc.1 全部定义，
  亮/暗各一条；别名表 79 → 90 **只增不改**；§4 点名过的三个"不存在的名字"插件侧已清干净。

### 5.3 环境事实（**取代 §4.7 的旧数字**）

- `profiles/node_modules/@deepseek-ai` 现为 **241 项，全部是可解析的 junction，无一悬空**，指向
  `D:\software\nvm\nvm\v26.9.0\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai`（**276 项**）；
  另一份同版本拷贝在 `D:\software\nodejs\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai`。
- **`dsh-client-ui-slots` 等 35 个包只在上面那棵嵌套树里**，不再有 profile 顶层链接——
  dsh 把自己的嵌套依赖留在 CLI 树内。`test/slot-mount.mjs` 的 `addVendoredRoots()` 就是为此兜底。
- `profiles/web/node_modules/@deepseek-ai` 仍是**空目录**；运行中的 `dsh web` 由
  `D:\software\nodejs\...\dsh\lib\bin.js` 启动（同为 0.1.7-rc.1），而 profile 的 junction 指向 nvm 那棵。
- `react`/`react-dom` 仍从插件自己的 `node_modules` 解析（`test/render.mjs` 打印 `react from (node resolution)`）。
- **`glob`/`grep` 不跟随 junction**：对 profile 下的 `@deepseek-ai` 会给出"文件不存在"的**假结论**
  （踩过：据此误判 `dsh-client-ui-slots` 已从 rc.1 消失）。取证要用真实路径复核。

### 5.4 本轮加固的守护

- **`test/slot-mount.mjs`：`slots` 的版本探测改为可选。** 它原来与必需依赖同在一个 `try` 里，
  一旦解析不到就把整个浏览器半守护退化成 `SKIP` + exit 0——**已实测复现**（让 `locate()` 拒绝该 spec，
  旧代码打印 `SKIP: …` 并 exit 0），即"防静默失效的守护自己静默失效"。现在解析不到只打印 `slots@?`
  并继续，由 renderer 自己的 `require("@deepseek-ai/dsh-client-ui-slots")` **响亮失败**（实测 exit 1）；
  "没有 profile → SKIP" 的契约不变（实测 exit 0）。
- 反证配方仍有效：`DSH_GIT_SLOT_FIXTURE=embedded node test/slot-mount.mjs` 在 rc.1 上**失败 9 项**
  （默认夹具全过）——绿灯不是空转。
- **`test/ui/verify-diff.mjs`：live 模式不再被夹具内容绑死。** 它此前把夹具独有的形状当成断言，
  于是 `DSH_GIT_UI_LIVE=1` 在**任何普通工作树上必红**（实测 3 项失败），而 AGENTS §6 恰恰把 live 模式
  列为维护步骤。现在：内容形状断言只在 fixture 模式跑；两种模式都新增一条**内容无关**的一致性断言
  （头部的 `+N −M` 必须等于实际画出的行数）；换行三连在真 diff 没有超宽行时跳过并打印 NOTE；
  live 模式不再覆盖 `test/ui/diff-panel.png`（那是 fixture 的参考图）。反证：删掉夹具里那两行特征后，
  fixture 模式仍报 3 项失败——断言没被改空。

### 5.5 本轮在真宿主 / 真浏览器上的实测（换版后照这个顺序验）

- **启动图**：带 token 的 `GET /` 里 `__DSH_BOOT__` 有 `@xia-sc/dsh-git`（落 `application` 批），
  其 `rev` 与按 `artifactRevision()`（mtime/ctime/size 的 framed sha1）复算 `lib/client.js` 的值**相同**。
- **送达字节**：`GET /plugins/??@xia-sc/dsh-git/client.js&rev=<rev>` 的返回体与 `lib/client.js`
  **逐字节相同**，仅多 72 字节的 sourcemap 尾巴。
- **已认证端点**：`status`/`log`/`branches`/`diff` 全 200 且数据正确；失败走 `error.code="internal"`
  + `details.code`（实测 `invalid-cwd`）；`diff` 的 `index` 侧为 0 —— 只读端点确实只读。无 cookie 仍 401
  （对照：未知路径 GET 404 / POST 405，`/api` 401）→ 401 是**路由级**的。
- **真浏览器**：fixture 与 live 两种模式**都通过**（胶囊 → 面板 → 点变更行 → 两栏 → 拖 120px →
  双击复位 → 换行开关 → 收回单栏，无 `pageerror`）。live 模式下另做交叉核对：面板画出的
  `add/del/hunk/fileHeader/noNewline` 与真端点原始 diff 按插件规则数出的值**完全一致**。
- 上一轮 alpha.1 审计**没能跑通**这段（当时工作区干净，fixture 模式在"变更行"处提前退出），
  所以这是第一次端到端实测覆盖到"真浏览器 + 真端点"。
