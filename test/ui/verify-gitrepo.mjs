// Verify: selecting a session whose workspace IS a git repo shows the branch
// on the badge + dock line, and the panel lists real branches/actions.
import { chromium } from "playwright-core";

const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

// Find and click a session row whose workspace is the study repo.
const clicked = await page.evaluate(() => {
  // Session rows usually carry the cwd or workspace title; find any element
  // containing "study" or "后台" and click the nearest clickable ancestor.
  const nodes = [...document.querySelectorAll("*")];
  const target = nodes.find((el) => {
    const t = (el.textContent || "").trim();
    return t.includes("study-后台") || t.includes("itisp");
  });
  if (!target) return { ok: false, reason: "no study row found" };
  let clickable = target;
  for (let i = 0; i < 6 && clickable; i++) {
    const style = getComputedStyle(clickable);
    if (style.cursor === "pointer" || clickable.tagName === "BUTTON" || clickable.tagName === "A" || clickable.getAttribute("role") === "button") break;
    clickable = clickable.parentElement;
  }
  if (!clickable) return { ok: false, reason: "no clickable ancestor" };
  clickable.click();
  return { ok: true, tag: clickable.tagName, cls: clickable.className };
});
console.log("click study session:", JSON.stringify(clicked));

await page.waitForTimeout(4000);

// Badge / dock state
const badgeCount = await page.locator('[data-dsh-git="badge"]').count();
const dockCount = await page.locator('[data-dsh-git="dock"]').count();
console.log(`seats -> badge:${badgeCount} dock:${dockCount}`);
if (badgeCount > 0) console.log("badge text:", JSON.stringify((await page.locator('[data-dsh-git="badge"]').first().textContent()).trim()));
if (dockCount > 0) console.log("dock text:", JSON.stringify((await page.locator('[data-dsh-git="dock"]').first().textContent()).trim()));

// Expand panel and dump content
if (badgeCount > 0) {
  await page.locator('[data-dsh-git="badge"]').first().click();
  await page.waitForTimeout(2000);
  const panelCount = await page.locator('[data-dsh-git="panel"]').count();
  console.log("panel:", panelCount);
  if (panelCount > 0) {
    const text = await page.locator('[data-dsh-git="panel"]').innerText();
    console.log("=== panel content ===");
    console.log(text.slice(0, 1200));
    await page.screenshot({ path: "E:/dsh/plugin/.ui-verify/ui-panel-gitrepo.png" });
  }
}
console.log("console errors:", logs.length ? logs.slice(0, 5) : "none");
await browser.close();
console.log("DONE");
