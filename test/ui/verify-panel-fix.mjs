// Verify the expanded panel now has an opaque background and fixed positioning.
import { chromium } from "playwright-core";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

// open study-后台 workspace + a real session
const studyRow = page.locator('div[class*=projectRow]', { hasText: "study-后台" }).first();
if (await studyRow.count() > 0) {
  await studyRow.click();
  await page.waitForTimeout(1200);
}
const rows = page.locator('div[class*=sessionRow]');
const n = await rows.count();
for (let i = 0; i < n; i++) {
  const text = (await rows.nth(i).textContent()).trim();
  if (text.length > 3 && !text.startsWith("新会话")) {
    await rows.nth(i).click();
    break;
  }
}
await page.waitForTimeout(4000);

// expand the badge
const badge = page.locator('[data-dsh-git="badge"]').first();
if (await badge.count() > 0) {
  await badge.click();
  await page.waitForTimeout(1500);
}

const style = await page.evaluate(() => {
  const el = document.querySelector('[data-dsh-git="panel"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const root = getComputedStyle(document.documentElement);
  return {
    position: cs.position,
    backgroundColor: cs.backgroundColor,
    opacity: cs.opacity,
    backgroundImage: cs.backgroundImage,
    width: cs.width,
    bottom: cs.bottom,
    left: cs.left,
    zIndex: cs.zIndex,
    cssVarBgBase: root.getPropertyValue("--dsw-alias-bg-base").trim(),
    cssVarBgBase2: root.getPropertyValue("--dsw-alias-bg-primary").trim(),
    panelRect: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()
  };
});
console.log("panel computed style:", JSON.stringify(style, null, 1));

const bg = style ? style.backgroundColor : null;
const transparent = bg === "rgba(0, 0, 0, 0)" || bg === "transparent";
if (!style || transparent) throw new Error("panel background is still transparent!");
if (style.position !== "fixed") throw new Error("panel is not fixed-positioned!");

await page.screenshot({ path: "E:/dsh/plugin/dsh-git/test/ui/panel-fixed.png" });
console.log("console errors:", logs.length ? logs.slice(0, 5) : "none");
await browser.close();
console.log("PANEL FIX VERIFIED");
