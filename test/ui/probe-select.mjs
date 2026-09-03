// Probe: does Chromium honor option background/color at all? Set concrete
// values and read computed style; also test whether the dropdown listbox
// (opened) reflects option colors.
import { chromium } from "playwright-core";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(4000);
const studyRow = page.locator('div[class*=projectRow]', { hasText: "study-后台" }).first();
if (await studyRow.count() > 0) { await studyRow.click(); await page.waitForTimeout(1000); }
const rows = page.locator('div[class*=sessionRow]');
const n = await rows.count();
const studyBox = await studyRow.boundingBox();
for (let i = 0; i < n; i++) {
  const box = await rows.nth(i).boundingBox();
  const text = (await rows.nth(i).textContent()).trim();
  if (studyBox && box && box.y > studyBox.y && text.length > 3 && !text.startsWith("新会话")) { await rows.nth(i).click(); break; }
}
await page.waitForTimeout(4000);
await page.locator('[data-dsh-git="dock"]').first().click();
await page.waitForTimeout(1200);

const probe = await page.evaluate(() => {
  const select = document.querySelector('[data-dsh-git="panel"] select');
  const opt = select.querySelector("option");
  // force concrete colors
  opt.style.background = "#1e1e1e";
  opt.style.color = "#e5e7eb";
  const cs = getComputedStyle(opt);
  return { background: cs.backgroundColor, color: cs.color, colorScheme: getComputedStyle(select).colorScheme };
});
console.log("concrete option styles:", JSON.stringify(probe));

// open the dropdown and screenshot it (for the record)
await page.locator('[data-dsh-git="panel"] select').focus();
await page.keyboard.press("Alt+ArrowDown");
await page.waitForTimeout(800);
await page.screenshot({ path: "E:/dsh/plugin/dsh-git/test/ui/select-open.png" });
await page.keyboard.press("Escape");

await browser.close();
console.log("PROBE DONE");
