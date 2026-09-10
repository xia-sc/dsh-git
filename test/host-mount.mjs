// Mount test against a REAL Cordis host with the REAL dsh Connection service.
// Run: node test/host-mount.mjs
//
// This is the regression guard for the dsh >= 0.1.5-rc.1 breakage: the host
// half used to call `ctx.connection.rpc.handle(...)`, which an outside plugin
// cannot do in this version — `HostConnectionService.rpc` registers through the
// connection plugin's OWN context (`owner.effect(() => owner.webServer...)`),
// whose inject is only `["credentials"]`, so the row failed to mount with
// `cannot get property "webServer" without inject`.
//
// The DSH packages are resolved from the installed profile (DSH_HOME), so the
// test covers whatever version is actually deployed. Without a profile it
// reports SKIP.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { apply, inject, name } from "../lib/index.js";

function findDshRoot() {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const roots = [
    process.env.DSH_GIT_DSH_ROOT,
    join(dshHome, "profiles", "web", "node_modules"),
    join(dshHome, "profiles", "node_modules")
  ].filter((root) => typeof root === "string" && root !== "");
  for (const root of roots) {
    const cordis = join(root, "@deepseek-ai", "cordis", "lib", "index.js");
    const connection = join(root, "@deepseek-ai", "dsh-client-connection", "lib", "index.js");
    if (existsSync(cordis) && existsSync(connection)) return { root, cordis, connection };
  }
  return undefined;
}

const located = findDshRoot();
if (located === undefined) {
  console.log("SKIP: no installed DSH profile found (set DSH_GIT_DSH_ROOT to a node_modules containing @deepseek-ai/*).");
  process.exit(0);
}

const { Context } = await import(pathToFileURL(located.cordis).href);
const { HostConnectionService } = await import(pathToFileURL(located.connection).href);
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

// The real Connection host service, built the way dsh-client-connection does.
await app.plugin({
  name: "client-connection",
  inject: ["credentials"],
  apply(ctx) {
    const auth = { isAuthenticated: () => true, authorizeIndex: () => true, authenticatedUrl: (url) => url };
    new HostConnectionService(ctx, [], auth);
    ctx.inject(["webServer"], (webCtx) => {
      webCtx.effect(() => webCtx.webServer.register({ kind: "prefix", path: "/api", handler: () => {} }), "client-connection: /api route");
    });
  }
}).await();

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
console.log("\nHOST MOUNT TEST PASSED (the row activates and owns /dsh-git-rpc)");
