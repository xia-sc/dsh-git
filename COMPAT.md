# 宿主版本兼容性笔记（`@xia-sc/dsh-git`）

给维护者和 agent 的**踩坑档案**：宿主 dsh 升级后本插件"静默失效"的已知原因、确认它的手法、
当时的修法，以及守护它的测试。**每新增一条按同一体例写：症状 → 证据 → 根因 → 修法 → 守护测试。**

这不是通用说明：硬约束看 `AGENTS.md`，功能与端点契约看 `README.md` / `README.en.md`。

## 0. 宿主换版后的排查顺序

按这个顺序走，能最快把"插件坏了"和"宿主换 API 了"分开；每一步的判据都写明了。

1. **默认门禁**：`npm test`。`test/host-mount.mjs` 会在真 Cordis + 真 `dsh-client-connection` 上挂一次
   插件行，挂不上会直接说原因（它从 `DSH_HOME` 的 profile 解析依赖，找不到就 SKIP）。
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
