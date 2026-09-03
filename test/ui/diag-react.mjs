// Diagnostic: inspect the seed React in the running shell and reproduce the
// useSyncExternalStore crash with full detail.
import { chromium } from "playwright-core";

const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(4000);

// 1) seed react / react-dom versions from the module table
const info = await page.evaluate(() => {
  const sys = window.__DSH_MODULES__;
  const out = { hasSys: !!sys };
  try {
    const seed = sys.seed;
    out.seedKeys = seed ? [...seed.keys()] : null;
    const react = seed && seed.get("react");
    out.reactVersion = react && react.version ? react.version : (react ? "no version prop" : "missing");
    const rd = seed && seed.get("react-dom");
    out.reactDomVersion = rd && rd.version ? rd.version : "n/a";
    const rdc = seed && seed.get("react-dom/client");
    out.reactDomClientVersion = rdc && rdc.version ? rdc.version : "n/a";
  } catch (e) {
    out.err = String(e);
  }
  return out;
});
console.log("seed info:", JSON.stringify(info, null, 1));

// 2) reproduce: build a tiny component using the seed React's useSyncExternalStore
//    against a minimal external store, render with seed react-dom/client.
const repro = await page.evaluate(async () => {
  const out = { ok: false };
  try {
    const sys = window.__DSH_MODULES__;
    const seed = sys.seed;
    const React = seed.get("react");
    const ReactDOMClient = seed.get("react-dom/client");
    out.reactVersion = React.version;
    out.hasClient = !!ReactDOMClient;

    const store = {
      state: { n: 1 },
      listeners: new Set(),
      subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
      getSnapshot() { return this.state; }
    };
    function Probe(props) {
      const s = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      return React.createElement("div", { id: "probe" }, "n=" + s.n);
    }
    const root = document.createElement("div");
    document.body.appendChild(root);
    const domRoot = ReactDOMClient.createRoot(root);
    domRoot.render(React.createElement(Probe));
    await new Promise((r) => setTimeout(r, 300));
    out.ok = true;
    out.text = root.textContent;
    out.html = root.innerHTML;
    domRoot.unmount();
    root.remove();
  } catch (e) {
    out.error = String(e);
    out.stack = e && e.stack ? e.stack.split("\n").slice(0, 8).join("\n") : null;
  }
  return out;
});
console.log("repro:", JSON.stringify(repro, null, 1));

// 3) reproduce the exact plugin crash path: locate the store via the loaded
//    module and try mounting GitFloatingPanel is not possible (not exported),
//    so render the probe against the REAL dsh store pattern instead: check
//    whether useSyncExternalStore works when getSnapshot returns a plain object.
console.log("\nconsole logs (filtered):");
for (const l of logs.filter((x) => x.includes("dsh-git") || x.includes("useSyncExternalStore") || x.includes("pageerror") || x.includes("error"))) console.log(l);

await browser.close();
console.log("\nDONE");
