// Verify repo-session mode: banner shows the branch, clicking it opens the
// panel, and the panel does not overlap the bottom composer input.
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
  // rows belonging to the study group sit below its project row
  if (studyBox && box && box.y > studyBox.y && text.length > 3 && !text.startsWith("新会话")) {
    await rows.nth(i).click();
    console.log("clicked:", JSON.stringify(text.slice(0, 40)));
    break;
  }
}
await page.waitForTimeout(4500);

const bannerText = (await page.locator('[data-dsh-git="dock"]').first().textContent()).trim();
console.log("banner text:", JSON.stringify(bannerText));
if (!bannerText.includes("feature/issues-IJTS03")) throw new Error("banner should show the branch in a repo session");

await page.locator('[data-dsh-git="dock"]').first().click();
await page.waitForTimeout(1500);
const geo = await page.evaluate(() => {
  const panel = document.querySelector('[data-dsh-git="panel"]');
  const ta = document.querySelector("textarea");
  if (!panel || !ta) return null;
  const pr = panel.getBoundingClientRect(), tr = ta.getBoundingClientRect();
  return {
    panel: { y: Math.round(pr.y), bottom: Math.round(pr.bottom) },
    textarea: { top: Math.round(tr.y), bottom: Math.round(tr.bottom) },
    overlaps: pr.bottom > tr.y && pr.y < tr.bottom
  };
});
console.log("composer-mode geometry:", JSON.stringify(geo));
if (!geo || geo.overlaps) throw new Error("panel overlaps composer input!");
const panelText = (await page.locator('[data-dsh-git="panel"]').innerText()).slice(0, 200);
console.log("panel head:", JSON.stringify(panelText));
console.log("console errors:", logs.length ? logs.slice(0, 5) : "none");
await browser.close();
console.log("REPO MODE VERIFIED");
