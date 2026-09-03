// Expand the study-后台 workspace in the sidebar, open a real session, and
// verify the dsh-git badge/dock show the actual branch.
import { chromium } from "playwright-core";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

// Expand study-后台 workspace row
const studyRow = page.locator('div[class*=projectRow]', { hasText: "study-后台" }).first();
console.log("study row count:", await studyRow.count());
if (await studyRow.count() > 0) {
  await studyRow.click();
  await page.waitForTimeout(1500);
}
// Find its session rows (session rows following the project row)
const sessionRows = page.locator('div[class*=sessionRow]');
const count = await sessionRows.count();
console.log("session rows:", count);
let clicked = false;
for (let i = 0; i < count; i++) {
  const row = sessionRows.nth(i);
  const text = (await row.textContent()).trim();
  // study-后台 session rows appear after its project row; pick a real (non-新会话) row
  if (text.includes("study") || (await studyRow.count() > 0 && text.length > 3 && !text.startsWith("新会话"))) {
    // verify it's under the study group by proximity: skip "plugin" group rows
    const pluginRow = page.locator('div[class*=projectRow]', { hasText: "plugin" }).first();
    const pluginBox = await pluginRow.boundingBox();
    const rowBox = await row.boundingBox();
    if (pluginBox && rowBox && rowBox.y > pluginBox.y) {
      // could be plugin group's rows; check if below studyRow
      const studyBox = await studyRow.boundingBox();
      if (studyBox && rowBox.y > studyBox.y) {
        await row.click();
        clicked = true;
        console.log("clicked session row:", JSON.stringify(text.slice(0, 50)));
        break;
      }
    }
  }
}
if (!clicked) {
  // fallback: click the first session row under study-后台 if any
  console.log("fallback: trying all rows under study row");
}

await page.waitForTimeout(4000);

const badgeCount = await page.locator('[data-dsh-git="badge"]').count();
const dockCount = await page.locator('[data-dsh-git="dock"]').count();
console.log(`seats -> badge:${badgeCount} dock:${dockCount}`);
if (badgeCount > 0) console.log("badge text:", JSON.stringify((await page.locator('[data-dsh-git="badge"]').first().textContent()).trim()));
if (dockCount > 0) console.log("dock text:", JSON.stringify((await page.locator('[data-dsh-git="dock"]').first().textContent()).trim()));

if (badgeCount > 0) {
  await page.locator('[data-dsh-git="badge"]').first().click();
  await page.waitForTimeout(2000);
  const pc = await page.locator('[data-dsh-git="panel"]').count();
  console.log("panel:", pc);
  if (pc > 0) {
    const text = await page.locator('[data-dsh-git="panel"]').innerText();
    console.log("=== panel content ===");
    console.log(text.slice(0, 1500));
    await page.screenshot({ path: "E:/dsh/plugin/.ui-verify/ui-panel-gitrepo.png" });
  }
}
console.log("console errors:", logs.length ? logs.slice(0, 5) : "none");
await browser.close();
console.log("DONE");
