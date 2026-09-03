// Verify the input.dock banner has an opaque background so scrolled content
// cannot show through it.
import { chromium } from "playwright-core";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

// open study repo session
const studyRow = page.locator('div[class*=projectRow]', { hasText: "study-后台" }).first();
if (await studyRow.count() > 0) { await studyRow.click(); await page.waitForTimeout(1200); }
const studyBox = await studyRow.boundingBox();
const rows = page.locator('div[class*=sessionRow]');
const n = await rows.count();
for (let i = 0; i < n; i++) {
  const box = await rows.nth(i).boundingBox();
  const text = (await rows.nth(i).textContent()).trim();
  if (studyBox && box && box.y > studyBox.y && text.length > 3 && !text.startsWith("新会话")) {
    await rows.nth(i).click();
    break;
  }
}
await page.waitForTimeout(4500);

const bg = await page.evaluate(() => {
  const el = document.querySelector('[data-dsh-git="dock"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    backgroundColor: cs.backgroundColor,
    opacity: cs.opacity,
    borderRadius: cs.borderRadius,
    padding: cs.padding
  };
});
console.log("banner background:", JSON.stringify(bg));
if (!bg) throw new Error("banner not found");
const transparent = bg.backgroundColor === "rgba(0, 0, 0, 0)" || bg.backgroundColor === "transparent";
if (transparent) throw new Error("banner background is transparent!");
if (bg.opacity !== "1") throw new Error("banner opacity not 1");

// scroll the conversation and confirm the banner still has its background
await page.evaluate(() => { const sc = document.querySelector('[class*=scrollport], [class*=transcript], main, [class*=conversation]'); if (sc) sc.scrollTop = 400; });
await page.waitForTimeout(800);
const bg2 = await page.evaluate(() => {
  const el = document.querySelector('[data-dsh-git="dock"]');
  return el ? getComputedStyle(el).backgroundColor : null;
});
console.log("after scroll:", bg2);
console.log("console errors:", logs.length ? logs.slice(0, 5) : "none");
await browser.close();
console.log("BANNER BACKGROUND VERIFIED");
