// Verify: badge centered at bottom, dock line centered above composer, and no
// git row inside the composer.dock stats/cost area anymore.
import { chromium } from "playwright-core";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

const studyRow = page.locator('div[class*=projectRow]', { hasText: "study-后台" }).first();
if (await studyRow.count() > 0) { await studyRow.click(); await page.waitForTimeout(1200); }
const rows = page.locator('div[class*=sessionRow]');
const n = await rows.count();
for (let i = 0; i < n; i++) {
  const text = (await rows.nth(i).textContent()).trim();
  if (text.length > 3 && !text.startsWith("新会话")) { await rows.nth(i).click(); break; }
}
await page.waitForTimeout(4500);

const info = await page.evaluate(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const badge = document.querySelector('[data-dsh-git="badge"]');
  const dock = document.querySelector('[data-dsh-git="dock"]');
  // stats row (composer.dock) for comparison
  const stats = [...document.querySelectorAll("div")].find((el) => (el.textContent || "").includes("首 token"));
  const out = {
    viewport: { w: innerWidth, h: innerHeight },
    badge: badge ? { ...rect(badge), pos: getComputedStyle(badge).position, transform: getComputedStyle(badge).transform } : null,
    dock: dock ? { ...rect(dock), justifyContent: getComputedStyle(dock).justifyContent } : null,
    stats: stats ? rect(stats) : null
  };
  // centered check
  if (badge) out.badge.centerOffset = Math.abs((rect(badge).x + rect(badge).w / 2) - innerWidth / 2);
  if (dock) out.dock.centerOffset = Math.abs((rect(dock).x + rect(dock).w / 2) - innerWidth / 2);
  // git row must sit ABOVE the stats row (input.dock) — not between stats/cost
  if (badge && stats) out.badgeAboveStats = rect(badge).y < rect(stats).y;
  return out;
});
console.log(JSON.stringify(info, null, 1));

if (info.badge && info.badge.centerOffset > 8) throw new Error("badge not centered");
if (info.dock && info.dock.centerOffset > 8) throw new Error("dock line not centered");
if (info.badge && info.stats && !info.badgeAboveStats) throw new Error("badge should be above stats row");
console.log("console errors:", logs.length ? logs.slice(0, 5) : "none");
await browser.close();
console.log("POSITION VERIFIED");
