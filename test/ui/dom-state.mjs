// Inspect page DOM state: is the app shell (sidebar/composer) rendering?
import { chromium } from "playwright-core";

const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

const dom = await page.evaluate(() => {
  const q = (sel) => document.querySelectorAll(sel).length;
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.slice(0, 120) : null;
  };
  return {
    bodyTextHead: document.body.textContent.slice(0, 300),
    textareas: q("textarea"),
    buttons: q("button"),
    sidebar: q("[class*=sidebar], [data-role=sidebar]"),
    composer: q("textarea"),
    errorElements: q("[class*=error], [data-state=error]"),
    crashText: document.body.textContent.includes("crashed") || document.body.textContent.includes("崩溃")
  };
});
console.log("DOM:", JSON.stringify(dom, null, 1));

console.log("errors/warnings:", logs.length ? logs.slice(0, 15) : "none");

await browser.close();
console.log("DONE");
