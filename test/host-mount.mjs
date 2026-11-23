// Mount test against a REAL Cordis host with the REAL dsh Connection service.
// Run: node test/host-mount.mjs
//
// This is the regression guard for the dsh >= 0.2.2-rc.1 breakage: the host
// half registered a third-party RPC channel itself because
// `ctx.connection.rpc.handle(...)` cannot work for an outside plugin — the
// service registers through the connection plugin's OWN context
// (`owner.effect(() => owner.webServer...)`), whose inject does not include
// `webServer`, so the row failed to mount with
// `cannot get property "webServer" without inject`.
//
// It also pins the request fence across the two supported host generations:
// dsh 0.2.2 exposes `connection.requestRejection()`, dsh 0.2.3-alpha.2 dropped
// it in favour of the WebServer's `webserver/authorize` hook plus
// `connection.isTrustedRequest()` (see `channelFence` in lib/index.js). A host
// with neither must refuse to mount rather than serve an unfenced git channel.
//
// The DSH packages are resolved through test/host-root.mjs, so the test covers
// whatever version is actually deployed — including the Electron **desktop**
// install, whose host packages live inside `app.asar` and are extracted to a
// temp cache on first use. Without any host install it reports SKIP; with one
// that resolves nothing it FAILS (never a silent skip: see host-root.mjs).
import { existsSync, readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { apply, inject, name } from "../lib/index.js";
import { hostRoots, unresolvedHost } from "./host-root.mjs";

function findDshRoot() {
  for (const root of hostRoots()) {
    const cordis = join(root, "@deepseek-ai", "cordis", "lib", "index.js");
    const connection = join(root, "@deepseek-ai", "dsh-client-connection", "lib", "index.js");
    if (existsSync(cordis) && existsSync(connection)) return { root, cordis, connection };
  }
  return undefined;
}

const located = findDshRoot();
if (located === undefined) {
  const verdict = unresolvedHost();
  if (verdict.skip !== undefined) {
    console.log(`SKIP: ${verdict.skip}`);
    console.log("  set DSH_GIT_DSH_ROOT to a node_modules containing @deepseek-ai/* to point this guard at another install.");
    process.exit(0);
  }
  console.error(`FAIL: ${verdict.error}`);
  process.exit(1);
}

const { Context } = await import(pathToFileURL(located.cordis).href);
const connectionModule = await import(pathToFileURL(located.connection).href);
const { HostConnectionService } = connectionModule;
/** Installed version of one DSH package under the resolved profile root. */
function versionOf(pkg) {
  return JSON.parse(readFileSync(join(located.root, "@deepseek-ai", pkg, "package.json"), "utf8")).version;
}

const routes = [];
const app = new Context();

// dsh-host-webserver stand-in: owns `webServer`.
await app.plugin({
  name: "web-server",
  apply(ctx) {
    ctx.provide("webServer", {
      register(route) { routes.push(route); return () => {}; }
    });
  }
}).await();

// dsh-credentials stand-in (the Connection service injects it).
await app.plugin({
  name: "credentials",
  apply(ctx) {
    ctx.provide("credentials", { get: async () => undefined, set: async () => {} });
  }
}).await();

// dsh-llm stand-in. It is NOT in the plugin's `inject` list (AI drafting is
// optional and must degrade, never hold the row back), but the host that has it
// must still resolve it through `ctx.get("llm")` for the capability bit below.
await app.plugin({
  name: "llm",
  apply(ctx) {
    ctx.provide("llm", {
      listProviders: () => [],
      listModels: async () => [],
      stream: async function* () {}
    });
  }
}).await();

// The real Connection host service, built the way dsh-client-connection does.
//
// Both supported generations are handled, because the plugin must mount on
// each: dsh 0.2.2-rc.1 took browser authentication as the third constructor
// argument (`new HostConnectionService(ctx, trustedHosts, browserAuth)`), while
// dsh 0.2.3-alpha.2 moved it into a `connection.authentication` service the
// owning plugin provides and the constructor reads (`(ctx, trustedHosts)`).
const { ConnectionAuthentication } = connectionModule;
const auth = { isAuthenticated: () => true, authorizeIndex: () => true, authenticatedUrl: (url) => url };

/** Mount one HostConnectionService plus its `/api` route, as the host plugin does. */
async function mountConnectionService(app) {
  await app.plugin({
    name: "client-connection",
    inject: ["credentials"],
    apply(ctx) {
      if (typeof ConnectionAuthentication === "function") {
        new ConnectionAuthentication(ctx);
        ctx.inject(["connection.authentication"], (authCtx) => {
          new HostConnectionService(authCtx, []);
          authCtx.inject(["webServer"], (webCtx) => {
            webCtx.effect(() => webCtx.webServer.register({ kind: "prefix", path: "/api", handler: () => {} }), "client-connection: /api route");
          });
        });
        return;
      }
      new HostConnectionService(ctx, [], auth);
      ctx.inject(["webServer"], (webCtx) => {
        webCtx.effect(() => webCtx.webServer.register({ kind: "prefix", path: "/api", handler: () => {} }), "client-connection: /api route");
      });
    }
  }).await();
}
await mountConnectionService(app);

const fiber = app.plugin({ name, inject, apply });
let mounted = false;
try {
  await fiber.await();
  mounted = true;
} catch (error) {
  throw new Error(`dsh-git row failed to mount on dsh-client-connection@${versionOf("dsh-client-connection")}: ${error.message}`);
}
if (!mounted) throw new Error("dsh-git row did not settle into an active state");

const own = routes.find((route) => route.path === "/dsh-git-rpc");
if (own === undefined) throw new Error(`/dsh-git-rpc route not registered (routes: ${routes.map((r) => r.path).join(", ")})`);
if (own.kind !== "prefix" || typeof own.handler !== "function") {
  throw new Error(`/dsh-git-rpc route is malformed: ${JSON.stringify({ kind: own.kind, handler: typeof own.handler })}`);
}

console.log(`mounted against @deepseek-ai/dsh-client-connection@${versionOf("dsh-client-connection")}`);
console.log(`routes: ${routes.map((route) => `${route.kind} ${route.path}`).join(", ")}`);

// ── the hand-rolled envelopes must satisfy the host's OWN wire schemas ───────
// Mounting only proves a route object landed on a stand-in `webServer`. The
// schema pair below is the authority the browser's parser mirrors
// (`dsh-client-connection`'s `clientRequestSchema`/`serverResponseSchema`), so
// validating the real handler's answers against it is what catches a host
// release that tightens the envelope — otherwise the plugin fails in the
// browser only, which is the silent-failure class COMPAT.md exists for.
// An older host without the schemas degrades to a printed note, never a failure.
{
  const { clientRequestSchema, serverResponseSchema } = connectionModule;
  if (typeof clientRequestSchema?.safeParse !== "function" || typeof serverResponseSchema?.safeParse !== "function") {
    console.log("NOTE: this host exports no RPC envelope schemas; envelope validation skipped");
  } else {
    /** Drive the mounted route handler exactly as `connection.rpc.call` does. */
    async function post(pathname, body, raw, extraHeaders) {
      const req = new EventEmitter();
      req.url = pathname;
      req.method = "POST";
      // A loopback Host is what the connection fence admits (it rejects a
      // missing Host outright), so this stands in for the browser's own header.
      req.headers = { "content-type": "application/json", host: "127.0.0.1:3080", ...extraHeaders };
      req.resume = () => {};
      const res = new EventEmitter();
      const out = [];
      res.writableEnded = false;
      res.statusCode = 0;
      res.setHeader = () => {};
      res.end = (chunk) => {
        if (chunk !== undefined) out.push(String(chunk));
        res.writableEnded = true;
      };
      const pending = own.handler(req, res);
      req.emit("data", Buffer.from(raw ?? JSON.stringify(body), "utf8"));
      req.emit("end");
      await pending;
      return { status: res.statusCode, text: out.join("") };
    }

    // 1. The request envelope the browser sends must be a valid client-request.
    const sent = { type: "client-request", rpcId: "mount-1", method: "status", payload: { args: { cwd: "relative/path" } } };
    const requestCheck = clientRequestSchema.safeParse(sent);
    if (!requestCheck.success) throw new Error(`mounted channel rejects a canonical dsh client-request: ${requestCheck.error.message}`);

    // 2. A dispatched failure: `cwd` is relative, so validation refuses it
    //    BEFORE any git child is spawned — this suite stays git-free.
    const answered = await post("/dsh-git-rpc/status", sent);
    if (answered.status !== 200) throw new Error(`a validated-cwd failure must answer 200, got ${answered.status}`);
    const failed = serverResponseSchema.safeParse(JSON.parse(answered.text));
    if (!failed.success) throw new Error(`the plugin's failure response is not a valid dsh envelope: ${failed.error.message}`);
    if (failed.data.rpcId !== sent.rpcId) throw new Error(`rpcId must round-trip, got ${String(failed.data.rpcId)}`);
    if (failed.data.result.ok !== false || failed.data.result.error.details.code !== "invalid-cwd") {
      throw new Error(`the plugin's diagnostic code must ride in details.code: ${answered.text}`);
    }

    // 3. An unknown endpoint answers with the same envelope family (HTTP 200,
    //    in-band failure — never a bare status).
    const unknownBody = { type: "client-request", rpcId: "mount-2", method: "nope", payload: { args: {} } };
    const unknown = await post("/dsh-git-rpc/nope", unknownBody);
    const unknownCheck = serverResponseSchema.safeParse(JSON.parse(unknown.text));
    if (!unknownCheck.success) throw new Error(`unknown-endpoint response is not a valid dsh envelope: ${unknownCheck.error.message}`);
    if (unknownCheck.data.result.ok !== false || unknownCheck.data.result.error.details.code !== "unknown-endpoint") {
      throw new Error(`unknown endpoint must fail in-band: ${unknown.text}`);
    }

    // 4. The channel's own 404 branch (outside `/dsh-git-rpc/<endpoint>`).
    const outside = await post("/dsh-git-rpc/status/../etc", "{}");
    if (outside.status !== 404) throw new Error(`outside the channel must answer 404, got ${outside.status}`);
    const outsideCheck = serverResponseSchema.safeParse(JSON.parse(outside.text));
    if (!outsideCheck.success) throw new Error(`404 response is not a valid dsh envelope: ${outsideCheck.error.message}`);

    // 5. The fence itself, which is the half that changed between host
    //    generations: an untrusted Host/Origin must be refused before the
    //    envelope is even parsed. dsh 0.2.2 answers through
    //    `connection.requestRejection()`; dsh 0.2.3 through
    //    `connection.isTrustedRequest()`. Both must yield 403 here.
    const foreign = await post("/dsh-git-rpc/status", sent, undefined, { host: "attacker.example" });
    if (foreign.status !== 403) throw new Error(`an untrusted Host must be refused with 403, got ${foreign.status} (${foreign.text.slice(0, 120)})`);
    const crossSite = await post("/dsh-git-rpc/status", sent, undefined, { "sec-fetch-site": "cross-site" });
    if (crossSite.status !== 403) throw new Error(`a cross-site request must be refused with 403, got ${crossSite.status}`);

    console.log("envelope schemas: client-request, failure, unknown-endpoint and 404 all validate against the host's own schemas");
    console.log("request fence: untrusted Host and cross-site requests are refused with 403");
  }
}

// ── a host WITHOUT dsh-llm must still mount the row ──────────────────────────
// The drafting service used to be a hard inject, and the host does not list
// `llm` among its required startup entries: when it was missing, the plugin row
// stayed PENDING, `/dsh-git-rpc` was never registered, and the browser got a 405
// (COMPAT.md §4.5). Mounting without it is the actual contract now.
{
  const noLlmRoutes = [];
  const noLlmApp = new Context();
  await noLlmApp.plugin({
    name: "web-server",
    apply(ctx) {
      ctx.provide("webServer", {
        register(route) { noLlmRoutes.push(route); return () => {}; }
      });
    }
  }).await();
  await noLlmApp.plugin({
    name: "credentials",
    apply(ctx) {
      ctx.provide("credentials", { get: async () => undefined, set: async () => {} });
    }
  }).await();
  await mountConnectionService(noLlmApp);
  const noLlmFiber = noLlmApp.plugin({ name, inject, apply });
  try {
    await noLlmFiber.await();
  } catch (error) {
    throw new Error(`dsh-git must mount on a host without the optional llm service: ${error.message}`);
  }
  const noLlmOwn = noLlmRoutes.find((route) => route.path === "/dsh-git-rpc");
  if (noLlmOwn === undefined) {
    throw new Error(`a host without llm must still get /dsh-git-rpc (routes: ${noLlmRoutes.map((route) => route.path).join(", ")})`);
  }
  console.log("mount without llm: the row activates and still owns /dsh-git-rpc");
}

console.log("\nHOST MOUNT TEST PASSED (the row activates and owns /dsh-git-rpc, with and without the optional llm service)");
