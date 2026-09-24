# 兼容性审计：`@xia-sc/dsh-git` 0.7.0 × dsh 0.1.7-rc.1

审计日期：2026-09-24 · 被审代码：`E:\dsh\plugin\dsh-git` @ `v0.7.0`（起始工作区干净，`9b0ede3`）

上一轮同类审计见 `AUDIT-0.1.7-alpha.1.md`（0.6.0 × 0.1.7-alpha.1）。本文件是**一次性审计报告**，不是维护文档。

## 结论

**无阻断性问题，无静默失效，不需要为换版改代码。** 与上一轮不同的是，这次连上一轮**没能跑通的那一段**
（真 GUI 的完整回归 + 已认证的真实端点）也实测通过了。

| 面 | 结论 |
| --- | --- |
| 宿主半挂载与围栏 | 真 rc.1 上挂载成功；**已认证下 `status`/`log`/`branches`/`diff` 全部 200 且数据正确**，无 cookie 仍 401 |
| 浏览器半 | 在 rc.1 的 `__DSH_BOOT__` 里（`application` 批）；**送达字节与 `lib/client.js` 逐字节相同** |
| 真浏览器 | fixture 模式与 live 模式**都通过**；两个座位挂载、面板展开、diff 渲染、两侧切换、拖拽缩放、收起 |
| AI 起草链路 | `GenerateOptions`/`RequestUserInput`/`StreamChunk`/`FinishReasonMap`/`sessionId` 转发逐项吻合 |
| 门禁 | `npm test`、`test:diff`、`test:commit` 全绿 |

发现 **3 条观察**（2 条低风险视觉项 + 1 条**既有**的 UX 局限，均非换版回归）、**6 条过程性建议**
（其中 2 条本轮已直接修掉：测试守护会静默退化、UI 回归的 live 模式被夹具绑死）。

---

## 一、环境（先钉死"审的到底是哪份代码"）

| 项 | 事实 | 取证 |
| --- | --- | --- |
| 运行中的 `dsh web` | PID 39184，`D:\software\nodejs\node_modules\@deepseek-ai\dsh\lib\bin.js web`，`127.0.0.1:3080` | 进程命令行 |
| dsh CLI 版本 | `0.1.7-rc.1` | 该 CLI 的 `package.json` |
| 第二份 CLI 树 | 同为 `0.1.7-rc.1` | `D:\software\nvm\nvm\v26.9.0\node_modules\@deepseek-ai\dsh\package.json` |
| profile 的宿主包 | **241 项，全部是 junction，无一悬空**，指向 nvm 树的嵌套 vendor 目录 | 逐个 `Test-Path` 可解析 |
| 宿主包权威树 | **276 个包**，全 0.1.7-rc.1，含 `cordis@4.0.4` | `…\nvm\v26.9.0\…\dsh\node_modules\@deepseek-ai\` |
| 第二份同版本 vendor 树 | 276 个包，同为 0.1.7-rc.1 | `D:\software\nodejs\…\dsh\node_modules\@deepseek-ai\` |
| 插件行 | `profiles\web\node_modules\@xia-sc\dsh-git` 是指向本仓库的符号链接；`dsh.profile.bundles` 里排在 `@deepseek-ai/dsh-web-app` 之后 | 符号链接目标 + profile 清单 |

**取证陷阱（踩过）**：`profiles/web/node_modules/@deepseek-ai` 是**空目录**；profile 下的条目全是 junction，
而 `glob`/`grep` **不跟随 junction**，会给出"文件不存在"的**假结论**——我据此一度误判
`dsh-client-ui-slots` 已从 rc.1 消失。正解：它只是不再有 profile 顶层链接，真包在 CLI 的嵌套依赖里
（`…\dsh\node_modules\@deepseek-ai\dsh-client-ui-slots`，0.1.7-rc.1，它的 `package.json` 没有 `dsh` 字段，
所以本来就不是独立客户端入口）；其运行时实例由 web 壳内联进模块表 seed。`test/slot-mount.mjs` 的
`addVendoredRoots()`（`:157-168`）就是为此兜底。取证一律走真实路径。

---

## 二、宿主半（`lib/index.js`）

| 契约 | 结论 | 证据 |
| --- | --- | --- |
| `webServer.register({kind:"prefix", path, handler})` | **一致** | `dsh-host-webserver/lib/index.js:177-179` 按 `kind` 分表、`:322-329` 前缀匹配；同款用法见 `dsh-client-connection/lib/index.js:643-656` |
| rc.1 的 `WebRoute` **没有 `method` 字段** | **无影响** | `dsh-host-webserver/lib/types/index.d.ts:30-39` 只有 `{kind,path,handler}`；插件只传这三项，自己判 `req.method !== "POST"`（`lib/index.js:1326-1331`） |
| `connection.requestRejection(req)` 围栏 | **一致且生效** | 类型是 `401 \| 403 \| undefined`（`dsh-client-connection/lib/types/rpc.d.ts:81-82`；实现 `lib/index.js:586-589`）。插件 `res.statusCode = rejection`（`:1322`）按 number 用正是对的——**潜在耦合**：若宿主改成返回字符串，这里会静默写出非法状态码。活体见 §四 |
| Connection RPC 信封（手写） | **通过宿主自己的 zod schema** | `test/host-mount.mjs` import 宿主的 `clientRequestSchema`/`serverResponseSchema` 校验，rc.1 上全过（含 `details.code`、unknown-endpoint、通道外 404） |
| 浏览器侧是**手写**校验（不是 schema） | **满足** | `dsh-client-connection/lib/client.js:1288-1313` 要求 `isRecord(error.details)`；插件 `fail()`（`lib/index.js:126-133`）恒给对象，7 处 `rpcError(...)` 调用点全部传 `{}` 或对象 |
| 请求目标解析 | **一致** | 客户端发 `` `${channel}/${endpoint}`.slice(1) ``（`lib/client.js:1221`，文档相对）；根挂载下等价（COMPAT §4.4 假设不变） |
| 通道名合法性 | **合法** | `CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/`（`:1201`）接受 `/dsh-git-rpc`；端点段模式与插件 `RPC_SEGMENT` 同构 |
| 清单 `dsh.bundle.patch` / `dsh.client` | **仍是受支持声明** | `dsh-client-modules/lib/index.js:57-73` 解析 `platform`/`inject`/`external`/`immediately`；`clientExportOf()`（`:171-181`）接受 `exports["./client"] = {default:"…"}`——正是本插件的写法 |
| `dsh.client.inject` 的**真实语义** | **不是服务注入** | `dsh-package-manifest/lib/types/types.d.ts:79-80` 明写 *"Informational package-name dependencies, not Cordis service injection"*；未命中的包名被**静默跳过**（`dsh-client-modules/lib/client.js:656-659`）。所以这 6 项不是风险面——真正的静默失效路径是客户端自己导出的运行时 `inject`（服务名 `slots`/`connection`/`locale`），三者 rc.1 都在 |
| 6 个 inject 包是否都存在 | **都在** | 逐个核对 `@deepseek-ai/dsh-client-{connection,locale}` 与 `dsh-client-ui-{conversation,layout,renderer,session}`：`platform === "web"`、`exports["./client"]` 有 `default`、`lib/client.js` 存在 |
| `connection.rpc.handle()` 对外部插件 | **仍不可用** | 实测仍抛 `cannot get property "webServer" without inject`（`dsh-client-connection/lib/index.js:798` `inject = ["credentials"]`、`:820` 内层 `ctx.inject(["webServer"], …)`）。**COMPAT §2 的自持路由设计仍然必需** |
| `llm` 是否必需启动项 | **仍不是** | `dsh-app-boot` 的 `requiredStartupEntryIds` 不含 `llm`；它起不来时本行一直 PENDING → 胶囊与面板**一起静默消失**而 `dsh web` 正常（COMPAT §4.5 继续成立，排查先看 stderr） |
| Cordis 契约 | **一致** | `cordis@4.0.4` 满足 `^4.0.1`；`inject` 数组语义与 `{name,inject,apply}` 对象插件形状未变（`cordis/lib/index.js:1491-1499`、`:1533-1538`）；`ctx.effect(fn,label)` 仍在 |

### LLM 起草链路（0.7.0 的新功能，逐字段核对）

| 契约 | 结论 | 证据 |
| --- | --- | --- |
| `GenerateOptions` 的 `provider`/`model`/`messages`/`system`/`maxTokens`/`signal`/`sessionId` | **逐字一致** | `dsh-llm/lib/types/types.d.ts:466-506` |
| 一次性消息**无 `id`/`source`** | **约束仍在** | `RequestUserInput { role:"user", content, id?: never, source?: never }`（`:457-462`）、`RequestMessage = Message \| RequestUserInput`（`:464`）；插件 `generationMessage()` 正好是这形状 |
| 流分片 `text-delta`/`block-end`/`finish` | **一致** | `StreamChunk`（`:406-436`）；插件取 `chunk.text` 与 `chunk.block.text` |
| `reason.kind` 与 `failure` | **一致** | `FinishReasonMap`（`:132-152`）：`stop`/`tool-calls`/`max-tokens`/`aborted`/`error`，后两者带 `failure` |
| 服务方法 | **都在** | `LlmRuntime.listProviders()`（`dsh-llm/lib/types/index.d.ts:269`，项带 `id`）、`listModels(provider)`（`:346`）、`stream(options)`（`:408`） |
| `sessionId` 真被适配器转发 | **是** | `dsh-llm-pi-ai/lib/index.js:1881` `…options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) }`；`dsh-llm-deepseek` 亦有（`:1923`/`:1940`）。COMPAT §4.2 成立 |
| `system` 与无 `source` 的 user 消息 | **被正确消费** | `system` 被两个适配器读取（pi-ai `:1241-1242`、deepseek `:1448`）；一次性消息只读 `role`+`content`（pi-ai `:1291-1302`），宿主里读 `message.source` 的位置都是 assistant-only |
| 同款一次性调用的既有先例 | **有** | 宿主自己就这么调：`dsh-session-title-llm/lib/index.js:197-215`、`:226` |

---

## 三、浏览器半（`lib/client.js`）

| 契约 | 结论 | 证据 |
| --- | --- | --- |
| `window.__ModuleLoader__.load({id, factory})` | **一致** | rc.1 里 **67** 个客户端 bundle 用同一协议；工厂签名 `factory: (require) => {…}`。插件 `lib/client.js:21-22` 注册 id `@xia-sc/dsh-git`，与 boot 图条目名一致 |
| 模块表的**保证面** | **仍只有 seed words** | 壳的 `staticModules` 是 9 个（`react`/`react/jsx-runtime`/`react-dom`/`react-dom/client`/`cordis`/`dsh-client-store`/`dsh-client-ui-slots`/`dsh-client-ui-primitives`/`dsh-client-ui-dockkit`）；rc.1 的 `require` 还能解析"已注册的其它 bundle id"，但那是便利不是契约。插件只用 `react`（`lib/client.js:28` 是全文件唯一一次 require），这条自设约束依旧成立且更保守 |
| 座位 `shell.overlay`(list/root)、`conversation.input.dock`(list/session) | **一致** | `dsh-client-ui-layout/lib/client.js:628-631`；`dsh-client-ui-conversation/lib/client.js:17800-17803`。`test/slot-mount.mjs` 在真 `SlotRegistry@0.1.7-rc.1` + 真 Cordis 上 23 项断言全过（id/order 10/20、scope 未翻转、无 `data-slot-error`） |
| 注册选项形状 `{name,id,order,locale,inject}` | **一致** | `dsh-client-ui-slots/lib/index.js:181-217`（list 槽要求 `id`，并接受 `order`/`label`/`priority`/`inject`/`locale`） |
| 座位选项 `locale` → `t` prop | **一致** | renderer `lib/client.js:721-724` `kit["t"] = localeSeat(face, entry.locale)`；`localeSeat` 内 `face.bind(ns)`（`:531`） |
| `ctx.locale.register(NS,{zh,en})` 两参形式 | **仍支持** | `dsh-client-locale/lib/client.js:1385-1394`；locale id 走 BCP 47 校验，`zh`/`en` 通过 |
| `t(key, params)` 的 `{name}` 插值 | **一致** | `translate()`（`:1421-1426`）；`bind(ns)` 返回的正是 `(key, params)` |
| 会话作用域下发的 props | **一致** | rc.1 会话座位 = 全局 `useSessions`/`useSessionStatus`/`useSessionRetainInfo` + `sessionId`/`useSession`/`useProjection` + 自身 inject + owner 共享 + 合成 `t`；插件只依赖 `sessionId`/`useSessions`/`t`，三项都在 |
| 快照 `byId[id]` 的 `cwd`/`retainedBy`/`projectionValues` | **逐字一致** | `dsh-api-session-controller/lib/client.js:3503-3515` 的 `projectList()` |
| `projectionsBySession[id].values` | **一致** | 同上 `:2965-2970`：`[sessionId, { values, state, error }]` |
| `values.modelSelection` 内层形状 | **一致** | `…/lib/types/model-selection-projection.js:43,49`：`view: state => ({lastUsed, next: state.pending ?? state.lastUsed})`；`ModelSelection {provider, model, reasoningEffort?}`（`…/types/types.d.ts:91-109`）。插件取 `next \|\| lastUsed` 再读 `.provider/.model` |
| `retainedBy.mainView` 这个保留源名 | **未改名** | **宿主自己也这么写**：`dsh-client-ui-session/lib/client.js:283`、`:340` 均为 `(…retainedBy.mainView ?? 0) > 0`，与插件 `lib/client.js:3082-3084` 同构；实际 retain 点是 `dsh-client-ui-workspace/lib/client.js:1019` |
| 会话绑定归会话作用域座位 | **结构未变** | 根作用域仍取不到当前会话（COMPAT §1 的修法继续有效） |
| zh/en 字典 | **对齐** | 各 115 键、完全对齐；75 个 `t("…")` 静态键两边全部命中 |

**这道绿灯不是空转（反证已跑）。** `DSH_GIT_SLOT_FIXTURE=embedded node test/slot-mount.mjs` 在 rc.1 上
**失败 9 项**（exit 1：胶囊与面板都不渲染、store 不绑定、不读 `/dsh-git-rpc`），默认夹具全过（exit 0）。

---

## 四、活体取证（对**正在运行**的 3080，用其一次性 token 认证，全程未重启）

### 4.1 启动图里有本插件，且 rev 与本地文件一致

`GET /`（带 token 换到的 cookie）里的 `window.__DSH_BOOT__`：`rev = 884b4972ccf0`，68 个 entry、3 个 batch。

```json
{"id":"@xia-sc/dsh-git",
 "url":"plugins/??@xia-sc/dsh-git/client.js&rev=d1947b10b238",
 "rev":"d1947b10b238",
 "inject":["@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-locale",
           "@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-layout",
           "@deepseek-ai/dsh-client-ui-renderer","@deepseek-ai/dsh-client-ui-session"]}
```

它落在 **`application` 批**的组合 URL 里（在 `dsh-update-notifier` 与 `@xia-sc/dsh-cc-studio` 之间）。
`rev` 与我按宿主 `artifactRevision()`（`dsh-client-modules/lib/index.js:193-199`，mtime/ctime/size 的
framed sha1）复算 `lib/client.js` 得到的值**完全相同**（`d1947b10b238`）。

### 4.2 送达字节 = 仓库源码

`GET /plugins/??@xia-sc/dsh-git/client.js&rev=d1947b10b238` → 200；返回体前 `130680` 字节与
`lib/client.js` `Buffer.compare === 0`，仅多 **72 字节**尾巴：

```
;\n//# sourceMappingURL=??@xia-sc/dsh-git/client.js.map&rev=d1947b10b238\n
```

### 4.3 宿主半在真 rc.1 上应答（**已认证**，本次新证）

| 探针 | 结果 |
| --- | --- |
| `POST /dsh-git-rpc/status`（cwd = 本仓库） | **200**，`ok:true`，`branch:"master"`、`oid:"9b0ede39…"`、`upstream:"origin/master"`、`dirty:3`，且 `changes` **正好**是本次审计造成的三个改动（`COMPAT.md` / `test/slot-mount.mjs` 已修改、`AUDIT-0.1.7-rc.1.md` 未跟踪） |
| 同上，`cwd` 传相对路径 | **200** + 带内失败：`{ok:false,error:{code:"internal",message:"a valid absolute working directory is required",details:{code:"invalid-cwd"}}}` —— 正是 AGENTS §3.6 的"人类可读 message + `details.code`"约定，也实测了浏览器要求的 record 型 `details` |
| `log` / `branches` | **200**，列出真实提交（`9b0ede3` …）与 `current:"master"`、1 个本地分支 |
| `diff`（`COMPAT.md`） | **200**，`worktree` 4890 字符、`index` **0** 字符 —— **只读端点确实只读**，未动 index 与工作区 |
| 同一请求**不带 cookie** | **401**；对照未知路径 `GET` → **404**、`POST` → **405**，`/api` → **401** —— 401 是**路由级**的，不是全局兜底 |

---

## 五、真浏览器回归（playwright-core 1.63.0 + 本机 Chrome，无头）

上一轮 alpha.1 审计**没跑通这一段**（fixture 模式要求被绑定仓库有未暂存改动，而当时工作区干净、
临时探针又被全局 `*.gitignore` 忽略，见 `AUDIT-0.1.7-alpha.1.md` §4）。这次工作区带着本次改动，跑全了。

| 模式 | 结果 |
| --- | --- |
| `node test/ui/verify-diff.mjs`（fixture 拦截） | **PASS** —— `DIFF UI VERIFIED (two panes, parsed rows, side switch, right-edge resize, fold-back, fixture endpoint)` |
| `DSH_GIT_UI_LIVE=1 node test/ui/verify-diff.mjs`（打真端点） | **PASS** —— 同上，尾注为 `live endpoint` |

覆盖到的：胶囊出现（会话作用域座位拿到 `sessionId` + `cwd`）、面板展开成单栏、变更行可点、
点开变两栏且面板变宽、右边缘就是缩放手柄、拖 120px 后面板与 diff 都正好窄 120px、双击复位、
换行开关、点活动行收回单栏、**无 `pageerror`**。

### 5.1 渲染是否忠实于真 diff（本次额外做的交叉核对）

live 模式下另用临时探针把"面板画出来的行数"与"真端点返回的原始 diff"对齐：

| 文件 | 面板渲染 `add/del/hunk/fileHeader/noNewline` | 按插件自身规则数原始 diff | 一致 |
| --- | --- | --- | --- |
| `dsh-cc-studio/AGENTS.md` | 14 / 11 / 6 / 4 / 0 | 14 / 11 / 6 / 4 / 0 | **是** |

（`fileHeader` 我一开始数成 3，因为漏了插件真正的 `DIFF_FILE_HEADER` 还包含 `index ` 等 11 类行，
见 `lib/client.js:1740`——**是我的复刻错了，插件没错**。）

---

## 六、主题与几何

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 插件引用的 17 个主题 token（16 个 `--dsw-alias-*` + `--dsw-shadow-lv2`） | **全部存在** | 逐个命中 `dsh-client-ui-theme` 的定义（`lib/client.js:1148`/`:1154`，亮/暗各一条）；插件侧 100+ 处 `var()` **全部带 fallback**，无裸用 |
| AGENTS §4 点名过的三个"不存在的 token" | **已清干净** | rc.1 别名表里没有 `surface-tertiary`/`separator-primary`/`label-quaternary`；theme bundle 里 `separator`/`quaternary` 各 0 命中，`surface` 的命中全是英文注释 |
| token 改名风险 | **不存在** | 对照 0.1.6-alpha.1：别名总表 79 → 90，**只增不改**，11 个新增与插件使用面无关 |
| `--dsh-composer-card-max-width` | **仍定义** | `dsh-client-ui-conversation/lib/client.js:15666`：`calc(var(--dsh-chat-content-width) + 32px)`，真实区间 **712–952px**。插件走 `var()` 自动跟随；**但兜底的 `778px` 只是区间内的一个值，不是真值** |
| 面板几何常量 | **仍是实测值**（无公开契约） | 宽度面自洽已复核：`box-sizing:border-box` + 1px×2 边框 ↔ `PANEL_BORDER_WIDTH=2` ↔ `300+2+diffWidth`；`maxWidth:100vw-24px` ↔ `PANEL_MARGIN=24` ↔ `clampDiffWidth`；`DIFF_LEFT_PANE_WIDTH=300` 与 `S.leftPane.width` 两个字面量一致。高度面见观察 3 |

---

## 七、发现

**观察 1（低，仅视觉）— 胶囊对齐公式落后于 rc.1 新增的 dock 内缩变量。**
rc.1 的 composer 新增 `--dsh-composer-dock-inset: 8px` 与 `--dsh-composer-side-clearance: 16px`；宿主的
dock 占用者（QueueDock，`dsh-client-ui-conversation/lib/client.js:15084`）用
`width: calc(100% - 2*clearance - 2*inset)` / `max-width: calc(card-max-width - 2*inset)`，
而胶囊只按 `max-width: var(--dsh-composer-card-max-width)` 对齐（`lib/client.js` 的 `dock-row`）。
**实测差**：比宿主宽 16px（窄列最多 32px）；与卡片间距 8px，宿主是 -3px 重叠。**无功能影响。**
顺带纠正 COMPAT §4.6 的一句：那里说胶囊是"内置 QueueDock 同款写法"，按 rc.1 的算式**不再准确**。

**观察 2（低，仅视觉）— 面板 `bottom`/固定高度是实测常量。** 输入框栈高度一变就要重量（COMPAT §4.6）。

**观察 3（中低，UX；**不是 rc.1 回归**，是既有设计局限）— 多行草稿时面板会盖住输入框。**
面板 `position: fixed; bottom: 168`（`lib/client.js:388`）是**静态**偏移，而宿主文本区上限
`--dsh-composer-text-max-height: 336px` 会让 composer 栈长到约 430px，于是空间上重叠；叠放关系也是面板赢
（`shell.overlay` 层 `z-index:20`，而 composer 座位规则里**没有** `z-index`，即 `auto`）。
`lib/client.js:381-382` 注释里 "never covers the input box" 只对空/单行草稿成立。
**168 与 30 都是插件自己的常量，历史版本同样如此**，本轮只是把它量化确认。
修法（让 `bottom` 跟随实测栈高、或把面板挂到宿主预留的 overlay 座位）**建议另行评估**。

**建议 1（测试覆盖）— `test/slot-mount.mjs` 的 locale 是桩。** rc.1 真实的
`locale.register`/`bind`/字典契约没被门禁覆盖，本次由人工核对补齐。换成真的 `dsh-client-locale` 面即可。

**建议 2（测试健壮性）— 已在本轮修掉。** `test/slot-mount.mjs` 把纯装饰性的
`dsh-client-ui-slots` **版本探测**和必需依赖放在同一个 `try` 里：解析不到就 `SKIP` + exit 0，
即"防静默失效的守护自己静默失效"（**改前已实测复现**：让 `locate()` 拒绝该 spec，旧代码打印 `SKIP: …`
并 exit 0）。现在解析不到只打印 `slots@?` 并继续，由 renderer 自己的 `require(...)` **响亮失败**
（改后实测 exit 1）；"没有 profile → SKIP" 契约不变（exit 0）。

**建议 3（测试缺陷）— 已在本轮修掉。** `test/ui/verify-diff.mjs` 的 **live 模式被夹具内容绑死**：
它把夹具独有的形状（两个 hunk、三处新增、`-- looks like a file header` 那行、恰好一个 no-newline 标记）
当成断言，于是 `DSH_GIT_UI_LIVE=1` **在任何普通工作树上必红**（本轮实测 3 项失败：首个变更行是
`COMPAT.md`，真实 diff 只有 1 处删除、没有那两个标记）。而 AGENTS §6 恰恰把 live 模式列为维护步骤。
现在内容形状断言只在 fixture 模式跑；两种模式都新增一条**内容无关**的一致性断言（头部的 `+N −M`
必须等于实际画出的行数）；换行三连在真 diff 没有超宽行时跳过并打印 NOTE；live 模式不再覆盖
`test/ui/diff-panel.png`（那是 fixture 的参考图）。反证：把夹具里那两行特征删掉后，fixture 模式仍报
3 项失败——断言没有被改空。

**建议 4（既有杂乱）— `test/ui/diff-panel.png` 与脚本不一致。** 仓库里那张是 **929×861**，
而脚本声明的 viewport 是 **1440×900**（`test/ui/verify-diff.mjs:72`），所以每次照 AGENTS §6 跑一次
fixture 回归都会把它换成一个完全不同尺寸的图（本次实测 `99389 → 139643` 字节）。它没有被 README 引用
（README 只引 `settings-popover.png`），更像历史遗留。**本次已把它 `git checkout` 还原**，没替它做决定。

**建议 5（文档）— `COMPAT.md` §4.7 的环境数字已过期**（现 241 项 junction、0 悬空、宿主包在 276 项的
嵌套树）。本轮已在 COMPAT 新增 §5.3 取代，并在 §4.7 标题挂了指路。

**建议 6（范围外，宿主行为）— `/plugins` 路由无需会话 cookie 即可取 bundle**（实测未认证也 200）。
与本插件无关（本插件的通道是 401 围栏的），仅作记录。

### 已核实并排除的疑点

- "`shell.overlay` 只对直接子元素放开 `pointer-events`，将来加一层 wrapper 会让面板点击穿透" ——
  **非问题**：`pointer-events` 是可继承属性，直接子元素被置为 `auto` 后其后代继承 `auto`；
  且插件自己就设了 `pointerEvents: "auto"`。
- "`@deepseek-ai/dsh-client-ui-slots` 在 rc.1 被删掉了" —— **误判**，见 §一。
- "面板盖住输入框是 rc.1 引入的" —— **不是**，是既有设计局限，见观察 3。
- "fileHeader 数不对（渲染 4、按规则算 3）" —— **我复刻错了**，插件的 `DIFF_FILE_HEADER` 更宽，见 §5.1。

---

## 八、未覆盖 / 局限

1. **AI 起草没有跑一次成功的真网关调用**（会消耗额度）。契约层已逐项核对（§二）；
   上一轮 alpha.1 审计已实测成功生成过一次真实草稿。
2. **像素级几何没有量**：`bottom:168` 与胶囊在真实输入框下的对齐只读了 CSS 常量与产物算式，
   没有在真浏览器里逐像素测量（观察 1、观察 3 的数值来自 CSS 算式，不是截图测量）。
3. **`test/render.mjs` 跑在插件自己的 `node_modules/react` 上**（打印 `react from (node resolution)`），
   不是壳 seed 的那份 React——COMPAT §4.7 已记，本次未变。
4. 宿主行为按**编译产物 + `.d.ts`** 判读（本机没有 rc.1 的源码树）；"无变化"指相对插件已兼容的
   0.1.7-alpha.1 无变化。
5. 观察 1 / 观察 3 **没有改代码**——前者纯视觉、后者是既有 UX 局限，都属于独立的行为变更，
   需要真 GUI 目视验收，不适合塞进"文档 + 测试"的改动。

---

## 九、复核命令（可原样重跑）

```powershell
cd E:\dsh\plugin\dsh-git
npm test                    # smoke → host-mount → slot-mount → generate → render（真 rc.1 宿主）
npm run test:diff           # 端到端 git：两侧/未跟踪/重命名/删除/二进制/截断
npm run test:commit         # 端到端 git：逐字节比对提交信息

# 真浏览器：把 <token> 换成 dsh web 启动时打印的那个
$env:DSH_GIT_UI_URL="http://127.0.0.1:3080/?token=<token>"
node test/ui/verify-diff.mjs                              # fixture 模式（客户端半）
$env:DSH_GIT_UI_LIVE="1"; node test/ui/verify-diff.mjs    # live 模式（整条链路）

# 活体：路由与围栏（预期 401；对照路径 GET 404 / POST 405）
$null = Invoke-WebRequest -Uri "http://127.0.0.1:3080/?token=<token>" -SessionVariable sess
Invoke-WebRequest -Uri "http://127.0.0.1:3080/dsh-git-rpc/status" -Method POST -ContentType application/json `
  -Headers @{Origin="http://127.0.0.1:3080"} -WebSession $sess -SkipHttpErrorCheck `
  -Body '{"type":"client-request","rpcId":"p","method":"status","payload":{"args":{"cwd":"E:/dsh/plugin/dsh-git"}}}'
```
