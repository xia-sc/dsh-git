# 兼容性审计：`@xia-sc/dsh-git` 0.7.0 × dsh desktop 0.2.0-rc.2

审计日期：2026-10-09 · 被审代码：`dsh-git` @ 0.7.0（工作区 `master` @ `72b02b2`）。**审计改动既有代码为零，只新增了本文件**（另有工作区权限修复留下的 `.acl-report/`，见文末）；文中所有本机路径已脱敏为 `%DSH_HOME%` / `<repo>` 这类占位符，截图因无法脱敏而未入库（§2.3）。

上一轮同类审计见 `AUDIT-0.1.7-rc.1.md`（0.7.0 × 0.1.7-rc.1）。本文件是**一次性审计报告**，不是维护文档。本轮首次覆盖 **desktop 版宿主**（0.2.0-rc.2 是 Electron 桌面发行版，宿主包结构与 web/CLI 版不同，见 §一）。

## 结论

**插件在 0.2.0-rc.2 上功能完好，无回归，不需要为换版改任何代码。** 宿主半的挂载与围栏、浏览器半的两个座位与完整 diff 交互、AI 起草的真网关链路、主题 token 与几何常量，全部在**真宿主 + 真浏览器 + 真网关**上实测通过。

真正需要动手的是**三处与本插件无关、但会让本插件"看起来坏了"的东西**：

| # | 问题 | 性质 | 严重度 |
| --- | --- | --- | --- |
| 1 | `test/host-mount.mjs` 与 `test/slot-mount.mjs` 在这台机器上**双双 SKIP**，两个换版守护**空转** | 守护失效（不是插件失效） | **高** |
| 2 | `test/ui/verify-diff.mjs` 在 desktop 0.2.0-rc.2 上**跑不完**（新预览弹层遮挡 + 工作区选择器改名） | 测试基建漂移 | 中 |
| 3 | `AGENTS.md` §8、`COMPAT.md` §0/§3/§4.7/§5.3 的环境事实**大面积过期**（端口、profile、宿主包位置） | 文档过期 | 中 |

另有 3 条低风险观察（`COMPAT.md` §4.5/§5.1 的症状描述与 0.2.0-rc.2 实际不符；`/dsh-git-rpc` 根路径的 404 容易被误读成"路由没挂"；空会话 hero 形态下面板会盖住输入框）。

| 面 | 结论 |
| --- | --- |
| 宿主半挂载与围栏 | 真 0.2.0-rc.2 上挂载成功、持有 `/dsh-git-rpc`；**已认证下 `status`/`log`/`branches`/`diff` 全部 200 且数据正确**，无 cookie 401、错 Origin 403、GET 405、未知端点 `unknown-endpoint` |
| 客户端分发 | `@xia-sc/dsh-git` 在 0.2.0-rc.2 的 `__DSH_BOOT__` 里（`application` 批，`entries[68]`，`rev=4c38468d8496`）；**rev 按装机文件的 mtime/ctime/size 复算一致**，送达字节与装机 `lib/client.js` 逐字节相同（+72B sourcemap 尾） |
| 真浏览器 | 胶囊、面板、单栏→两栏、diff 解析、两侧切换、宽度拖拽 ±120px、自动换行、收回**全部通过**，无 `pageerror`/console error |
| AI 起草链路 | 真网关实测 **200 / 1.96s / 英文提交信息**；`sessionId` 被转发且网关接受 |
| 主题与几何 | 插件用到的 **17 个 `--dsw-*` token 在 0.2.0-rc.2 全部有定义**；4 个 `--dsh-composer-*` 变量仍在，胶囊行宽实测 = 变量解析值 774px |
| composer 锚点（唯一硬编码） | 常规会话实测**重叠 0px**（composer 栈 738–900、面板底边 732）⇒ `bottom:168` 仍然精确；空会话 hero 形态下面板会盖住输入框（新记录的边界，§3.6） |
| 门禁 | `npm test` 全绿（但两个守护 SKIP，见 §三.1）、`test:diff`、`test:commit`、`test:ui:settings` 全绿 |

---

## 一、环境（先钉死"审的到底是哪份代码"）

| 项 | 事实 | 取证 |
| --- | --- | --- |
| 宿主版本 | 全部 `@deepseek-ai/*` = **0.2.0-rc.2**；`@deepseek-ai/cordis` = **4.0.4**（满足插件的 `^4.0.1`） | `runtime/primary-runtime/runtime.json` 的 `desktopVersion`；asar 内每个 `package.json` |
| 宿主进程 | `DeepSeek Harness.exe`（PID 47500）→ `app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js`，参数 `<app.asar>\dsh` + `%DSH_HOME%\profiles\desktop` | 进程命令行 |
| 活着的 profile | **`desktop`**（`DSH_PROFILE=desktop`），**不是 `web`**；bundles 含 `@xia-sc/dsh-git` → `^0.7.0`（**npm 安装副本，不是 `link:`**） | `profiles/desktop/package.json` |
| 真 GUI | `http://127.0.0.1:19387/`（`DSH_WEB_URL`）；**`3080` 已无监听** | `GET /` → 401（未认证）/ 200（认证后）；`Get-NetTCPConnection -LocalPort 3080` 空 |
| **宿主包的位置（本轮最大环境变化）** | 全部封在 **Electron 的 `app.asar` 内**：`app.asar\dsh\node_modules\@deepseek-ai\*`（约 300 个包） | `profiles/desktop/node_modules/@deepseek-ai` **只有 2 项**（`cordis`、`cosmokit`）；`profiles/node_modules/@deepseek-ai` 是**空目录**（0 项）；`profiles/web/node_modules/@deepseek-ai` 同样是空目录 |
| 装机副本 vs 仓库工作区 | **同一份代码**：`lib/client.js`（127448 / 130680 字节）、`lib/index.js`（61594 / 62982）、`cordis.patch.yml`（751 / 766）、`README.md`、`LICENSE` 的 **LF 归一后 sha256 完全相同**；原始差异 = 工作区 CRLF 行尾（3232 / 1388 / 15 行） | 归一哈希比对；`git diff --no-index` 因 autocrlf 归一后判定无差异 |
| asar 内没有 `.d.ts` | 类型层证据只能用宿主自己生成的 `dsh-tool-cordis/lib/types/api-catalog.js` 与 `dsh-llm/lib/typert.host.js` | 全树筛 `.d.ts` = 0 命中 |
| 本机 node | `D:\software\nodejs\node.exe` v26.9.0（跑测试用）；desktop runtime 自带 node 24.21.0 | `node --version`；`versions.json` |

**取证手法（可复核）**：宿主包用自写的 asar 读取器（8+headerSize 定位 dataOffset，递归 header JSON）提取非二进制部分后再读源码；活体 HTTP 用宿主自己的 `client-connection/browser-session` 签名密钥**自签一个合法会话 cookie**（等价于 `dsh web` 打印的 `?token=` 交换，`dsh-client-connection/lib/index.js:388-427` 的 `authorizeIndex`），因此本轮所有端点与浏览器探针都是**已认证**的真实链路。密钥与 cookie 值未落盘、未打印。

---

## 二、逐面实测

### 2.1 门禁（`npm test` + 两个端到端套件 + 设置弹层）

| 套件 | 结果 |
| --- | --- |
| `test/smoke.mjs` | 通过 |
| `test/host-mount.mjs` | **SKIP**（找不到 profile）→ 手工把宿主包提取到 `.audit/host` 并设 `DSH_GIT_DSH_ROOT` 后：**通过**，`mounted against @deepseek-ai/dsh-client-connection@0.2.0-rc.2`，信封过宿主自己的 zod schema |
| `test/slot-mount.mjs` | **SKIP**（同上）→ 手工指定后：**23 项全过**，`real SlotRegistry 0.2.0-rc.2` |
| `test/generate.mjs` | 通过 |
| `test/render.mjs` | 通过（react 从插件自己的 `node_modules` 解析，18.3.1） |
| `npm run test:diff` / `test:commit` | 通过（真 git，端到端） |
| `npm run test:ui:settings` | 通过（24 项，真 Chrome + 真 React DOM + 真 localStorage） |

### 2.2 宿主半（`lib/index.js`）

| 契约 | 结论 | 证据 |
| --- | --- | --- |
| `webServer.register(route)` 形状 | 一致 | `dsh-host-webserver/lib/index.js:177-184`（按 `kind` 分表、返回 disposer）、`:322-332`（`pathname !== prefix && !startsWith(prefix+"/")`，新增"最长前缀优先"）；**仍无 `method` 字段**，插件自己判 `req.method !== "POST"`（`lib/index.js:1326`） |
| 前缀路由真挂上了 | **是** | 活体：`POST /dsh-git-rpc/status` → 200 |
| `connection.requestRejection(req)` | 一致（仍是数字三态） | `dsh-client-connection/lib/index.js:586-589`；活体：无 cookie **401**、错 Origin **403**、`GET /dsh-git-rpc/status` **405** |
| Connection RPC 信封（插件手写） | 通过宿主自己的 schema | `test/host-mount.mjs`；`fail()` 恒给 `code:"internal"` + record 型 `details`（`lib/index.js:126-134`） |
| 端点与错误码 | 正确 | 活体 `status`/`log`/`branches`/`diff` 全 200 且数据正确；`cwd` 非绝对 → `error.code:"internal"` + `details.code:"invalid-cwd"`；未知端点 → `details.code:"unknown-endpoint"` |
| 外部插件调 `ctx.connection.rpc.handle()` | **仍不可用** | 实测仍抛 `cannot get property "webServer" without inject`（connection 插件 `inject=["credentials"]`，webServer 只在内层 `ctx.inject(["webServer"],…)` 可见）。**COMPAT §2 的自持路由设计仍然必需，不要改回去** |
| `llm` 是否必需启动项 | **仍不是** | `dsh-app-boot/lib/index.js:3836-3844` 的 `requiredStartupEntryIds` = `{agent-loop, webserver, modules, connection, headless-runner, acp, sdk-jsonrpc-server}`；非必需行挂载失败只 `process.stderr.write` 一行（`:4009-4019`）⇒ **静默失效路径仍在**，但症状描述要改，见 §三.4 |

### 2.3 浏览器半（`lib/client.js`）

**分发链**：`__DSH_BOOT__` 的 `entries[68]` = `{"id":"@xia-sc/dsh-git","url":"plugins/??@xia-sc/dsh-git/client.js&rev=4c38468d8496", …}`，落在 `batches[2]`（`application` 批）。按 `artifactRevision()`（`framedHash("plugin-artifact",[mtimeMs,ctimeMs,size])`，`dsh-client-modules/lib/index.js:193-199`）用**装机文件**的 `mtime=1791511820609.478 / ctime=1791511820617.3904 / size=127448` 复算 = **`4c38468d8496`，与 boot 图一致**；`GET /plugins/??@xia-sc/dsh-git/client.js&rev=…` 返回体前 127448 字节与装机 `lib/client.js` **逐字节相同**（尾部 72 字节是 sourcemap 注释）。

> 核对 rev 必须用**装机路径**那份：工作区副本因 CRLF 是 `23578ad7b30f`（size 130680）。

**真浏览器（真 GUI + 真 0.2.0-rc.2 座位）**：

| 检查 | 结果 |
| --- | --- |
| 胶囊存在并绑定会话 | `[data-dsh-git="dock"]` = `⎇ master`，`title="E:\dsh\plugin\dsh-cc-studio"`（会话 cwd 解析成功） |
| 面板打开/收起 | 通过，无 `data-slot-error`、无 `pageerror`、无 console error |
| 两栏几何 | `panel=862 = left 300 + border 2 + diff 560`（与 `DIFF_LEFT_PANE_WIDTH=300`、`PANEL_BORDER_WIDTH=2` 一致） |
| 两栏高度钉死 | `style.height === style.maxHeight === "min(72vh, calc(100vh - 184px))"`，实测 648px |
| diff 解析 | `+4 −2`、hunk 2、fileHeader 4、noNewline 1、`--` 开头的删除行被当作改动；**头部 `+N −M` 与实际画出的行数一致** |
| 两侧切换 | 未暂存 18 行 → 已暂存 8 行（真的重读另一侧） |
| 宽度手柄 | 右边缘拖 +120px → 面板 862→982（diff 侧同步 +120）；拖 −120px 复原 |
| 自动换行 | `overflowX 1949→0`、最长行高 `18→108px` |
| 主题 token | 插件用到的 **17 个**（16 个 `--dsw-alias-*` + `--dsw-shadow-lv2`）在 0.2.0-rc.2 的 `dsh-client-ui-theme` 里**全部有定义**（alias 亮/暗各一份） |
| composer 变量 | `--dsh-composer-card-max-width`、`-dock-inset`、`-side-clearance`、`-text-max-height`、`-stack-gap` 仍在（COMPAT §4.6/§5.2 的实测值结论不变） |
| React 订阅 | 渲染器的 `useSyncExternalStore` 仍**优先用 React 自带实现**（`dsh-client-ui-renderer/lib/client.js:69`）；插件用 `useState+useEffect`，不受影响 |
| 层叠上下文 | 面板是 `position:fixed` + **`z-index:30`**，落在宿主 `shell.overlay` 容器 `.overlayLayer{z-index:20}` 内；宿主 frame 无 `transform`，`fixed` 不被重定基（实测面板底边 = 视口底 − 168px） |

**截图未随仓库提交**：真 GUI 截图必然带上本机侧边栏的工作区名、会话标题与用量面板，裁剪也脱不干净，所以只在本机留底、不入库（同一原因，本轮也把 `test/ui/diff-panel.png` 还原成仓库里原有的那张）。

### 2.4 AI 起草（真网关）

用临时 git 仓库（`%TEMP%\dsh-git-audit-repo`，一次提交 + 一个已暂存的改动）直接打端点：

```
POST /dsh-git-rpc/generateMessage
args = { cwd, mode: "staged", sessionId: "<当前会话 id>", language: "English" }
→ 200 in 1956ms
→ {"ok":true,"value":{"message":"Add default punctuation and name validation to greet\n\n…",
                     "mode":"staged","provider":"commandcode","model":"deepseek/deepseek-v4.1-flash"}}
```

一次性验证了：`sessionId` 被面板带进请求并被网关接受（**COMPAT §4.2 的 `MissingSessionID` 风险在本机 provider 上不存在**）、一次性 `RequestUserInput`（无 `id`/`source`）被接受、流分片拼装正确、`language` 强制语言生效（输出英文）。契约逐字段核对另见 §四。

### 2.5 面板内的 AI 起草请求形状

在真 GUI 面板里点「✨ AI 生成」（夹具工作区干净）：请求为
`{method:"generateMessage", args:{cwd:"<会话的仓库路径>", mode:"staged", sessionId:"<会话 id>"}}`，
宿主如实回 `details.code:"no-changes"`，面板显示对应本地化短句 —— 面板→store→端点的整条链路正确。

---

## 三、本轮发现的漂移（**都不是插件的功能回归**）

### 3.1 【高】两个换版守护在这台机器上双双 SKIP，形同虚设

- **症状**：`npm test` 打印
  `SKIP: no installed DSH profile found …`（host-mount）与
  `SKIP: cannot resolve "@deepseek-ai/dsh-client-ui-renderer/client" — tried …profiles\web\node_modules, …profiles\node_modules, …`
  （slot-mount），两者都 **exit 0**。
- **根因**：两个测试的宿主发现路径写死了 web/CLI 时代的布局 —— `findDshRoot()` 找 `profiles/web/node_modules` 与 `profiles/node_modules`（`test/host-mount.mjs:22-34`），`locate()` 找 `profiles/web/node_modules`、`profiles/node_modules`、插件自己的 `node_modules`。而 desktop 0.2.0-rc.2 **把全部宿主包封进 `app.asar`**，profile 下只剩 `cordis`/`cosmokit` 两个真实目录。
- **证据**：`profiles/desktop/node_modules/@deepseek-ai` = 2 项；`profiles/node_modules/@deepseek-ai` = **空**；`profiles/web/node_modules/@deepseek-ai` = **空**。
- **危害**：**这是 `COMPAT.md` §5.4 记录过的第 2 次"守护自己静默失效"**。上次是"`slots` 版本探测和必需依赖捆在一个 `try` 里"；这次是整个宿主发现机制在桌面版上落空。今天它掩盖不了任何东西（插件是好的），但下一个换版回归会被它放过去。
- **修法（二选一或都做）**：
  1. 给两个测试加 desktop/asar 宿主发现：默认根扩成 `[DSH_GIT_DSH_ROOT, profiles/<DSH_PROFILE>/node_modules, profiles/node_modules, <app.asar 解包目录>]`，其中 asar 用 `DSH_ASAR` 或从 `profiles/*/package.json` 之外的环境变量拿；找不到时**不要把 SKIP 当成"通过"**——至少在存在 `profiles/desktop` 时打印一条醒目提示（例如 `SKIP … but a desktop profile exists; the host guard DID NOT RUN`）。
  2. 或者提供 `npm run test:host:asar` 之类的显式入口，用本报告 §一 的提取手法（约 9 秒、非二进制约 111MB）把宿主包铺到临时目录再跑。
- **注意**：CI（`ubuntu-latest`，无 profile）仍应保持 SKIP + exit 0 的契约；改动只应影响"有 profile 但解析不到"这一档。

### 3.2 【中】`test/ui/verify-diff.mjs` 在 desktop 0.2.0-rc.2 上跑不完

- **症状 1（先撞上）**：0.2 桌面版首次启动有「预览版说明」弹层（`div[role=presentation]._root_o6lrb_6` + `._mask_o6lrb_18`，唯一按钮文案是**「继续」**）。它盖在输入框上方，`dock.click()` 被判定为 `intercepts pointer events`，30 秒后 `TimeoutError`（`verify-diff.mjs:183`）。**Escape 关不掉它**。
- **症状 2**：脚本切换工作区用的是 `button[aria-label="选择工作区"]`（`:134`），该选择器在 0.2 桌面版**不存在**；现在的工作区列表是侧边栏的 `[role=treeitem].*_projectRow`，且点了工作区行只改变列表选中，**不会**把当前会话的 cwd 切过去。
- **影响**：`AGENTS.md` §6 把 `verify-diff.mjs` 列为本机维护步骤，现在它在桌面版上必然失败（失败原因是测试基建，不是插件）。本轮的替代做法：在脚本外先点掉「继续」，并把 git 端点整体夹具化（`status`/`log`/`branches`/`diff` 全部 route.fulfill），这样不依赖工作区脏不脏、也不需要切换会话 —— 本轮真浏览器全套断言就是这么跑通的。

### 3.3 【中】文档里的环境事实大面积过期

| 位置 | 现在写的 | 实测 |
| --- | --- | --- |
| `AGENTS.md` §8 / `COMPAT.md` §0 | 真实 GUI 在 `127.0.0.1:3080` | **19387**（`DSH_WEB_URL`），3080 无监听 |
| `AGENTS.md` §8 / `COMPAT.md` §5.3 | profile 是 `web`，插件以 `link:E:/dsh/plugin/dsh-git` 安装 | 活的 profile 是 **`desktop`**，插件是 **npm 安装副本**（内容与仓库一致，但改仓库不会自动生效，要走 `dsh plugin --profile desktop add …`） |
| `COMPAT.md` §3 / §4.7 / §5.3 | `profiles/node_modules/@deepseek-ai` 有 241/258 项 junction，宿主包在 nvm/nodejs 的 CLI 树里 | **空目录**；宿主包只在 **`app.asar\dsh\node_modules\@deepseek-ai`** 内 |
| `COMPAT.md` §5.3 | `glob`/`grep` 不跟随 junction 的取证陷阱 | 仍适用，但更要紧的是**asar 不能被 PowerShell 读取**（要自写读取器或用 DSH 自己的文件层） |
| `COMPAT.md` §0 第 4 步 | 按 `__DSH_BOOT__` 的 URL 抓字节对比 | **仍有效**（本轮实测 rev 复算一致、字节逐字节相同），只是取 token/cookie 的方式变了：桌面版没有打印 URL，token 由 Electron 主进程经 IPC 拿走后交给内嵌窗口（`dsh-desktop-host/lib/index.js:337-344`） |

### 3.4 【低】`COMPAT.md` §4.5 的症状描述与 0.2.0-rc.2 实际不符

`COMPAT.md:183-184`、`:239-240` 写"`llm` 起不来 → 胶囊和面板**一起静默消失**"。实测（读 `dsh-client-modules` 的入选条件）**不是这样**：

- 客户端入口的入选条件是 `entry.fiber !== void 0 && !entry.disabled`（`dsh-client-modules/lib/index.js:833-839`）——**不检查 fiber 是否 ACTIVE**。PENDING 的行照样进图、照样发 `/plugins` 路由。
- 所以 PENDING 的真实后果是：**浏览器半仍在、胶囊与面板仍然渲染**，但宿主路由没注册 → 请求落到 frontend-static 的 fallback → POST 得 **405** → 浏览器半进入 `phase:"error"` → 胶囊显示「当前工作区不是 Git 仓库」。
- "凭空消失"对应的是**入口根本没解析到模块**（`entry.fiber === void 0`）那类故障。

⇒ 排查判据应改为：**看 stderr 那一行 + Network 里 `/dsh-git-rpc/*` 是否 405 + 胶囊是否显示 notRepo**，而不是"面板消失"。

**但客户端侧是相反的一层，`COMPAT.md` §5.1 同样需要修正。** 浏览器半自己导出的服务注入是 `inject = ["slots","connection","locale"]`，缺任何一个不再"fiber park → 座位静默消失"，而是**整页启动失败**：`dsh-web-frontend/dist/assets/index-5SrrfWpU.js` 里的 web 启动审计会遍历 loader 条目，对非 active 的 fiber 逐条收集 `pending (waiting for service: …)` / `import failed: …`，只要有一条就 `throw new Error("web boot: N entries did not activate\n…")`，被启动器接住显示在启动页；同一条失败还会出现在 **设置 → 插件** 的 clientSync 里。本轮已从该 bundle 中逐字复核这段代码。

所以"静默失效"在这个版本里只剩**两种**真正的静默面：

1. **座位改名/未声明**：`ctx.slots.inject(key, …)` 只在座位已声明时执行（`dsh-client-ui-renderer/lib/client.js:1359-1369`，`spec === undefined` 直接 return），此时 fiber 是 active，上面的启动审计抓不到 → 座位永远不出现且无任何报错。
2. **列表行不再填 `cwd`**：`byId[id].cwd` 是条件展开的可选字段（`dsh-api-session-controller/lib/types/client/sessions/service.js:509`），插件在 `lib/client.js:3105` 用 `if (!cwd || …) return null` 兜底 → 一旦宿主停填，胶囊与面板一起静默消失（0.2.0-rc.2 仍在填，属"需持续盯"）。

### 3.5 【低】`POST /dsh-git-rpc`（正好等于前缀）返回 404，容易误读成"路由没挂"

活体对照：

| 请求 | 状态 | 响应体 |
| --- | --- | --- |
| `POST /dsh-git-rpc/status` | 200 | 插件信封（正常数据 / `details.code`） |
| `POST /dsh-git-rpc`（无端点段） | **404** | 插件自己的 `server-response` + `rpcId:"invalid-request"` + `not-found` |
| `POST /totally-unknown-rpc` | 405 | 空 |
| `GET /some-unknown-page` | 404 | 空 |

`COMPAT.md` §0 第 2 步的判据（401=路由在围栏在 / 404=路由没挂）**只对带端点段的路径成立**；探针必须打 `/dsh-git-rpc/<endpoint>`。本轮一开始就踩了这个（用 `/dsh-git-rpc` 得到 404，一度误判为宿主半没挂），建议在 `COMPAT.md` §0 里补一句。

### 3.6 【低】composer 几何：`bottom:168` 在常规会话里**依然精确**，但空会话（hero 输入框）会重叠

这是插件里唯一"量出来的硬编码"（`lib/client.js:388` 的 `bottom:168` 与 `DIFF_PANEL_HEIGHT` 里的 `184px`），COMPAT §4.6/§5.2 都把它记成已知薄弱点，所以本轮直接量了（1440×900，真 GUI）：

| 形态 | composer 栈位置 | 面板底边 | 重叠 | 判定 |
| --- | --- | --- | --- | --- |
| **常规会话**（有历史消息，`Dc7zOa_composerStack` 非 hero） | `top=738, bottom=900`，高 162px | `bottom=168px` → y=732 | **0px**（留 6px 间隙） | **168 仍然精确** |
| **空会话**（`… composerStack composerHero`） | `top=333, bottom=607`（居中） | `bottom=168px` → y=732 | **125px** | 面板盖住 hero 输入框 |

- 结论：`COMPAT.md` §4.6 的实测值**不需要改**（常规会话下是对的，这正是它当初量的场景）；新增一条边界：**新会话（hero 形态）下面板会盖住输入框**。是否 0.2.0 引入没有可比对的旧版本树，本轮只记录现象。
- 面板的层叠上下文也对得上：宿主 `shell.overlay` 容器是 `.BynINW_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}`（`dsh-client-ui-layout/lib/client.js:73`），外层 `.BynINW_frame` **没有 transform**，所以插件面板的 `position:fixed` 仍以视口为基准；插件面板自身是 **`z-index:30`**（`lib/client.js:391`，不是 20），在 overlay 层内高于 composer 座位的 7/9。
- 胶囊宽度对齐**没有退化**：实测胶囊所在 dock 行容器的宽度 = **774px** = `getComputedStyle` 里 `--dsh-composer-card-max-width` 的解析值（`calc(clamp(680px, 1160px*0.64, 920px) + 32px)` ≈ 774.4px），与插件 `max-width: var(--dsh-composer-card-max-width, 778px)` 的取值一致 —— 即该变量**存在且被正确消费**，778px 只是缺失时的 fallback。`COMPAT.md` §5.2 记的"比宿主 dock 占用者窄 16px/最多 32px"需要与宿主 QueueDock 的实际宽度同框对比才能判定，本轮所在会话没有 queue 项，**未复现该差异**。

---

## 四、LLM 与服务契约（逐字段，全部一致）

| 契约 | 结论 | 证据 |
| --- | --- | --- |
| `GenerateOptions` 的 `provider`/`model`/`messages`/`system`/`maxTokens`/`signal`/`sessionId` | 逐字一致 | `dsh-tool-cordis/lib/types/api-catalog.js:5195-5197`；`dsh-llm/lib/typert.host.js` 同 |
| 一次性消息无 `id`/`source` | 约束仍在 | `RequestUserInput { role:"user", content, id?: never, source?: never }`（`api-catalog.js:6159-6161`）；插件的 `generationMessage()` 正是这形状 |
| 流分片 `text-delta`/`block-end`/`finish` | 一致 | `StreamChunk`（`:7151-7152`）；插件取 `chunk.text` 与 `chunk.block.text` |
| `FinishReasonMap` 与 `failure` | 一致 | `:5143-5144`：`stop`/`tool-calls`/`max-tokens`/`aborted`/`error`，后两者带 `failure` |
| 服务方法 | 都在 | `stream(options)`、`listProviders()`（同步）、`listModels(provider)` |
| `purpose` 新增字段 | **无影响** | 仅 deepseek 适配器读；插件不发即走默认 |
| `sessionId` 转发 | 生效（真网关实测） | `dsh-llm-pi-ai/lib/index.js:1885` 语义未变；本机 provider `@mars-sea/dsh-commandcode-provider@0.12.9` 把它当 threadId、缺省则 `randomUUID()`，**不强制** |
| 一次性调用不会踩 agent-loop 不变量 | 是 | `isAgentLoopRequest` 是 WeakSet 身份判定，插件自建 options 永不被命中 |
| 新增良性耦合 | 记录 | `dsh-session-checkpoint-policy` 会对带真实 `sessionId` 的调用先 flush 该会话；失败会让起草以 `llm-failed` 结束（无 rc.1 树可比对，是否本轮新增**未能确认**） |
| `dsh.client.inject` 包名 | 仍是信息性、未命中静默跳过 | `dsh-client-modules/lib/index.js:61-75,395-404` + `lib/client.js:656-659`；6 个包名在 0.2.0-rc.2 全部存在且 `platform=web`、`exports["./client"]` 可解析 |

---

## 五、必须修改的代码

**无。** 宿主半、浏览器半、LLM 三面契约在 0.2.0-rc.2 上逐条对得上，真宿主/真浏览器/真网关实测全绿。

## 六、建议的后续动作（按收益排序）

1. **修 §3.1 的守护空转**（高）：两个测试的宿主发现要认识 desktop/asar 布局，并且"有 profile 却解析不到"**不能静默退化成 SKIP**。
2. **修 §3.2 的 UI 回归脚本**（中）：关掉「预览版说明」弹层（文案「继续」，Escape 无效）；工作区/会话切换改用侧边栏 `[role=treeitem]` 的交互，或干脆把 git 端点整体夹具化（本轮验证过的做法，且不依赖工作区脏不脏）。
3. **更新 §3.3 的环境事实**（中）：`AGENTS.md` §8、`COMPAT.md` §0/§3/§4.7/§5.3 换成 desktop 版事实（19387、profile `desktop`、宿主包在 `app.asar`、npm 副本而非 link）。
4. **改写 §3.4 的两处症状**（低）：宿主行 PENDING ≠ 界面消失（改判据为 stderr 一行 + 端点 405 + 胶囊 notRepo）；客户端 bundle 缺服务则相反 —— 是整页 `web boot: … did not activate`，`COMPAT.md` §5.1 也要一并改。
5. **补 §3.5 的探针判据**（低）：`COMPAT.md` §0 注明探针必须打 `/dsh-git-rpc/<endpoint>`。

## 七、未覆盖 / 未能确认

- **`npm test` 的 CI 行为**未在本机 CI 上重跑（本地全绿），Ubuntu 上的跳过契约不受本轮改动影响（本轮没改测试）。
- **空会话（hero 输入框）下面板重叠**已实测（§3.6），但**右栏内嵌会话**（`Dc7zOa_embeddedBody`，其 `--dsh-composer-card-max-width` 与 `--dsh-composer-side-clearance` 是另一套值）里的面板锚点与胶囊宽度**未复测**。
- **与宿主 QueueDock 的同容器排布**（宿主 queue 也 `order:20`，稳定排序按注册顺序）未在同一屏内对比宽度与间距（本轮所在会话没有 queue 项）。
- **桌面版 Electron 内嵌窗口**未验证（本轮用无头 Chrome 走 `http://127.0.0.1:19387`，与内嵌窗口同一后端与同一份前端 bundle；`dsh-app://` scheme 与 `http` 的差异不在插件范围内）。
- **`dsh-session-checkpoint-policy` 的 flush 监听是否 0.2.0-rc.2 新增**未能确认（没有 rc.1 树可比对）。
- **`dsh.client.inject` 的"信息性"声明原文**这次引不到（0.2.0-rc.2 的 asar 不发布任何 `.d.ts`），改由运行时消费者 + 宿主自身注释支撑。
- asar 内**没有任何 `.d.ts`**，本轮所有类型层结论来自 `api-catalog.js`（宿主自己生成的机器可读 API 目录）与 `typert.host.js` 内嵌声明，而不是手写 `.d.ts`。

---

### 附：本轮用到的复核命令（都已实际执行）

```powershell
# 门禁（注意：两个守护在本机会 SKIP，见 §3.1）
npm test; npm run test:diff; npm run test:commit; npm run test:ui:settings

# 让两个守护真正跑起来（先按 §一 的手法把 asar 内宿主包提取到 .audit/host）
$env:DSH_GIT_DSH_ROOT='<repo>\.audit\host\dsh\node_modules'
node test/host-mount.mjs; node test/slot-mount.mjs

# 活体（自签 session cookie 后）
POST /dsh-git-rpc/status | log | branches | diff      # 200 + 数据
POST /dsh-git-rpc/status（无 cookie）                  # 401
POST /dsh-git-rpc/status（Origin 非本机）              # 403
GET  /dsh-git-rpc/status                              # 405
POST /dsh-git-rpc/generateMessage                     # 200 + 英文提交信息
GET  /plugins/??@xia-sc/dsh-git/client.js&rev=<rev>   # 200，与装机 lib/client.js 逐字节相同
```

---

## 附二：工作区权限修复（环境问题，与插件无关）

审计开始的第一条命令就被沙箱挡回：`SetNamedSecurityInfoW failed (Win32 5): grantWrite(E:\dsh\plugin\dsh-git)` —— 工作区的 Windows 文件权限缺一项，DSH 无法完成工作区授权。按 `diagnose-windows-sandbox-acl` 的流程（一次命令、诊断与修复同一轮）跑了一次：给 `E:\dsh\plugin\dsh-git` 补上当前用户的完全控制项（`WRITE_OWNER` 由 `false` → `true`，脚本自带的重读验证为 `verified`），**文件内容与所有者未变**，随后原来的受限操作恢复正常。

备份与独立的回滚脚本在 `E:\dsh\plugin\dsh-git\.acl-report\`。不需要保留时直接删掉该目录即可；若要撤销那次权限改动，在普通（非受限）终端运行：

```
pwsh -NoProfile -File 'E:\dsh\plugin\dsh-git\.acl-report\acl-backup-126d7e9ef43f40cab9be5e93eb2d9d15.json.ps1' -Path 'E:\dsh\plugin\dsh-git' -AllowRoot 'E:\dsh\plugin\dsh-git' -Restore 'E:\dsh\plugin\dsh-git\.acl-report\acl-backup-126d7e9ef43f40cab9be5e93eb2d9d15.json'
```
