// Verify the branch <select> and its options use theme colors (not OS-white).
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
await page.locator('[data-dsh-git="dock"]').first().click();
await page.waitForTimeout(1500);

const sel = await page.evaluate(() => {
  const select = document.querySelector('[data-dsh-git="panel"] select');
  if (!select) return null;
  const cs = getComputedStyle(select);
  const opt = select.querySelector("option");
  const og = select.querySelector("optgroup");
  const oc = opt ? getComputedStyle(opt) : null;
  const ogc = og ? getComputedStyle(og) : null;
  return {
    selectColorScheme: cs.colorScheme,
    selectBackground: cs.backgroundColor,
    selectColor: cs.color,
    optionBackground: oc ? oc.backgroundColor : null,
    optionColor: oc ? oc.color : null,
    optgroupBackground: ogc ? ogc.backgroundColor : null,
    optgroupColor: ogc ? ogc.color : null,
    optionCount: select.querySelectorAll("option").length
  };
});
console.log("select styles:", JSON.stringify(sel, null, 1));
if (!sel) throw new Error("select not found");
if (sel.optionCount < 1) throw new Error("no options");
const white = "rgb(255, 255, 255)";
if (sel.optionBackground === white) throw new Error("option background is still OS-white");
if (!sel.selectColorScheme) throw new Error("colorScheme not set");
console.log("console errors:", logs.length ? logs.slice(0, 5) : "none");
await browser.close();
console.log("SELECT THEMED VERIFIED");
