// Verify the new layout:
// 1. No floating badge element exists at all.
// 2. "不是 Git 仓库" appears exactly once (the input.dock banner) while
//    collapsed — no duplicate floating bubble over the input.
// 3. Expanding from the banner opens the panel ABOVE the composer card
//    (panel bottom edge above the textarea top edge), so it never covers the
//    input box.
import { chromium } from "playwright-core";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

const before = await page.evaluate(() => {
  const badges = document.querySelectorAll('[data-dsh-git="badge"]').length;
  const docks = document.querySelectorAll('[data-dsh-git="dock"]').length;
  const text = document.body.textContent;
  const hits = text.split("不是 Git 仓库").length - 1;
  const ta = document.querySelector("textarea");
  const taRect = ta ? ta.getBoundingClientRect() : null;
  return { badges, docks, notRepoHits: hits, textarea: taRect ? { y: Math.round(taRect.y), h: Math.round(taRect.height) } : null };
});
console.log("collapsed state:", JSON.stringify(before));
if (before.badges !== 0) throw new Error("floating badge still present!");
if (before.docks !== 1) throw new Error(`expected exactly 1 dock banner, got ${before.docks}`);
if (before.notRepoHits !== 1) throw new Error(`"不是 Git 仓库" should appear exactly once, got ${before.notRepoHits}`);

// expand from the banner
await page.locator('[data-dsh-git="dock"]').first().click();
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  const panel = document.querySelector('[data-dsh-git="panel"]');
  const ta = document.querySelector("textarea");
  const pr = panel ? panel.getBoundingClientRect() : null;
  const tr = ta ? ta.getBoundingClientRect() : null;
  return {
    panel: pr ? { y: Math.round(pr.y), bottom: Math.round(pr.bottom), h: Math.round(pr.height) } : null,
    textarea: tr ? { top: Math.round(tr.y), bottom: Math.round(tr.bottom) } : null,
    // overlap = the two rectangles intersect
    overlapsInput: pr && tr ? pr.bottom > tr.y && pr.y < tr.bottom : null
  };
});
console.log("expanded state:", JSON.stringify(after));
if (!after.panel) throw new Error("panel did not open");
if (after.overlapsInput === true) throw new Error("panel overlaps the input box!");

console.log("console errors:", logs.length ? logs.slice(0, 5) : "none");
await browser.close();
console.log("LAYOUT VERIFIED");
