# 宿主版本兼容性笔记（`@xia-sc/dsh-git`）

给维护者和 agent 的**踩坑档案**：宿主 dsh 升级后本插件"静默失效"的已知原因、确认它的手法、
当时的修法，以及守护它的测试。**每新增一条按同一体例写：症状 → 证据 → 根因 → 修法 → 守护测试。**

这不是通用说明：硬约束看 `AGENTS.md`，功能与端点契约看 `README.md` / `README.en.md`。

## 0. 宿主换版后的排查顺序

按这个顺序走，能最快把"插件坏了"和"宿主换 API 了"分开；每一步的判据都写明了。

1. **默认门禁**：`npm test`。其中 `test/host-mount.mjs` 会在真 Cordis + 真 `dsh-client-connection` 上挂一次
   插件行，并用宿主自己的 zod schema 校验插件手写的信封；`test/slot-mount.mjs` 会用真的
   `dsh-client-ui-slots` / `dsh-client-ui-renderer` 挂一次两个座位。
   **（2026-10 更新）** 这两句原来写的是"两者找不到 profile 时都 SKIP"——在 desktop 版上它们因此**双双空转**
   （宿主包被封进 `app.asar`，profile 下已经没有宿主包，见 §6.1）。现在宿主发现已改造：新的
   `test/host-root.mjs` 统一解析宿主根，desktop 版会自动从 `app.asar` 提取宿主包再跑。
   **契约不变的两条**：真的没有任何 profile（例如 CI 的 `ubuntu-latest`）仍然 SKIP + exit 0；
   但"**有 profile 却解析不到**"不许再退化成 SKIP —— 那正是 §5.4 记过的"守护自己静默失效"，
   本轮是它的**第二次发生**（第一次是 `slots` 版本探测被捆进 `try`）。
   **反证配方（三条都已实测）**：`DSH_HOME=<空目录> DSH_ASAR=<不存在的路径>` → 两个守护都 **SKIP + exit 0**
   （模拟 CI）；`DSH_GIT_DSH_ROOT=<空目录>` → **SKIP + exit 0**（沿用旧配方，指向空目录证明跳过路径还在）；
   `DSH_ASAR=<一个非 asar 的文件>` → 两个守护都 **FAIL + exit 1**（"有安装却读不到"必须响）。
2. **宿主半是否活着**：拿 `dsh web` 启动时打印的 token 换 cookie，再打一次端点。
   `401 unauthorized` = 路由在、围栏在（正常）；`404` = 路由压根没挂上；`200` + 正常 JSON = 宿主半完好。

   ```powershell
   $null = Invoke-WebRequest -Uri "http://127.0.0.1:3080/?token=<dsh web 打印的 token>" -SessionVariable sess
   Invoke-WebRequest -Uri "http://127.0.0.1:3080/dsh-git-rpc/status" -Method POST -ContentType application/json `
     -Headers @{Origin="http://127.0.0.1:3080"} -WebSession $sess -SkipHttpErrorCheck `
     -Body '{"type":"client-request","rpcId":"probe","method":"status","payload":{"args":{"cwd":"<绝对路径的仓库>"}}}'
   ```

   **（2026-10 补两条判据）**

   - **探针必须带端点段**：打 `POST /dsh-git-rpc`（正好等于路由前缀、没有 `/<endpoint>`）会得到 **404**，
     而且是插件自己的 `server-response` + `rpcId:"invalid-request"` + `not-found` —— 按上面那句"404 = 路由
     压根没挂上"就会**误判成宿主半没挂**（本轮我就先踩了这一下）。正确判据一律打 `/dsh-git-rpc/<endpoint>`。
     0.2.0-rc.2 的活体对照：`/dsh-git-rpc/status` **200**、无 cookie **401**、Origin 非本机 **403**、
     `GET /dsh-git-rpc/status` **405**、未知端点 `details.code:"unknown-endpoint"`、
     `POST /totally-unknown-rpc` **405**（落在 frontend-static fallback）。
   - **桌面版没有"打印出来的 URL"**：端口是 **19387**（`DSH_WEB_URL`）而不是 3080；一次性的 launch token
     由 Electron 主进程经 IPC 取走后直接交给内嵌窗口（`dsh-desktop-host/lib/index.js:337-344`），
     终端里拿不到。排查要么用**已登录的浏览器**，要么按 `AUDIT-0.2.0-rc.2.md` §一 的手法
     **自签一个会话 cookie**（签名密钥来自 credentials store 的 `client-connection/browser-session` 记录，
     cookie 形状见 `dsh-client-connection/lib/index.js:388-427`）。

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

   **（2026-10 更新）** 端口换成 19387（桌面版，见上一步）；**这一步的判据本身仍然有效** —— 0.2.0-rc.2 实测
   `__DSH_BOOT__` 里 `@xia-sc/dsh-git` 的 `rev` 与按 `artifactRevision()` 复算的值一致、送达字节与
   `lib/client.js` 逐字节相同（§6.2）。**注意比对用的是装机路径那份**（`profiles/desktop/node_modules/@xia-sc/dsh-git/`），
   不要拿仓库工作区那份：工作区是 CRLF，`rev` 和字节数都不一样（§6.1）。

5. **真 GUI 复现**：`$env:DSH_GIT_UI_URL="http://127.0.0.1:3080/?token=<token>"; node test/ui/verify-diff.mjs`。
   它第一句就要求 `[data-dsh-git="dock"]` 存在，所以只要它跑到后面，就说明胶囊回来了。
   （沙箱里 playwright 起 Chrome 会 `spawn EPERM`，见 `AGENTS.md` §8。）

   **（2026-10 更新）** 端口换成 19387；并且 **desktop 0.2.0-rc.2 的 shell 有两处与本脚本的旧假设冲突，
   已在脚本里修好**（两处卡点都在测试基建而非插件）：

   ① 0.2 首次启动的「预览版说明」弹层（`div[role=presentation]`，唯一按钮文案是**「继续」**，
   Escape 关不掉）盖住 dock，`dock.click()` 会被判定 `intercepts pointer events` 后 `TimeoutError`。
   ⇒ 脚本现在在 `page.goto` 之后先把它点掉（`继续` / `Continue` / `知道了` / … 任一命中即点），并打印一行 NOTE。
   ② 它切换工作区用的 `button[aria-label="选择工作区"]` 在桌面版不存在（现在是侧边栏的
   `[role=treeitem]` 列表，而且点工作区行**不会**把当前会话的 cwd 切过去）。
   ⇒ 脚本现在把 `status` / `log` / `branches` / `diff` **整条通道夹具化**（原先只夹具 `diff`），于是既不依赖
   工作区脏不脏、也不用切会话；找不到 picker 时打印 NOTE 后按会话自身的 cwd 继续。

   **`live` 模式的前置条件**：`DSH_GIT_UI_LIVE=1` 打真端点，所以要求会话所在的仓库**确有未提交改动**；
   工作区干净时脚本打印 `NO CHANGES TO SHOW` 并以 **exit 2** 退出（以前是 30 秒定位超时后崩掉）。

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

> ⚠️ **2026-10（desktop 版）**：下面**第一条**"悬空 junction"说的是 **web/CLI 版**的 profile 布局；
> desktop 版的 `profiles/*/node_modules/@deepseek-ai` 里**根本没有宿主包**（全在 `app.asar` 里），
> 不存在悬不悬空的问题 —— 见 §6.1。后两条（inspect 卡死、playwright EPERM）仍然适用。

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

> ⚠️ **0.2.0-rc.2 修正（2026-10）**：上面那句"胶囊和面板一起凭空消失"**不成立**，请按下面的判据排查
> （证据见 `AUDIT-0.2.0-rc.2.md` §3.4）。
>
> - `requiredStartupEntryIds` 仍然**不含 `llm`**（`dsh-app-boot/lib/index.js:3836-3844`），非必需行挂载失败
>   仍然只往 stderr 写一行（`:4009-4019`）—— 这一半没变。
> - 但**浏览器半不会跟着消失**：客户端入口的入选条件是 `entry.fiber !== void 0 && !entry.disabled`
>   （`dsh-client-modules/lib/index.js:833-839`），**不检查 fiber 是否 ACTIVE**。PENDING 的行照样进 boot 图、
>   照样发 `/plugins` 路由。
> - 真实后果是：两个界面**仍然渲染**，但宿主路由没注册 → 请求落到 frontend-static 的 fallback →
>   **POST 得 405**（`dsh-host-frontend-static/lib/index.js:87-92`）→ 浏览器半进入 `phase:"error"` →
>   胶囊显示「当前工作区不是 Git 仓库」。
> - **判据换成这三条**：stderr 有没有那一行 `dsh-git (@xia-sc/dsh-git): pending (waiting for service: llm)`；
>   Network 里 `/dsh-git-rpc/*` 是不是 **405**；胶囊是不是 notRepo。**不要再以"面板消失"当 PENDING 的判据。**
> - "凭空消失"对应的是另一种故障：入口**根本没解析到模块**（`entry.fiber === void 0`）—— 那种情况下它
>   连 boot 图都进不去。

### 4.6 面板几何常量是"量出来的"，不是契约

- `S.panel.bottom = 168` 与 `DIFF_PANEL_HEIGHT` 里的 `184px` 是对 composer 栈（卡片 + 工具行 +
  dock 带）的实测值；ui-conversation 把这块几何放在自己的模块 CSS 里（`--dsh-composer-stack-gap` 等），
  没有公开契约。输入框高度变了就要重新量这两处（面板靠 `bottom` 定位，两个数一起动）。
- 胶囊用 `max-width: var(--dsh-composer-card-max-width, 778px)` + `margin: 0 auto` 对齐输入框
  （内置 QueueDock 同款写法）。该变量是 ui-conversation 的内部变量，0.1.7 还多了一套 embedded 值；
  改名不会报错，只会静默退回 778px。

### 4.7 环境噪声（§3 的具体数字；**已过期，见 §5.3，而 §5.3 在 desktop 版上同样已过期，见 §6.1**）

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

> ⚠️ **0.2.0-rc.2 修正（2026-10）**：前半句不变，**后半句要反过来读** —— 缺服务不是"静默消失"，而是
> **整页启动失败**（证据见 `AUDIT-0.2.0-rc.2.md` §3.4）。
>
> - `dsh-web-frontend/dist/assets/index-5SrrfWpU.js` 里有一段 web 启动审计：遍历 loader 条目，对非 active 的
>   fiber 逐条收集 `pending (waiting for service: …)` / `import failed: …`，只要有一条就
>   `throw new Error("web boot: N entries did not activate\n…")`，被启动器接住显示在**启动页**；
>   同一条失败还会出现在 **设置 → 插件** 的 clientSync 里（`dsh-client-ui-settings-plugin-inventory/lib/client.js`）。
> - 也就是说 `slots` / `connection` / `locale` 任何一个没装上，都是**响的**故障，不是静默。
> - 修正后仍属静默的只剩**两种**，盯紧它们：
>   1. **座位改名或未声明**：`ctx.slots.inject(key, …)` 只在座位已声明时执行
>      （`dsh-client-ui-renderer/lib/client.js:1359-1369`，`spec === undefined` 直接 return），此时 fiber 是
>      active，上面的启动审计抓不到 → 座位永远不出现且**无任何报错**（§5.4 之外的另一条静默面）。
>   2. **列表行不再填 `cwd`**：`byId[id].cwd` 是条件展开的可选字段
>      （`dsh-api-session-controller/lib/types/client/sessions/service.js:509`），插件在 `lib/client.js:3105`
>      用 `if (!cwd || …) return null` 兜底 → 一旦宿主停填，胶囊与面板一起静默消失
>      （0.2.0-rc.2 仍在填，属"需持续盯"）。
- **`retainedBy.mainView` 未改名**：rc.1 的 `dsh-client-ui-session` 自己就写
  `(…retainedBy.mainView ?? 0) > 0`。`byId[].cwd` / `retainedBy` / `projectionValues` /
  `projectionsBySession[id].values` / `modelSelection{lastUsed,next}` 的形状逐字一致（§1、§4.3 判据不变）。
- **LLM 一次性调用**：`GenerateOptions` 字段、`RequestUserInput`（无 `id`/`source`）、
  `StreamChunk`(`text-delta`/`block-end`/`finish`)、`FinishReasonMap`、`sessionId` 的适配器转发全部不变
  （§4.1、§4.2 继续成立）。
- **`llm` 仍不是必需启动项**：它起不来时本行一直 PENDING，两个界面**静默消失**而 `dsh web` 自身正常
  （§4.5 继续成立；排查先看 stderr）。

  ⚠️ **0.2.0-rc.2 修正（2026-10）**：前半句仍成立（`llm` 依然不在 `requiredStartupEntryIds` 里），
  但"两个界面静默消失"**不成立**——两个界面照常渲染、宿主路由 405、胶囊显示 notRepo。
  判据与理由见 §4.5 的修正块（`AUDIT-0.2.0-rc.2.md` §3.4）。

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

> ⚠️ **2026-10**：本节数字描述的是 **web/CLI 版**的安装树；**desktop 版上已全部过期**，权威描述见 §6.1
> （宿主包在 `app.asar` 内、`profiles/node_modules/@deepseek-ai` 已是空目录、端口 19387）。
> 本节里唯一仍然成立的是最后一条取证陷阱（`glob`/`grep` 不跟随 junction；desktop 版还要加上"读不了 asar"）。

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

## 6. dsh desktop ≥ 0.2.0-rc.2

2026-10 全量审计（插件 0.7.0 × 宿主 **dsh desktop 0.2.0-rc.2**）：**零回归，不需要为换版改代码**。
宿主半自持路由与围栏、浏览器半两个座位与完整 diff 交互、AI 起草的真网关链路、主题 token 与几何常量，
全部在**真宿主 + 真浏览器 + 真网关**上验过。完整证据（含逐项文件行号与复核命令）见仓库里的
`AUDIT-0.2.0-rc.2.md`。

体例同上，但这一版**没有"症状"**：下面记的是**发行形态变化**、已复核必须保持的耦合、
本轮实测到的几何数字，以及别忘了的判据。

### 6.1 发行形态变了：宿主包全在 `app.asar` 里（**取代 §3 / §4.7 / §5.3 的环境描述**）

- desktop 版把**全部** `@deepseek-ai/*` 封进 Electron 的 `app.asar`：
  `app.asar\dsh\node_modules\@deepseek-ai\*`（约 300 个包，全部 0.2.0-rc.2）。
- `profiles/desktop/node_modules/@deepseek-ai` **只剩 2 项**（`cordis`、`cosmokit`）；
  `profiles/node_modules/@deepseek-ai` 是**空目录**；`profiles/web/node_modules/@deepseek-ai` 也是空目录。
- ⇒ **§4.7 的"258 项 / 17 个悬空 junction"、§5.3 的"241 项全部可解析 + CLI 树里 276 项"都已过期**；
  那套"profile 顶层 junction 指向 nvm/nodejs 的 CLI 树"的取证手法在 desktop 版上不再适用。
- **`app.asar` 就是一个文件，PowerShell / `Get-ChildItem` / `glob` / `grep` 都读不进去。**
  要读宿主源码只能自写 asar 读取器（`headerSize = readUInt32LE(4)` → `dataOffset = 8 + headerSize`，
  JSON header 在 offset 16，递归 `files` 树），或走 DSH 自己的文件层。另：asar 里**没有任何 `.d.ts`**
  （全树 0 命中），类型层证据只能用宿主自己生成的 `dsh-tool-cordis/lib/types/api-catalog.js`
  与 `dsh-llm/lib/typert.host.js` 的内嵌声明。
- **GUI 端口 3080 → 19387**（`DSH_WEB_URL`；`Get-NetTCPConnection -LocalPort 3080` 为空）；
  活的 profile 是 **`desktop`**（`DSH_PROFILE=desktop`），不是 `web`。
- **插件是 npm 安装副本，不是 `link:`**：`profiles/desktop/package.json` 里写的是 `@xia-sc/dsh-git: ^0.7.0`
  （web profile 里那条 `link:E:/dsh/plugin/dsh-git` 与本轮无关）。⇒ **改仓库不会自动生效**；
  要让 desktop 版跑上新代码得 `dsh plugin --profile desktop add …`（或换回 link），然后重启。
- **装机副本与仓库工作区是同一份代码**：`lib/client.js`（127448 / 130680 字节）、
  `lib/index.js`（61594 / 62982）、`cordis.patch.yml`（751 / 766）的 **LF 归一后 sha256 完全相同**；
  原始字节差全部来自工作区的 CRLF（3232 / 1388 / 15 行）。
- ⇒ **`rev` 复算与字节比对必须用装机路径那份**（`profiles/desktop/node_modules/@xia-sc/dsh-git/lib/client.js`）：
  0.2.0-rc.2 实测装机 `rev = 4c38468d8496`（`mtime=1791511820609.478` / `ctime=1791511820617.3904` /
  `size=127448`），工作区那份因为 CRLF 是 `23578ad7b30f`（size 130680）。

### 6.2 已复核、必须保持的耦合（0.2.0-rc.2 逐项未变）

- **自持路由仍必需**：外部插件调 `ctx.connection.rpc.handle()` 仍抛
  `cannot get property "webServer" without inject`（connection 插件 `inject=["credentials"]`，
  `webServer` 只在内层 `ctx.inject(["webServer"], …)` 里可见）。**§2 的设计不要改回去。**
- **`WebRoute` 仍没有 `method` 字段**：只有 `{kind, path, handler}`，`kind` 取 `exact`/`prefix`；
  前缀匹配是 `pathname === prefix || startsWith(prefix + "/")`，并且新增了"最长前缀优先"
  （`dsh-host-webserver/lib/index.js:177-184`、`:322-332`）。插件自己判 `req.method !== "POST"`
  （`lib/index.js:1326`），与之一致。
- **围栏仍返回数字三态**：`connection.requestRejection(req)` = `401 | 403 | undefined`
  （`dsh-client-connection/lib/index.js:586-589`），`res.statusCode = rejection` 仍必须按 number 用。
- **手写信封仍过宿主自己的 zod schema**：`test/host-mount.mjs` 在真 0.2.0-rc.2 上通过
  （`client-request` / `failure` / `unknown-endpoint` / 通道外 404 全部 `safeParse.success`）。
- **`artifactRevision()` 算法未变**：仍是 `framedHash("plugin-artifact", [mtimeMs, ctimeMs, size])`
  （`dsh-client-modules/lib/index.js:193-199`）。⇒ §5.5 的"启动图 + 送达字节"核对手法继续有效
  （本轮实测 rev 复算一致、送达字节与装机 `lib/client.js` 逐字节相同，只多 72 字节 sourcemap 尾）。
- **`llm` 仍不是必需启动项**：`requiredStartupEntryIds` = `{agent-loop, webserver, modules, connection,
  headless-runner, acp, sdk-jsonrpc-server}`（`dsh-app-boot/lib/index.js:3836-3844`）。
  **但它起不来时的症状描述要按 §4.5 的修正块读。**
- **会话快照形状未变**：`byId[].cwd` / `retainedBy.mainView` / `projectionValues` /
  `projectionsBySession[id].values` 都还在（§1、§4.3 判据不变）；`retainedBy.mainView` 仍是
  宿主 ui-session 自己的判据。
- **主题 token 零缺失**：插件用到的 17 个（16 个 `--dsw-alias-*` + `--dsw-shadow-lv2`）在 0.2.0-rc.2
  全部有定义，亮/暗各一份。
- **React 订阅方式无变化**：渲染器的 `useSyncExternalStore` 仍**优先用 React 自带实现**
  （`dsh-client-ui-renderer/lib/client.js:69`），插件用 `useState + useEffect`，不受影响。
- **AI 起草真链路实测通过**：真网关 `POST /dsh-git-rpc/generateMessage` → **200 / 1.96s**，
  返回英文提交信息，`sessionId` 被转发且**被网关接受** —— §4.2 记的 `MissingSessionID` 风险
  在本机 `commandcode` provider 上不存在（它把 `sessionId` 当 threadId，缺省则 `randomUUID()`）。

### 6.3 本轮实测的几何数字（"量出来的"，不是契约）

- **`bottom: 168` 在常规会话里仍然精确**：1440×900 下 composer 栈 `top=738, bottom=900`（高 162px），
  面板底边 y=732 → **重叠 0px**（留 6px 间隙）。⇒ §4.6 的实测值**不用改**。
- **新边界：空会话（hero 输入框）会被面板盖住**：新会话的 `composerStack` 带 `composerHero`、
  位于视口中央（`top=333, bottom=607`），而面板底边仍是 y=732 → **重叠 125px**。
  是否 0.2.0 引入没有可比对的旧版本树，本轮只记现象；§5.2 记的"多行草稿会盖住输入框"是同一个静态
  `bottom` 的另一种表现。
- **胶囊宽度对齐没有退化**：实测胶囊所在 dock 行容器宽 **774px**，等于 `getComputedStyle` 里
  `--dsh-composer-card-max-width` 的解析值（`calc(clamp(680px, 1160px*0.64, 920px) + 32px)` ≈ 774.4px）
  —— 变量**存在且被正确消费**，`778px` 只是它缺失时的 fallback。§5.2 记的"比宿主 dock 占用者窄
  16px/最多 32px"本轮所在会话里没有 queue 项，**未复现**，要与 QueueDock 同框才能判定。
- **层叠上下文**：宿主 `shell.overlay` 容器是 `.overlayLayer{z-index:20;pointer-events:none}`，
  外层 frame **没有 `transform`**，所以插件面板的 `position:fixed` 仍以视口为基准；面板自身是
  **`z-index:30`**（`lib/client.js:391`，不是 20），在 overlay 层内高于 composer 座位的 7/9。
  （证据：`dsh-client-ui-layout/lib/client.js:73`。）

### 6.4 别忘了的判据

- **探针必须带端点段**：`POST /dsh-git-rpc` 返回 404（见 §0 第 2 步的补充），别据此判定"路由没挂"。
- **桌面版拿不到"打印出来的 token"**：用已登录浏览器，或按 `AUDIT-0.2.0-rc.2.md` §一 自签会话 cookie
  （§0 第 2 步）。
- **asar 里的东西读法不同**：`glob`/`grep`/`Get-ChildItem` 都穿透不了它 —— 这是 §5.3 那条
  "glob/grep 不跟随 junction"的姊妹坑。

### 6.5 守护它的测试

- **`test/host-root.mjs`（新）**：统一解析宿主根；desktop 版从 `app.asar` 提取宿主包，
  `test/host-mount.mjs` 与 `test/slot-mount.mjs` 共用它。**"有 profile 却解析不到"不得退化成 SKIP**
  （§0 第 1 步）。
- **`test/host-root.mjs` 的 asar 发现跨盘符**：`%LOCALAPPDATA%` 与程序安装盘**可以不是同一个盘**
  （本机 AppData 在 `C:`、程序在 `D:`），所以它枚举所有盘符下的
  `Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`；也可用 `DSH_ASAR` 显式指定。
  首次提取约 7800 个源文件 / 90MB，缓存到 `%TEMP%\dsh-git-host-asar\<asar 的 size+mtime 哈希>`，
  宿主换版后 key 变化即自动重提取。只提取 `.js/.mjs/.cjs/.json`，跳过原生扩展与平台大目录。
- **反证配方仍有效**：`DSH_GIT_SLOT_FIXTURE=embedded node test/slot-mount.mjs` 应当**失败**（默认夹具全过）
  —— 绿灯不是空转。
- **`test/ui/verify-diff.mjs` 已适配 desktop shell**：自己关首启弹层、整条 `/dsh-git-rpc` 通道夹具化
  （不再要求工作区是脏仓库）、没有工作区选择器时按会话自身 cwd 继续；`live` 模式在干净工作区上明确
  `NO CHANGES TO SHOW` + exit 2，而不是超时（§0 第 5 步）。实测：真 0.2.0-rc.2 GUI 上 fixture 模式 exit 0。
