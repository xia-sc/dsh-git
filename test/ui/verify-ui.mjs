// UI verification for @xia-sc/dsh-git using system Chrome + playwright-core.
// Opens http://127.0.0.1:3080, waits for the shell, inspects the boot graph
// and the [data-dsh-git] seats, screenshots the panel, and prints findings.
// Usage: node verify-ui.mjs <screenshot-dir>
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? ".");
mkdirSync(outDir, { recursive: true });

const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push("PAGEERROR: " + err.message));

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(4000);

// 1) boot graph
const boot = await page.evaluate(() => {
  const wire = window.__DSH_BOOT__;
  return wire ? { rev: wire.rev, entries: wire.entries.map((e) => e.id) } : null;
});
console.log("boot:", JSON.stringify(boot, null, 1));
if (!boot) throw new Error("no __DSH_BOOT__ on page");
const gitEntry = boot.entries.find((id) => id === "@xia-sc/dsh-git");
console.log("dsh-git in boot:", !!gitEntry);

// 2) wait for any data-dsh-git seat to appear (badge or dock)
let badgeCount = 0, dockCount = 0, panelCount = 0;
try {
  await page.waitForSelector("[data-dsh-git]", { timeout: 15000 });
} catch {
  console.log("no [data-dsh-git] element found after wait");
}
await page.waitForTimeout(2000);
badgeCount = await page.locator('[data-dsh-git="badge"]').count();
dockCount = await page.locator('[data-dsh-git="dock"]').count();
panelCount = await page.locator('[data-dsh-git="panel"]').count();
console.log(`seats -> badge:${badgeCount} dock:${dockCount} panel:${panelCount}`);

// 3) screenshot the whole page + badge region if present
await page.screenshot({ path: join(outDir, "ui-full.png") });
if (badgeCount > 0) {
  const badge = page.locator('[data-dsh-git="badge"]').first();
  await badge.screenshot({ path: join(outDir, "ui-badge.png") });
  console.log("badge text:", JSON.stringify((await badge.textContent()).trim()));

  // expand the panel
  await badge.click();
  await page.waitForTimeout(1500);
  panelCount = await page.locator('[data-dsh-git="panel"]').count();
  console.log("panel after click:", panelCount);
  await page.screenshot({ path: join(outDir, "ui-panel.png") });
  if (panelCount > 0) {
    const text = (await page.locator('[data-dsh-git="panel"]').innerText()).slice(0, 600);
    console.log("panel content head:\n" + text);
  }
}
if (dockCount > 0) {
  const dock = page.locator('[data-dsh-git="dock"]').first();
  console.log("dock text:", JSON.stringify((await dock.textContent()).trim()));
}

console.log("console errors:", consoleErrors.length ? consoleErrors.slice(0, 10) : "none");
await browser.close();
console.log("\nDONE");
