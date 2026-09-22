# 兼容性审计：`@xia-sc/dsh-git` 0.6.0 × dsh 0.1.7-alpha.1

审计时间：2026-09-22。被审计对象：本仓库 `master` @ `b770107`（工作区干净）。宿主：dsh **0.1.7-alpha.1**。
本文件是**一次性审计报告**，不是维护文档；`COMPAT.md` 本文件没有改动。

一句话结论：**插件在 0.1.7-alpha.1 上仍然挂得上、跑得通**（宿主半、浏览器半、两处座位、diff 面板、RPC 信封全部实测通过），
**没有发现会静默失效的换版断裂**；但发现了 **1 个用户可见的实际故障（AI 起草，已复现）**、**1 个潜在契约断裂（LLM 消息 source kind 已被宿主废弃）**，
外加 **13 个 MINOR**（宿主半 7 条、浏览器半 6 条，都是文档/耦合/守护测试类，不影响今天的可用性）。

严重度分布：BLOCKER 0 / MAJOR 2（§2.1、§2.2）/ MINOR 13（§2.3、§2.4）。

---

## 1. 环境与实测证据

### 1.1 版本与路径

| 角色 | 路径 | 版本 |
| --- | --- | --- |
| 正在运行的 `dsh web` | PID 52196，`D:\software\nodejs\node_modules\@deepseek-ai\dsh\lib\bin.js web`，`127.0.0.1:3080` | 0.1.7-alpha.1 |
| 宿主包真实来源 | `C:\Users\sc\.dsh\profiles\node_modules\@deepseek-ai\*`（junction）→ `D:\software\nvm\nvm\v26.9.0\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*` | 全部 0.1.7-alpha.1 |
| 本插件的部署方式 | `...\profiles\web\node_modules\@xia-sc\dsh-git` → `E:\dsh\plugin\dsh-git`（link） | 0.6.0 |
| 版本对比基线 | `E:\dsh\deepseek-harness\deepseek-harness`（tag `dsh-v0.1.6-alpha.2`，`ddefc45fbc`） | 0.1.6-alpha.2 |

> 注意：`C:\Users\sc\.dsh\profiles\web\node_modules\@deepseek-ai` 是**空目录**。
> `test/host-mount.mjs` 能通过，是因为 `findDshRoot()` 的第二个候选根（`profiles/node_modules`）命中了真正的安装树
> （`test/host-mount.mjs:20-33`）。建议在该测试里加一行注释，免得下次换版时误判"profile 里没有宿主包"。

### 1.2 门禁（全部本机实跑）

| 命令 | 结果 |
| --- | --- |
| `npm test` | **PASS** —— smoke + host-mount（`mounted against @deepseek-ai/dsh-client-connection@0.1.7-alpha.1`）+ generate + render |
| `npm run test:diff` | **PASS**（真 git 端到端：两侧、未跟踪、重命名配对、删除、二进制、截断、校验） |
| `npm run test:commit` | **PASS**（`git log --format=%B` 逐字节比对） |

### 1.3 真实宿主启动（隔离实例，未触碰用户正在使用的 3080）

为了拿到"浏览器真正跑的是哪份代码"与启动图，我另外起了一个**隔离实例**
（`dsh --profile web --no-open --port 0`，用完即杀；全程未重启、未干扰 3080 那个进程）：

- **启动图（`window.__DSH_BOOT__`）里有本插件**，且 id 与自注册 id 一致：

  ```json
  {"id":"@xia-sc/dsh-git","url":"plugins/??@xia-sc/dsh-git/client.js&rev=4d3850dfb3e6",
   "rev":"4d3850dfb3e6",
   "inject":["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-layout"]}
  ```

  与 `lib/client.js:22` 的 `window.__ModuleLoader__.load({ id: "@xia-sc/dsh-git", … })` **完全一致**。
- **服务端送出的浏览器代码 = 仓库源码**：抓取该 bundle 后与本仓库 `lib/client.js` **逐字节比对，
  前 108619 个字符完全相同**，仅多出宿主的 72 字节 combo 尾巴（`;\n//# sourceMappingURL=…`）。
- **宿主半在真宿主里应答**：带 cookie `POST /dsh-git-rpc/status` → **200**

  ```json
  {"type":"server-response","rpcId":"audit-1","result":{"ok":true,"value":
   {"repo":true,"branch":"master","oid":"b770107…","upstream":"origin/master","ahead":0,"behind":0,"dirty":0,"changes":[]}}}
  ```

- **围栏仍然有效**：同样请求不带 cookie → **401**；未知路由 → 405。用户自己的 3080 实例上同样是 401
  （即路由已挂、围栏在，无需重启它）。

### 1.4 真实浏览器（playwright-core + 本机 Chrome，无头）

对隔离实例跑了 `test/ui/verify-diff.mjs`（fixture 模式）与一个临时探针，实测结果：

| 观测 | 结果 |
| --- | --- |
| `[data-dsh-git="dock"]`（`conversation.input.dock`，会话作用域） | **存在**，文案 `⎇ master`，`title` = `E:\dsh\plugin\dsh-git` |
| `[data-dsh-git="panel"]`（`shell.overlay`，根作用域） | **存在**，点胶囊后展开 |
| 变更/最近提交区块 | 渲染正常（`log` 列出 10 条真实提交） |
| 页面实际发出的 `/dsh-git-rpc/*` | `200 status`、`200 branches`、`200 log` |
| `pageerror` | 无 |

这直接证伪了 `COMPAT.md` §1 那类"会话绑定失效 → 胶囊与面板一起静默消失"的回归：**会话作用域座位拿到了 `sessionId`、
从 `useSessions` 快照解析出 `cwd` 并绑进 store，根作用域面板只读 store —— 两侧都在**。

> 变更列表为空（`▾ 变更 0 ✓ 工作区干净`）不是缺陷：探针文件被用户全局 `.gitignore`（`*.tmp`）忽略，git 本身就看不到它。

### 1.5 版本差异的取证方式

宿主半与浏览器半各由一次**独立子审计**完成，二者都给出了已安装树的 `file:line` 证据：

- 宿主半：把 0.1.6-alpha.2 的 checkout 与已安装的 0.1.7-alpha.1 做逐文件对比（§2.3 的 F2–F8）。
- 浏览器半：除静态核对之外，还在 Node 里**加载真实的 0.1.7-alpha.1 `SlotCore` + `SlotRegistry`/渲染器**，
  挂上真实座位规格与一份 `SessionListState` 夹具跑通注册与静态渲染（§2.4 的 C1–C6）。
  该结果与我在真浏览器里的观测（§1.4）互为独立佐证。

我对两份报告中影响最大的结论都做了定点复核（§2.3 F1、§2.4 C1/C2/C4/C6、AI 起草故障）。

---

## 2. 发现

### 2.1 MAJOR（用户可见，已复现）：AI 起草在"需要会话身份"的 provider 上失败

**复现（1 秒，未计费，返回 400）**：对隔离实例调用真实端点
`POST /dsh-git-rpc/generateMessage`（`cwd` = 一个真有未暂存改动的仓库，`mode: "unstaged"`，不指定 provider/model）：

```json
{"ok":false,"error":{"code":"internal","message":"400: {\"type\":\"MissingSessionID\",
 \"message\":\"Request is missing x-opencode-session and cannot be routed efficiently. …\"}",
 "details":{"mode":"unstaged","code":"llm-failed"}}}
```

**根因链**（三段都有据可查）：

1. 插件构造的一次性请求**从不带会话身份**——`lib/index.js:1065-1072` 只放
   `provider / model / messages / system / maxTokens / signal`，没有 `sessionId`。
2. 宿主**只在有值时**才把它转给 pi-ai：`dsh-llm-pi-ai/lib/index.js:1881`
   `...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) }`；
   没有 sessionId ⇒ 不发送任何会话亲和头。
3. provider 端要求它，于是 400：本机配置里 `llm-pi-ai` 的三个路由
   `opencode-go` / `opencode-go-zdy` 都是 opencode 系（`settings.yaml.imported` 的 `llm-pi-ai.providers.*`）。
   而 `resolveLlmRoute`（`lib/index.js:1010-1034`）在客户端没给路由时取 `listProviders()[0]` —— 正好命中这一类。

**影响**：用户点「✨ AI 起草」时拿到的不是草稿，而是 provider 的原始错误；
`describeGenerate`（`lib/client.js:2438-2453`）的已知码表里**没有** `llm-failed`，
所以面板会把这段英文 HTTP 错误原文显示出来。若某条路由以"200 + 空流"回应，则表现为
`llm-empty` → 「模型没有返回提交信息」。

**与用户报告的关系**：用户 5 小时前的会话标题是「点击AI生成时报错「模型没有…」——这正是
`generate.empty` 的中文串「模型没有返回提交信息」（`lib/client.js:75`）的前缀。
两者是同一功能的两种失败形态；我复现的是 `llm-failed`，未复现到 `llm-empty`。

**建议修法**（客户端已经知道 `sessionId`，成本很小）：

- 浏览器半：`store.verbs.generateMessage(cwd, mode, provider, model, sessionId)` 里带上 `state.sessionId`；
- 宿主半：`generateMessage` 端点接收可选 `sessionId`（校验为字符串，非必需，缺失时行为不变），
  透传进 `requestCommitMessage` 的 options：`sessionId`；
- 注意副作用：一旦带上 `sessionId`，`dsh-session-checkpoint-policy`（`lib/index.js:61-65`）会在调用前
  **flush 该会话**（持久性屏障，属良性）；`dsh-session-title` / `dsh-agent-loop` 的监听器仍会跳过
  （前者要求 `isAgentLoopRequest`，后者是 WeakSet 判定）。

**性质说明（避免误判成换版回归）**：0.1.6-alpha.2 的 `packages/llm/llm-pi-ai/src/index.ts` 里**根本没有 `sessionId`**，
所以这不是 0.1.7 新引入的 API 变化，而是**插件一直存在、被这类 provider 暴露出来的缺口**。
但它确实是"在 0.1.7-alpha.1 + 本机配置下，AI 起草不可用"，按审计口径必须单列。

### 2.2 MAJOR（潜在契约）：一次性 LLM 消息用了已被宿主废弃的 `source.kind = "plugin"`

- 插件构造（`lib/index.js:1045-1052`）：
  `{ id: randomUUID(), role: "user", content: [{type:"text",text}], source: { kind: "plugin", plugin: name } }`，
  在 `:1068` 作为 `messages[0]` 传入。
- 0.1.7-alpha.1 里 `plugin` **不再是合法的来源种类**：
  - `dsh-llm/lib/types/message.d.ts:96-108`：`MessageSourceMap` 只有 `user|model|tool|system-prompt`，
    注释明确写着 *"there is no shared catch-all `plugin` kind"*；
  - 手工构造的一次性输入被定义为 `RequestUserInput`，且 `id?: never; source?: never`
    （`dsh-llm/lib/types/types.d.ts:456-464`）；
  - Session format v4 **硬拒**这个 kind：`dsh-session-format-v3-to-v4/lib/index.js:126`
    `… || value["kind"] === "plugin") throw new SessionFormatError("format v4 message requires a producer-owned source kind")`
    （`:118` 只把它当作 v3 迁移输入来改写）。
- **0.1.6-alpha.2 里它是合法的**：`E:\dsh\deepseek-harness\deepseek-harness\packages\llm\llm\src\message.ts:104`
  `plugin: { kind: 'plugin'; plugin: string } & ContextFormed` —— 所以这是**宿主删掉的词汇**，不是插件写错了。
- **今天为什么没炸**：`dsh-llm/lib/index.js:2152-2155`（`forAdapter`）遇到非 assistant 消息直接 `return message`，
  从不读 `source`；而且一次性请求不会被持久化。属"靠实现细节活着"。
- **修法**（一行）：改成宿主文档化的一次性形状 —— 去掉 `id` 与 `source`：

  ```js
  function generationMessage(text) {
    return { role: "user", content: [{ type: "text", text }] };
  }
  ```

  `test/generate.mjs` 里若断言了 `source`，需同步改。

### 2.3 MINOR（宿主半，来自独立子审计，证据均为已安装 0.1.7-alpha.1 的 `file:line`）

| ID | 问题 | 证据 / 影响 | 建议 |
| --- | --- | --- | --- |
| F2 | RPC 目标由"绝对"变成"**文档相对**"，而插件按绝对前缀注册 | 浏览器端改为 `send(`${channel}/${endpoint}`.slice(1))`（`dsh-client-connection/lib/client.js:1221`，0.1.6 用 `new URL(…, resolveBase())`），index 现在注入 `<base href="./">`（`dsh-host-frontend-static/lib/index.js:85`，0.1.6 是 `"/"`）。**根挂载下二者等价**，实测正常；子目录部署时会失效——但宿主自己的 `/api` 同样如此，非插件问题 | 不改代码；把"根挂载假设"记进 `COMPAT.md` |
| F3 | 插件按字符串切 `req.url`，宿主按 URL pathname 解析 | 插件 `lib/index.js:1216` vs `dsh-host-webserver/lib/index.js:232`。普通浏览器请求一致；**绝对形式请求目标（前置代理）**会被路由进来却 404 | 改成 `new URL(req.url ?? "/", "http://x").pathname` |
| F4 | `inject` 里硬依赖 `llm`，但它不是宿主"必需启动项" | `dsh-app-boot/lib/index.js:3435-3443` 的 `requiredStartupEntryIds` 只有 `webserver/connection/modules/…`；非必需项失败只 warn（`:3611`/`:3618`）。若 dsh-llm 起不来，**整个 Git 胶囊/面板消失，只剩一行 stderr** | 保留 inject（当前组合里 llm 必挂），在 `COMPAT.md` 记下这个耦合 |
| F5 | 拿不到 `requestRejection` 时抛错，但**抛不死启动** | 同上：dsh-git 不在必需列表，`lib/index.js:1209-1211` 的 throw 只会变成警告。代码注释把它说成"loud"，实际是 stderr 级 | 保留 throw（绝不能放行未围栏通道）；改注释/文档措辞 |
| F6 | 自持通道绕过了 `/api` 会走的 `connection/request` waterfall | `/api`：`dsh-client-connection/lib/index.js:840`；**0.1.7 没有任何内置监听器**注册该事件，所以今天等价 | 无需改动；将来宿主真用该钩子时优先复核 |
| F7 | `test/host-mount.mjs` 只验证"路由对象进了替身的 webServer"，不校验信封 | 子审计用宿主自己的 zod schema 跑过插件四种信封（client-request / 成功 / `fail()` / 404），**全部 PASS**（schema：`dsh-client-connection/lib/index.js:484-517`） | 把 `safeParse` 那四种形状加进门禁 |
| F8 | `readBoundedBody` 的注释过时（说 `IncomingMessage` 异步迭代"不稳定"） | 宿主自己就在 `for await (const chunk of req)`（`dsh-client-connection/lib/index.js:58`） | 改注释或改用 `for await` |

### 2.4 MINOR（浏览器半，来自独立子审计；括号内为我已复核的证据）

| ID | 问题 | 证据 / 影响 | 建议 |
| --- | --- | --- | --- |
| C1 | **`COMPAT.md` §1 记的快照字段已经不存在**（插件本身不受影响） | `SessionListState` 现在是 `{ids, byId, phase, projectionsBySession}`（写入点 `dsh-api-session-controller/lib/types/client/sessions/service.js:561`）；**全树 grep `jobsBySession`/`subagentsByParent` = 0 命中**（我复核）。插件只读 `byId`，所以今天无影响，但文档会把后来者指向两个已删字段 | 更新 §1 的字段清单；起草路由可先读 `projectionsBySession[*].values.modelSelection`，保留现有读法兜底 |
| C2 | 胶囊对齐依赖**未公开的内部 CSS 变量** | `lib/client.js:2689` 用了 `var(--dsh-composer-card-max-width, 778px)`；该变量在 0.1.7 仍在 `dsh-client-ui-conversation/lib/client.js:15623` 定义（我复核），但 0.1.7 改了公式集（主区 + 新增的 `.wSkVaW_embeddedBody` 两套值），且不在公开契约里。改名的后果是**静默退回 778px** | 改用内置 QueueDock 的写法（`max-width` + `margin:0 auto`），并在 `COMPAT.md` 记下这个内部耦合 |
| C3 | `dsh.client.inject` 只列 3 个包，实际消费 ≥6 个包的契约 | 该字段只是"工厂到达顺序"提示（`dsh-package-manifest/lib/types/types.d.ts:79-80`、`dsh-client-modules/lib/client.js:603-606`），真正的服务来自 renderer / connection / locale / ui-session | 把 `dsh-client-ui-renderer`、`dsh-client-connection`、`dsh-client-ui-session` 补进 `dsh.client.inject`（多列的行会被忽略，不会坏），改完需重启 `dsh web` |
| C4 | **门禁看不见座位/启动断裂** | `test/render.mjs:135-138` 的 `slots` 是手写捕获桩，不跑真实注册校验与 prop 合成；且它用的 React 是本地 `18.3.1`（我复核 `node_modules/react` = 18.3.1），而 shell seed 是 `18.3.1-next-…` | 加一个"用真 `SlotCore` + 真渲染器"的测试（子审计已跑通这套 harness，可照搬），断言两个条目注册成功且不出现 `data-slot-error` |
| C5 | 面板 `bottom: 168` 是未记录的输入框几何假设 | `lib/client.js:255`（我复核）；`DIFF_PANEL_HEIGHT` 里的 184px（`:1477`）同源。0.1.7 的 composer 几何是模块内 CSS 变量，无公开契约 | 运行时从胶囊量 `getBoundingClientRect()` 推导（168 兜底），或把耦合写在常量旁 |
| C6 | 关于 `useSyncExternalStore` 的注释**理由不成立** | 渲染器对标准 hook 的合成用的是 `useSyncExternalStoreWithSelector`，且**优先用 React 自带实现**（`dsh-client-ui-renderer/lib/client.js:69/92/159`，我复核）——插件的 `props.useSessions` 早就跑在 uSES 上 | 把 `lib/client.js:1803-1806` 与 `:2644` 的注释改成真实理由（与 seed 的 uSES 实现解耦），别让后人以为经典写法是必须的 |

### 2.5 环境问题（不是插件的锅，但会误导判断）

profile 的 `@deepseek-ai` 是**混合 junction 树**：258 个条目里 **17 个是悬空链接**（`package.json` 不可达），
目标根有三个 —— `nvm\v26.9.0`（244 个）、`nvm\v22.23.1`（8 个）、`D:\tool\npm\cache\_npx\1e7f6d9597241db0`（5 个）。
悬空的包含 `dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-web`、`cordis-plugin-hmr` 等。
**对本插件无实际影响**（它的客户端 inject 只点名 locale / ui-conversation / ui-layout，三个都指向 0.1.7-alpha.1；
slots/primitives 由 shell 自己 seed），但它让"我到底在审哪个版本"变得需要额外取证 —— 建议清一次 profile。

同一棵树里 profile 顶层的 `react` / `react-dom` 也是**悬空 junction**（指向 v22.23.1 树，`package.json` 不存在，
已复核）。这就是 `test/render.mjs` 打印 `react from (node resolution)` 并回落到插件自己的 `node_modules/react@18.3.1`
的原因 —— 测试因此**没有跑在 shell 真正 seed 的那份 React 上**（见 §2.4 C4）。

`COMPAT.md` §3 已经写了这类噪声；本次只是给出了确切数字，无需改代码。

---

## 3. 已核对且**无变化**的契约（换版安全的正面证据）

| 契约 | 插件用法 | 0.1.7-alpha.1 证据 |
| --- | --- | --- |
| `webServer.register({kind:"prefix",path,handler})` | `lib/index.js:1212-1214` | `dsh-host-webserver/lib/types/index.d.ts:30-39`、`lib/index.js:177-184/322-332`；整文件与 0.1.6 仅差一行 gzip 过滤 |
| `connection.requestRejection(req)` → 401/403/undefined | `lib/index.js:1224` | `dsh-client-connection/lib/index.js:586-589`（新增的 `admit()` 是附加） |
| 外部插件仍不能调 `rpc.handle()` | 故自持路由 | 子审计实测复现 `cannot get property "webServer" without inject` —— `COMPAT.md` §2 依然成立且必要 |
| Connection 信封（请求/成功/失败） | `lib/index.js:743-760` | 宿主 schema `dsh-client-connection/lib/index.js:484-517`、浏览器解析 `lib/client.js:1288-1313`；插件的四种形状 **全部 PASS** |
| 客户端 `connection.rpc.call(channel, endpoint, payload, signal)` | `lib/client.js:1080` | `dsh-client-connection/lib/client.js:1212-1232`、`lib/types/rpc.d.ts:209-218` |
| `__ModuleLoader__.load({id,factory})` + `dsh.client{platform,inject?}` | `lib/client.js:21-23`、`package.json` | `dsh-client-modules/lib/client.js:61-75/603-608/636-654`、`lib/index.js:395-404/713-724`；id = 包名，实测启动图一致 |
| 两处座位 `shell.overlay` / `conversation.input.dock`（list，scope root/session） | `lib/client.js:2732-2753` | `dsh-client-ui-layout` AppFrame、`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:214-218` |
| 座位标准 props `useSessions` / `sessionId` + `inject(sessionId)` | `lib/client.js:2750`、`:1797/2624` | `dsh-client-ui-session/lib/types/client/index.d.ts:67-92`、`dsh-client-ui-slots/lib/types/index.d.ts:483` |
| `slots.inject(seat, () => slots.register({name,id,order,locale,inject}, C))` | 同上 | 与宿主自带包写法逐字一致，如 `dsh-client-ui-jobs/lib/client.js:606-613` |
| `SessionListState` | 只读 `byId[sessionId].cwd` / `.retainedBy` / `.projectionValues` | 字段仍是 `{ids,byId,phase,projectionsBySession}`（`subagentsByParent`/`jobsBySession` 已删，**插件没用到**）；`SessionSummary` 仍有 `cwd?/retainedBy/projectionValues`（`dsh-api-session-controller/lib/types/client/sessions/service.d.ts:16-52`） |
| `modelSelection` 投影 | `lib/client.js:1831` | 仍是 `{lastUsed, next}`（`dsh-api-session-controller/lib/types/types.d.ts:104`），**无改名** |
| `ctx.locale.register(ns, {zh,en})` | `lib/client.js:2727` | `dsh-client-locale/lib/types/client/index.d.ts:199`；宿主包同形调用 |
| 17 个 `--dsw-alias-*` 主题 token | `lib/client.js` 全文件 | 全部能在 0.1.7-alpha.1 theme 的 CSS 里找到定义（0 缺失） |
| React seed 版本 | 规避 `useSyncExternalStore` | shell 仍是 `18.3.1-next-f1338f8080-20240426`（`dsh-web-frontend/dist/assets/*.js`，与 0.1.6-alpha.1 的 seed 列表逐项相同）——但见 §2.4 C6：渲染器给标准 hook 用的就是 uSES |
| 渲染器标准 hook 合成（`useSessions` / `sessionId` / `t`） | 座位 props 来源 | `dsh-client-ui-renderer/lib/client.js` 的 `useSyncExternalStoreWithSelector`（`:69/92/159`）、`slots.inject` 与 scope props 合成（`:418-420/646-681`）；**用真 `SlotCore` + 真渲染器跑的 Node 集成 harness 已通过**：两个条目注册、渲染出 `panel`/`dock`、无 `data-slot-error` |
| `ctx.llm`（listProviders/listModels/stream）与 `GenerateOptions`/`StreamChunk`/`FinishReason` | `lib/index.js:1011-1085` | `dsh-llm/lib/types/types.d.ts:132-152/406-436/466-506`；无会话请求会被所有 `llm/stream` 监听器放行（`dsh-agent-loop/lib/invariant.js:16`、`dsh-session-checkpoint-policy/lib/index.js:61-65`、`dsh-session-title/lib/index.js:418`） |
| `dsh.bundle.patch` + `insert(id,name)` | `cordis.patch.yml` | `dsh-app-boot/lib/index.js:300-303`；隔离实例真实加载了该行 |

---

## 4. 未覆盖 / 局限

- **AI 起草只做到"真实 HTTP 端到端到 provider"**：复现了失败，没有做一次成功的草稿生成（会真实消耗额度）。
  修完 §2.1 后应在本机实测一次。
- **没在真实 GUI 里点一遍「AI 起草」按钮**：浏览器验证覆盖了座位挂载、RPC、diff 流程；按钮点击路径
  （`state.sessionId` → 端点）是靠代码走查确认的。
- **没有 0.1.7-alpha.1 的源码**（只有编译产物 + `.d.ts`），宿主行为按编译后的 JS 判读；
  "无变化"一律指 **0.1.6-alpha.2 → 0.1.7-alpha.1 之间无变化**，其间的中间 alpha 不可见。
- **`test/ui/*.mjs` 的完整回归没跑通**：fixture 模式要求被绑定仓库有未暂存改动，而本仓库干净
  （我造的探针文件又被全局 `*.gitignore` 忽略）。座位挂载结论来自探针实测，见 §1.4。
- 宿主半 F2/F4–F8 与浏览器半 C1–C6 来自两次**独立子审计**（证据均为已安装树的 `file:line`）；
  我独立复核了 F1、信封 schema、0.1.6/0.1.7 差异、`dsh-llm-pi-ai:1881`，以及 C1/C2/C4/C6。F6/F7/F8 与 C3/C5 未逐条复跑。
  浏览器半的子审计**没有做真浏览器运行**（它只做静态核对 + Node 里的真渲染器 harness）；真浏览器观测由我在 §1.4 补上，两者结论一致。
- **像素级几何没有量**：面板 `bottom: 168`（§2.4 C5）与胶囊在真实输入框下的对齐，只读了 CSS 与常量，没有在真浏览器里量；
  §1.4 那次 UI 回归在"变更行"处提前退出（工作区干净），所以缩放/复位那几条断言这次没跑到。

---

## 5. 建议动作（按优先级）

1. **修 AI 起草的会话身份**（§2.1）：客户端带 `sessionId` → 端点参数 → `GenerateOptions.sessionId`；改完请本机实点一次。
2. **修一次性消息形状**（§2.2）：`generationMessage` 去掉 `id`/`source`，同步改 `test/generate.mjs`。
3. **给 `describeGenerate` 补 `llm-failed` 等未知码的兜底措辞**（面板现在会把 provider 的原始英文错误直接铺出来）。
4. **补一个"真 SlotCore"的门禁**（§2.4 C4）：这是唯一能挡住"座位消失 / props 改名 / `register()` 选项变化"这类静默断裂的守护；
   子审计已经跑通这套 harness，照搬即可（不要塞进 `test:diff`/`test:commit`）。
5. **把 F7 的信封校验加进 `test/host-mount.mjs`**：这是唯一能挡住"信封被宿主收紧"的守护。
6. **`COMPAT.md` 增补一节 0.1.7-alpha.1**：记录 ①`SessionListState` 现为 `{ids,byId,phase,projectionsBySession}`（§1 记的两个字段已删），
   ②RPC 目标文档相对化与根挂载假设，③`llm` 非必需启动项的静默风险，④`--dsh-composer-card-max-width` 属于内部耦合，
   ⑤profile 悬空 junction 普查数字。
7. **顺手清注释**：§2.4 C6 的 `useSyncExternalStore` 理由、§2.3 F8 的 `IncomingMessage` 理由、§2.3 F5 的"loud"措辞。
8. **清理 profile 的悬空 junction**（§2.5），让下一次换版取证更快。

---

## 6. 修复记录（2026-09-22 当天完成并验证）

所有改动都跑过门禁：`npm test`（smoke → host-mount → **slot-mount** → generate → render）、
`npm run test:diff`、`npm run test:commit` **全绿**。

### 6.1 已修（含验证证据）

| 条目 | 改动 | 验证 |
| --- | --- | --- |
| §2.1 AI 起草缺会话身份 | 面板把 `state.sessionId` 交给 `generateMessage`（`lib/client.js` 的 verb + `doGenerate`）；端点新增可选 `sessionId`（非空、≤200 字符，否则 `invalid-session`）；透传为 `GenerateOptions.sessionId` | 真宿主实测：命中死路由时报错详情会带 `provider`/`model`；**可用路由上生成了真实草稿**（`Bump Apache Tika from 3.2.3 to 4.0.0`）。`test/generate.mjs`（转发 + 缺省）、`test/render.mjs`（verb 载荷）、`test/smoke.mjs`（`invalid-session` 矩阵）守护 |
| §2.2 废弃的 `source.kind="plugin"` | `generationMessage()` 改成宿主的 `RequestUserInput` 形状（无 `id`、无 `source`），并删掉不再使用的 `randomUUID` 导入 | `test/generate.mjs` 新增三条断言（无 id / 无 source / 键集恰为 `content,role`） |
| 起草失败不可读 | 未识别失败码先给本地化短句；宿主在 `details` 里带上 `provider`/`model`，面板用新增的 `generate.failedDetail` / `generate.failedRoute` 文案把出问题的路由一并说出来 | 真宿主实测失败详情含 `"provider":"opencode-go","model":"deepseek-v4-flash"` |
| F3 `req.url` 解析 | origin-form 目标保持原样（仍严格拒 `..`），仅对 absolute-form 做 URL 解析 | `test/smoke.mjs` 的遍历路径 404 断言（这条在改造中被打红过，说明它确实在守） |
| F7 守护缺口 | `test/host-mount.mjs` 现在用**宿主自己的 zod schema** 校验四种信封（client-request / 失败 / unknown-endpoint / 404），并用真路由处理器驱动 | 已做**反证**：把信封 `type` 改成 `bogus-response` 后立刻变红，改回后文件哈希逐字节复原 |
| C1 投影字段 | 抽出纯函数 `sessionModelRoute()`，先读行上的 `projectionValues`、再读快照的 `projectionsBySession[id].values` | `test/render.mjs` 新增六个断言（两面、`next` 优先、缺省 null） |
| C2 胶囊对齐 | 改用 `max-width: var(--dsh-composer-card-max-width, 778px)` + `margin: 2px auto`（内置 QueueDock 同款），不再手算 `padding-left` | 真浏览器量得 `maxWidth=774.4px`、`paddingLeft=0`、**行左边缘与按钮左边缘同为 469px** |
| C3 `dsh.client.inject` | 补上 renderer / connection / ui-session，共 6 条 | 真宿主启动图里该行 `inject` 已是 6 项 |
| C4 门禁瞎区 | **新增 `test/slot-mount.mjs`**：真 `SlotCore`/`SlotRegistry` + 真渲染器 + 真 Cordis，把两个座位挂起来渲染（23 项断言，含 `title === cwd`、无 `data-slot-error`）；找不到宿主包时 SKIP 退 0；已接入 `npm test` | 通过；两条反证（夹具改 `retainedBy:{gateway:1}`、座位名改 `…docs`）各让 8–9 项断言变红；SKIP 路径也验过 |
| C5 几何常量 | 在 `bottom: 168` 与 `DIFF_PANEL_HEIGHT` 处写清"这是量出来的、不是契约"及重测方法 | 注释类，无行为变化 |
| C6 uSES 理由 | 改成真实理由（渲染器自己的标准 hook 就在用 uSES），并同步 `AGENTS.md` §4 | 注释类 |
| F8 `IncomingMessage` 理由 | 改成"刻意少依赖一种 IncomingMessage 行为" | 注释类 |
| F5 围栏 guard "loud" 措辞 | 改为"对操作者只有 stderr 一行"（保留 throw 本身） | 注释类 |
| §2.3/§2.4 其余条目 | 全部写进 `COMPAT.md` 新的 §4（0.1.7-alpha.1 小节，含 F2/F4/F6/C1/C2/C5 与悬空 junction 普查数字）；`README.md` / `README.en.md` 的端点表与说明同步 | 文档 |

### 6.2 **修不了的那一个**：`opencode-go` 这条路由在本栈里是死的

修完 §2.1 之后我在真宿主里做了完整对照，结论必须写清楚：

- 该实例注册的 provider 只有四个：`opencode-go`、`opencode-go-zdy`、`commandcode-goat`、`deepseek-official`
  （`POST /api/llm/listProviders` 实测；**没有** `commandcode`，所以早先"指定 commandcode"的探测其实是落回第一条路由）。
- **可用**：`commandcode-goat` + `deepseek/deepseek-v4.1-flash`、`deepseek-official` + `deepseek-v4-flash`
  → 都返回了真实提交信息。
- **不可用**：`opencode-go` + 任一模型 → 恒定 `400 MissingSessionID … x-opencode-session`；
  `opencode-go-zdy` → `403 An active OpenCode Go subscription is required`。
- 根因不在本插件：该网关要 `x-opencode-session` 头，而 **pi-ai 只在 `anthropic-messages`（`x-session-affinity`）
  与 `mistral`（`x-affinity`）里实现会话亲和头，`openai-completions` 路径根本不发**；
  `dsh-llm-pi-ai` 又把 `sendSessionAffinityHeaders` 标成 `"withhold"`（provider 配置不允许开启，
  见其 `COMPAT_GATES`），而 `opencode-go` 的模型在 pi-ai 目录里正是 `api: "openai-completions"`
  （`baseUrl: https://opencode.ai/zen/go/v1`）。**任何调用方（含主循环）都拿不到那个头。**
- 因此：**AI 起草要用能跑的路由**（把默认模型换成 `deepseek-official` 或 `commandcode-goat`），
  或者让那条 opencode 路由不再要求该头。插件侧能做的两件事都做了：把会话身份传下去（对将来会转发它的适配器有效）
  ＋把失败的 provider/model 明确显示出来。

### 6.3 没做的事

- **没有 bump 版本、没有打 tag**：发布是独立决策（`AGENTS.md` §7）。当前仍是 `0.6.0`，改动未提交。
- **没有重启用户正在用的 `dsh web`（3080）**：宿主半的改动要等用户自己重启才在那个实例生效；
  以上所有真宿主验证都跑在另起的隔离实例上（用完即杀）。
- **profile 的 17 个悬空 junction 没动**（§2.5）：那是用户的安装目录，且清理不该在线做。
